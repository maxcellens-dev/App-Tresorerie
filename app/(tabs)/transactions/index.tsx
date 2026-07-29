import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, PanResponder, FlatList } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import ScreenSkeleton from '../../../components/ScreenSkeleton';
import { useDeferredMount } from '../../../hooks/useDeferredMount';
import OnboardingHintBanner from '../../../components/OnboardingHintBanner';
import AdSlot from '../../../components/AdSlot';
import { useOnbHighlight, onbGlow } from '../../../lib/onbHighlight';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useNavBack } from '../../../hooks/useNavBack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllTransactions, useUpdateTransaction, useDeleteTransaction, useValidateProjectDraft } from '../../../hooks/useTransactions';
import { useCreditFlows } from '../../../hooks/useCreditFlows';
import { useTransactionMonthOverrides } from '../../../hooks/useTransactionMonthOverrides';
import { useCategories } from '../../../hooks/useCategories';
import { useAllAccounts } from '../../../hooks/useAccounts';
import { useAccountParticipants, useAllParticipants, useAllMemberNames } from '../../../hooks/useSharedAccounts';
import { accountColor } from '../../../theme/colors';
import type { TransactionWithDetails, RecurrenceRule } from '../../../types/database';
import GuideModal from '../../../components/guide/GuideModal';
import { useGuide } from '../../../contexts/GuideContext';
import { useIsFocused } from '@react-navigation/native';
import CalculatorButton from '../../../components/CalculatorButton';
import RecurringTransactionsModal from '../../../components/RecurringTransactionsModal';
import { useAppColors } from '../../../hooks/useAppColors';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../../lib/currency';
import { sheetWidth } from '../../../lib/appLayout';
import { useResponsive } from '../../../hooks/useResponsive';
import { hoverRow } from '../../../lib/webLayout';
import { iconForTransaction } from '../../../lib/categoryIcons';
import { isProjectSpendTx } from '../../../lib/projectTx';
import { useRwLinkedTransactionIds } from '../../../hooks/useRelykaWorld';

// Les 3 boutons « Virement / Dépense / Recette » en haut de l'écran font doublon avec le bouton de
// saisie rapide (« + »), désormais présent ici aussi. On les masque, mais on garde le code : passer
// cette constante à `true` les rétablit tels quels.
const SHOW_TOP_ACTIONS = false;


function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatMonthHeader(year: number, month: number) {
  return new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthsFromOffset(offset: number, count: number): { year: number; month: number; key: string }[] {
  const now = new Date();
  const out: { year: number; month: number; key: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: getMonthKey(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}

function addRecurrenceToMonth(year: number, month: number, amount: number, startDate: string, rule: RecurrenceRule, endDate: string | null, currentDate: Date): number {
  const start = new Date(startDate);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  if (start > thisMonthEnd || end < thisMonthStart) return 0;
  if (rule === 'monthly') return amount;
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth) return amount;
    return 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() === month - 1 && year >= start.getFullYear()) return amount;
    return 0;
  }
  if (rule === 'weekly') {
    let count = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) count++;
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return count * amount;
  }
  return 0;
}

function getEffectiveDate(item: { date: string; displayDate?: string }): string {
  if (!item.displayDate) return item.date;
  const [y, m] = item.displayDate.split('-').map(Number);
  const origDay = new Date(item.date).getDate();
  const maxDay = new Date(y, m, 0).getDate();
  const day = Math.min(origDay, maxDay);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Élément de la liste APLATIE (FlatList) — un type par « brique » visuelle.
type TxListItem =
  | { t: 'ad'; placement: string; k: string }
  | { t: 'monthHeader'; year: number; month: number; gap: boolean; k: string }
  | { t: 'futureToggle'; count: number; k: string }
  | { t: 'row'; item: any; group: 'future' | 'past'; pos: number; groupCount: number; k: string }
  | { t: 'emptyPast'; k: string };

/** Montage différé (écran LOURD) : squelette 1 frame → l'onglet s'ouvre instantanément, la liste
 *  (3 mois projetés + récurrences) arrive juste après. Cf. hooks/useDeferredMount. */
export default function TransactionsListScreen() {
  return useDeferredMount() ? <TransactionsListBody /> : <ScreenSkeleton />;
}

function TransactionsListBody() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée + survol des lignes
  const onbRecurring = useOnbHighlight('recurring_tx');
  const router = useRouter();
  const goBack = useNavBack();
  const params = useLocalSearchParams<{ month?: string; focusMonth?: string; categoryId?: string; singleMonth?: string; filterType?: string; mouvType?: string }>();
  // Arrivée en deep-link depuis la Tréso (« voir transactions ») : focusMonth est posé par tous ces
  // liens. Dans ce cas seulement, on affiche un bouton « Retour » vers la page précédente (Tréso).
  // En arrivant par l'onglet Transactions du menu (aucun param), le bouton n'apparaît pas.
  const cameFromDeepLink = !!params.focusMonth;
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // ── Guide "bulles" ──
  const expenseBtnRef = useRef<any>(null);
  const incomeBtnRef = useRef<any>(null);
  const transferBtnRef = useRef<any>(null);
  const periodNavRef = useRef<any>(null);
  const actionsRef = useRef<any>(null);
  const filterBtnRef = useRef<any>(null);
  const recurBtnRef = useRef<any>(null);

  // Multi-compte : ensemble des IDs sélectionnés ([] = tous)
  const [accountFilterIds, setAccountFilterIds] = useState<string[]>([]);
  const [defaultCheckingIds, setDefaultCheckingIds] = useState<string[]>([]);
  const initializedAccountsSig = useRef<string | null>(null);
  const [showAccountFilter, setShowAccountFilter] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);

  /* ── Guide utilisateur (démarrage) ────────────────────────────────────────────────────────────
     Étape 2 : les récurrences. Ce sont elles qui rendent le Relyka juste — sans elles, l'app ne sait
     ni ce qui rentre ni ce qui part, et le chiffre ne vaut rien. Le modal reste donc tant qu'aucune
     récurrence n'existe (l'utilisateur peut naviguer ailleurs, il le retrouvera en revenant). */
  const guide = useGuide();
  const txFocused = useIsFocused();
  /* Le modal « Étape 2 » ne doit pas rester derrière l'écran de saisie ni derrière les dialogues
     qu'il ouvre : dès que l'utilisateur part créer sa récurrence, on le referme. Il ne revient
     qu'AU RETOUR sur cette page, et seulement si rien n'a été enregistré (l'étape serait alors
     franchie et le modal n'existerait plus).
     ⚠️ DÉLAI DE GRÂCE au retour. L'enregistrement se termine en arrière-plan (retour immédiat à la
     liste) : pendant ces quelques centaines de millisecondes, la récurrente n'existe pas encore
     côté données, et le guide en concluait « toujours rien » — le modal réapparaissait sous le nez
     de l'utilisateur qui venait juste d'enregistrer. Sur un téléphone, plus lent, ça se voyait
     franchement. On laisse donc l'écriture aboutir avant de reposer la question. Si elle a
     réellement échoué, le modal revient après ce délai : rien n'est perdu, c'est juste différé. */
  const RECUR_SAVE_GRACE_MS = 2500;
  const [recurAttempt, setRecurAttempt] = useState(false);
  useEffect(() => {
    if (!txFocused || !recurAttempt) return;
    const t = setTimeout(() => setRecurAttempt(false), RECUR_SAVE_GRACE_MS);
    return () => clearTimeout(t);
  }, [txFocused, recurAttempt]);


  const transactionsQuery = useAllTransactions(user?.id);
  const overridesQuery = useTransactionMonthOverrides(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);
  const validateProjectDraft = useValidateProjectDraft(user?.id);
  const { data: transactionsReal = [], isLoading } = transactionsQuery;
  // #2 — mensualités de crédit (remboursement + assurance) rendues visibles dans la liste, catégorisées.
  // Liste des transactions = vue COMPTE : montant RÉEL complet, non pondéré par le % d'impact (le compte
  // représente ce qu'il est). Le % d'impact ne joue que sur les agrégats perso (pilotage/projection/tréso).
  const creditFlows = useCreditFlows(user?.id, false);
  const transactions = useMemo(() => [...transactionsReal, ...creditFlows], [transactionsReal, creditFlows]);
  const { data: overrides = [] } = overridesQuery;
  const { data: accounts = [] } = useAllAccounts(user?.id);
  // Map account_id → compte (avec _role / is_joint / profile_id) pour distinguer les comptes
  // partagés/joints et le rôle (consultation) sur chaque ligne de transaction.
  const accountById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const a of accounts) m[a.id] = a;
    return m;
  }, [accounts]);
  // Puces triées par type (Courant → Épargne → Invest → Autre) ; ordre d'origine conservé au sein
  // d'un même type (tri stable).
  // Ordre (compte principal → type → nom) appliqué À LA SOURCE par useAllAccounts (lib/accountOrder).
  const sortedAccounts = accounts;
  // Transaction détaillée en lecture seule (compte reçu en consultation) → ouvre une feuille du bas.
  const [detailTx, setDetailTx] = useState<any | null>(null);
  const { data: detailParticipants = [] } = useAccountParticipants(detailTx?.account_id);
  // Auteur des transactions des comptes partagés (map globale user_id → nom).
  const { data: allParticipants = [] } = useAllParticipants(user?.id);
  const { data: memberNameById = {} } = useAllMemberNames(user?.id);
  const authorNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of allParticipants) m[p.user_id] = p.display_name;
    return m;
  }, [allParticipants]);
  // #4bis — opération « au nom de » un membre (on_behalf_member_id) → attribuée à ce membre.
  const authorLabel = (t: any): string =>
    (t?.on_behalf_member_id && memberNameById[t.on_behalf_member_id]) ? memberNameById[t.on_behalf_member_id]
    : (t?.profile_id === user?.id ? 'Vous' : (authorNameById[t?.profile_id] ?? 'Un membre'));
  // Transactions liées à une dépense de projet PARTAGÉ (Relyka World) : pas de project_id, on les
  // repère via ce set pour leur donner la même pastille « projet » que les projets personnels.
  const { data: rwTxIds } = useRwLinkedTransactionIds(user?.id);

  // Par défaut, sélectionner tous les comptes courants. On RÉINITIALISE quand l'ensemble des
  // comptes change (ex. mode admin « connecté en tant que » → comptes d'un autre utilisateur),
  // sinon le filtre garderait les comptes du 1er chargement et masquerait toutes les transactions.
  const accountsSig = useMemo(() => accounts.map((a: any) => a.id).sort().join(','), [accounts]);
  useEffect(() => {
    if (accounts.length === 0) return;
    if (initializedAccountsSig.current === accountsSig) return;
    initializedAccountsSig.current = accountsSig;
    // Filtre par défaut = mes comptes courants PERSO uniquement (les comptes joints/partagés sont
    // exclus de la sélection par défaut ; l'utilisateur peut les ajouter manuellement).
    const checkingIds = accounts
      .filter((a: any) => a.type === 'checking' && a._role === 'owner' && !a.is_joint)
      .map((a: any) => a.id);
    setDefaultCheckingIds(checkingIds);
    setAccountFilterIds(checkingIds);
  }, [accountsSig, accounts]);
  
  // -2 → fenêtre [m-2, m-1, m] ; l'affichage trié décroissant montre M, m-1, m-2 de haut en bas
  const [periodOffset, setPeriodOffset] = useState(-2);
  // Mois courant : les transactions À VENIR (date > aujourd'hui) sont repliées par défaut pour qu'on voie
  // d'emblée ce qui est réellement passé. Naviguer dans les périodes les déplie ; « revenir » les replie.
  const [showFutureThisMonth, setShowFutureThisMonth] = useState(false);
  const goPeriod = (delta: number) => { setPeriodOffset((o) => o + delta); setShowFutureThisMonth(true); };

  // Swipe horizontal sur la liste → navigation de période (±1 mois). Ne capture que les
  // gestes nettement horizontaux pour laisser le défilement vertical intact.
  const periodPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -50) goPeriod(1);
        else if (g.dx >= 50) goPeriod(-1);
      },
    })
  ).current;
  const [categoryFilterId, setCategoryFilterId] = useState<string | null>(params.categoryId ?? null);
  const [regulFilter, setRegulFilter] = useState(params.filterType === 'regul');
  const [mouvementsFilter, setMouvementsFilter] = useState(params.filterType === 'mouvements');
  const [mouvTypeFilter, setMouvTypeFilter] = useState<string | null>(params.mouvType ?? null);
  const [recettesFilter, setRecettesFilter] = useState(params.filterType === 'recettes');
  const [depensesFilter, setDepensesFilter] = useState(params.filterType === 'depenses');

  useEffect(() => {
    setCategoryFilterId(params.categoryId ?? null);
  }, [params.categoryId]);

  useEffect(() => {
    setRegulFilter(params.filterType === 'regul');
    setMouvementsFilter(params.filterType === 'mouvements');
    setMouvTypeFilter(params.mouvType ?? null);
    setRecettesFilter(params.filterType === 'recettes');
    setDepensesFilter(params.filterType === 'depenses');
  }, [params.filterType, params.mouvType]);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentMonthKey = getMonthKey(currentYear, currentMonth);
  
  // Déterminer nombre de mois à afficher
  const displayMonthCount = params.singleMonth === '1' ? 1 : 3;
  
  // Initialiser periodOffset basé sur focusMonth s'il est fourni
  useEffect(() => {
    if (params.focusMonth) {
      const [focusYear, focusMonth] = params.focusMonth.split('-').map(Number);
      const focusDate = new Date(focusYear, focusMonth - 1, 1);
      const nowDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const diff = focusDate.getMonth() - nowDate.getMonth() + (focusDate.getFullYear() - nowDate.getFullYear()) * 12;
      setPeriodOffset(diff);
    }
  }, [params.focusMonth]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await transactionsQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  // Obtenir les mois consécutifs basé sur periodOffset (1 ou 3 selon singleMonth)
  const displayMonths = useMemo(() => getMonthsFromOffset(periodOffset, displayMonthCount), [periodOffset, displayMonthCount]);

  const overrideMap = useMemo(() => {
    const map: Record<string, { amount: number | null; date?: string | null }> = {};
    overrides.forEach((o) => {
      map[`${o.transaction_id}:${o.year}:${o.month}`] = { amount: o.override_amount, date: o.override_date };
    });
    return map;
  }, [overrides]);

  // Créer une liste de transactions affichées, incluant les transactions récurrentes instanciées
  const displayedTransactions = useMemo(() => {
    const result: (TransactionWithDetails & { displayDate?: string })[] = [];
    const displayMonthKeys = displayMonths.map(m => m.key);
    
    for (const t of transactions as TransactionWithDetails[]) {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      const transactionKey = getMonthKey(tYear, tMonth);
      
      if (t.project_id) {
        // Transactions de projet : toujours traiter comme ponctuelles (une par mois)
        if (displayMonthKeys.includes(transactionKey)) {
          result.push(t);
        }
      } else if (t.is_recurring && t.recurrence_rule) {
        // Pour chaque mois affiché, calculer si cette récurrence s'applique
        for (const m of displayMonths) {
          const appliedAmount = addRecurrenceToMonth(m.year, m.month, Number(t.amount), t.date, t.recurrence_rule, t.recurrence_end_date ?? null, now);
          const overrideKey = `${t.id}:${m.year}:${m.month}`;
          const ovr = overrideMap[overrideKey];
          const finalAmount = ovr && ovr.amount != null ? ovr.amount : appliedAmount;
          if (Math.abs(finalAmount) > 0) {
            // Créer une instance de la transaction pour ce mois. #2 : si la date de CETTE échéance a
            // été déplacée (override_date), l'occurrence s'affiche et se trie à la nouvelle date.
            result.push({
              ...t,
              displayDate: getMonthKey(m.year, m.month),
              amount: finalAmount,
              ...(ovr?.date ? { date: ovr.date } : {}),
            });
          }
        }
      } else {
        // Transaction ponctuelle : ajoute seulement si elle tombe dans les 3 mois affichés
        if (displayMonthKeys.includes(transactionKey)) {
          result.push(t);
        }
      }
    }
    
    return result;
    // overrideMap DOIT être une dépendance : sinon, quand les overrides se chargent (ou changent) après
    // le 1er calcul, la liste garde l'ANCIEN montant jusqu'à un autre déclencheur (mois/filtre).
  }, [transactions, displayMonths, now, overrideMap]);

  // Récupérer les categories pour filtrer par parent/enfant
  const { data: categories = [] } = useCategories(user?.id);
  
  // Filtrer par catégorie si nécessaire (inclure enfants si parent est sélectionné)
  const filtered = useMemo(() => {
    let list = displayedTransactions;
    // Les transactions de projet sont hors « catégories » (virements / réservations) — SAUF les
    // dépenses d'un projet « Dépenser petit à petit », qui sont des dépenses catégorisées normales.
    const outOfCategories = (t: any) => !!t.project_id && !isProjectSpendTx(t);
    if (categoryFilterId) {
      const selectedCategory = categories.find(c => c.id === categoryFilterId);
      if (selectedCategory) {
        if (!selectedCategory.parent_id) {
          const childIds = categories.filter(c => c.parent_id === selectedCategory.id).map(c => c.id);
          const allIdsToFilter = [selectedCategory.id, ...childIds];
          const isFraisVariables = selectedCategory.name === 'Frais variables';
          list = list.filter((t) =>
            !outOfCategories(t) &&
            (
              (t.category_id && allIdsToFilter.includes(t.category_id)) ||
              (isFraisVariables && (t.note?.startsWith('Régularisation') || t.note === 'Ajustement de solde'))
            )
          );
        } else {
          list = list.filter((t) => !outOfCategories(t) && t.category_id === categoryFilterId);
        }
      }
    }
    // Filtre Régularisation solde
    if (regulFilter) {
      list = list.filter((t) => t.note?.startsWith('Régularisation') || t.note === 'Ajustement de solde');
    }
    // Filtre Mouvements (virements épargne/invest + transactions projet).
    // `mouvTypeFilter` affine selon la ligne cliquée dans la Tréso : épargne / invest / projets.
    if (mouvementsFilter) {
      list = list.filter((t) => {
        const isChecking = t.account?.type === 'checking';
        const linkedType = t.linked_account?.type;
        // Les dépenses de projet ne sont pas des « mouvements » (elles vivent dans leur catégorie).
        const isProjectTx = outOfCategories(t);
        if (mouvTypeFilter === 'epargne') return isChecking && linkedType === 'savings' && !isProjectTx;
        if (mouvTypeFilter === 'invest') return isChecking && linkedType === 'investment' && !isProjectTx;
        if (mouvTypeFilter === 'projets') return isProjectTx;
        return isChecking && (linkedType === 'savings' || linkedType === 'investment' || isProjectTx);
      });
    }
    // Filtre Recettes
    if (recettesFilter) {
      list = list.filter((t) => t.category?.type === 'income');
    }
    // Filtre Dépenses (hors virements/réservations de projet, qui sont dans Mouvements)
    if (depensesFilter) {
      list = list.filter((t) => t.category?.type === 'expense' && !outOfCategories(t));
    }
    // Filtre par comptes sélectionnés
    if (accountFilterIds.length > 0) {
      list = list.filter((t) => accountFilterIds.includes(t.account_id));
    }
    return list;
  }, [displayedTransactions, categoryFilterId, categories, accountFilterIds, regulFilter, mouvementsFilter, mouvTypeFilter, recettesFilter, depensesFilter]);

  const byMonth = useMemo(() => {
    const map: Record<string, TransactionWithDetails[]> = {};
    for (const t of filtered) {
      // Utiliser displayDate si fourni (pour les transactions récurrentes instanciées), sinon utiliser la date réelle
      const dateToUse = t.displayDate || t.date;
      const [y, m] = dateToUse.split('-').map(Number);
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    for (const arr of Object.values(map)) arr.sort((a, b) => {
      const dateA = getEffectiveDate(a);
      const dateB = getEffectiveDate(b);
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      // Même jour : « déjà incluses » en bas, sinon plus récent en haut → une transaction saisie
      // après la régul passe au-dessus, la régul au-dessus de ce qu'elle a absorbé.
      const ca = (a as any).regul_covered ? 1 : 0;
      const cb = (b as any).regul_covered ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return ((b as any).created_at ?? '').localeCompare((a as any).created_at ?? '');
    });
    const keys = Object.keys(map).sort((a, b) => {
      // Trier les mois en ordre inverse (plus récent d'abord)
      const aDate = new Date(Number(a.split('-')[0]), parseInt(a.split('-')[1]) - 1);
      const bDate = new Date(Number(b.split('-')[0]), parseInt(b.split('-')[1]) - 1);
      return bDate.getTime() - aDate.getTime();
    });
    return keys.map((key) => {
      const [y, m] = key.split('-').map(Number);
      return { key, year: y, month: m, items: map[key] };
    });
  }, [filtered]);

  // ── Liste APLATIE (typée) pour la FlatList : virtualisation au niveau LIGNE (seules les lignes
  // visibles sont rendues). On reproduit fidèlement la structure : en-tête de mois, section « À venir »
  // repliable, cartes de lignes (rayons haut/bas par groupe), pub inter-mois, placeholders. ──
  const listData = useMemo(() => {
    const out: TxListItem[] = [];
    byMonth.forEach(({ key, year, month, items }, monthIndex) => {
      const isCurrentMonth = key === currentMonthKey;
      const pastItems = isCurrentMonth ? items.filter((it) => getEffectiveDate(it) <= todayStr) : items;
      const futureItems = isCurrentMonth ? items.filter((it) => getEffectiveDate(it) > todayStr) : [];
      if (monthIndex === 1) out.push({ t: 'ad', placement: 'transactions_mois', k: 'ad-mois' });
      out.push({ t: 'monthHeader', year, month, gap: monthIndex > 0, k: `mh-${key}` });
      if (isCurrentMonth && futureItems.length > 0) {
        out.push({ t: 'futureToggle', count: futureItems.length, k: `ft-${key}` });
        if (showFutureThisMonth) {
          futureItems.forEach((item, i) =>
            out.push({ t: 'row', item, group: 'future', pos: i, groupCount: futureItems.length, k: `f-${item.id}-${(item as any).displayDate || ''}` }));
        }
      }
      if (pastItems.length > 0) {
        pastItems.forEach((item, i) =>
          out.push({ t: 'row', item, group: 'past', pos: i, groupCount: pastItems.length, k: `p-${item.id}-${(item as any).displayDate || ''}` }));
      } else if (isCurrentMonth) {
        out.push({ t: 'emptyPast', k: `ep-${key}` });
      }
    });
    return out;
  }, [byMonth, currentMonthKey, todayStr, showFutureThisMonth]);

  // Le filtre est "manuel" si la sélection diffère des comptes courants par défaut
  const isManualFilter =
    accountFilterIds.length !== defaultCheckingIds.length ||
    accountFilterIds.some((id) => !defaultCheckingIds.includes(id));
  const hasFilter = !!categoryFilterId || isManualFilter || regulFilter || mouvementsFilter || recettesFilter || depensesFilter;
  const selectedCategoryName = categoryFilterId ? categories.find(c => c.id === categoryFilterId)?.name : null;
  
  // Afficher/cacher boutons nav si singleMonth
  const showPeriodNav = params.singleMonth !== '1';
  
  // Formater la plage de mois affichés
  const firstMonth = displayMonths[0];
  const lastMonth = displayMonths[displayMonths.length - 1];
  const monthRangeText = useMemo(() => {
    if (displayMonths.length === 0) return '';
    return `${formatMonthHeader(firstMonth.year, firstMonth.month)} - ${formatMonthHeader(lastMonth.year, lastMonth.month)}`;
  }, [firstMonth, lastMonth, displayMonths]);

  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: string;
    onConfirm: () => void;
  } | null>(null);

  function showConfirm(opts: { title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }) {
    setConfirmModal(opts);
  }

  function confirmValidateDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce brouillon';
    // Seul un brouillon de VIREMENT de projet (compte de destination) se valide en virement à 2 jambes.
    // Une dépense de projet se valide comme une dépense ordinaire.
    const isProjectDebit = !!(item as any).project_id && Number(item.amount) < 0 && !!(item as any).linked_account_id;
    showConfirm({
      title: 'Valider la transaction',
      message: isProjectDebit
        ? `Valider le virement "${label}" vers le compte de destination ?`
        : `Valider "${label}" ?`,
      confirmLabel: 'Valider',
      confirmColor: COLORS.green,
      onConfirm: async () => {
        try {
          if (isProjectDebit) {
            await validateProjectDraft.mutateAsync({
              id: item.id,
              project_id: (item as any).project_id,
              amount: Number(item.amount),
              date: item.date,
              account_id: item.account_id,
            });
          } else {
            await updateTx.mutateAsync({ id: item.id, is_draft: false });
          }
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de valider.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  function confirmDeleteDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce brouillon';
    showConfirm({
      title: 'Supprimer le brouillon',
      message: `Supprimer "${label}" ?`,
      confirmLabel: 'Supprimer',
      confirmColor: '#f87171',
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de supprimer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  // Conserver un brouillon de projet : le marque « Réservé » (pas de dépense validée),
  // son montant alimente la ligne Réservé du Pilotage jusqu'à utilisation/libération.
  function confirmConserveDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce montant';
    const montant = Math.abs(Number(item.amount));
    showConfirm({
      title: 'Conserver pour plus tard',
      message: `Mettre ${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL} de "${label}" en Réservé ? Le montant n'est pas dépensé mais mis de côté et visible dans la ligne Réservé du Pilotage.`,
      confirmLabel: 'Conserver',
      confirmColor: '#60a5fa',
      onConfirm: async () => {
        try {
          await updateTx.mutateAsync({ id: item.id, is_reserved: true });
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de conserver.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  // Libérer une réservation depuis la liste : supprime le brouillon réservé.
  function confirmLiberateReserved(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce montant';
    showConfirm({
      title: 'Libérer la réservation',
      message: `Libérer "${label}" ? Le brouillon réservé sera supprimé et le montant retiré du Réservé.`,
      confirmLabel: 'Libérer',
      confirmColor: '#f87171',
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de libérer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  // Rendu d'une ligne de transaction. `count` = nb d'éléments de la liste conteneur (pour retirer la
  // bordure du dernier). Extrait pour être réutilisé par les listes « passé » et « à venir » du mois.
  const renderRow = (
    item: TransactionWithDetails & { displayDate?: string },
    index: number,
    count: number,
  ) => {
    const effectiveDate = getEffectiveDate(item);
    const isFuture = effectiveDate > todayStr;
    const isProject = !!item.project_id || (rwTxIds?.has(item.id) ?? false);
    // Compte partagé/joint (vs mon compte perso) + rôle consultation.
    const acctMeta = accountById[item.account_id];
    const isSharedAcct = !!acctMeta?.is_joint || (!!acctMeta?.profile_id && acctMeta.profile_id !== user?.id);
    const isReadOnlyAcct = acctMeta?._role === 'read';
    // Une occurrence matérialisée (ligne réelle issue d'un modèle récurrent,
    // is_recurring=false mais materialized_from rempli) fait partie d'une série :
    // on lui donne aussi le tag « récurrent » pour que l'utilisateur le sache.
    const isRecurring = (item.is_recurring || !!(item as any).materialized_from) && !isProject;
    const isReservation = isProject && Number(item.amount) === 0;
    const amt = Number(item.amount);
    const acctType = item.account?.type ?? 'checking';
    const acctCol = accountColor(acctType);

    const isDraft = !!(item as any).is_draft;
    const isProjectDraft = isDraft && isProject;
    // « Conserver » (mettre en Réservé) n'a de sens que pour un VIREMENT de projet en attente.
    const isProjectTransferDraft = isProjectDraft && !!(item as any).linked_account_id;
    const isReserved = !!(item as any).is_reserved;
    // Boutons valider/supprimer visibles sur tous les brouillons (passés, courants ET futurs)
    const isDraftQuickAction = isDraft;
    const navigateToEdit = () => {
      // #2 — une mensualité de crédit (flux synthétique) renvoie au crédit, pas à l'édition de tx.
      if ((item as any).is_credit_flow) { router.push(`/(tabs)/comptes/credit/${(item as any).credit_id}` as any); return; }
      const route = item.displayDate
        ? `/(tabs)/transactions/edit/${item.id}?instanceDate=${item.displayDate}`
        : `/(tabs)/transactions/edit/${item.id}`;
      router.push(route as any);
    };
    const accentStyle = isProject
      ? { backgroundColor: COLORS.teal + '50' }
      : amt > 0
        ? { backgroundColor: acctCol + '50' }
        : { backgroundColor: acctCol + '25' };
    const rowBaseStyle = [
      styles.row,
      isDraftQuickAction && styles.rowAlignStart,
      index === count - 1 && styles.rowLast,
      isFuture && styles.rowFuture,
      isDraft && (isProjectDraft ? styles.rowDraftProject : styles.rowDraft),
    ];

    if (isDraftQuickAction) {
      return (
        <View key={`${item.id}-${item.displayDate || ''}`} style={[styles.row, styles.rowDraftColumn, index === count - 1 && styles.rowLast, isFuture && styles.rowFuture, isDraft && (isProjectDraft ? styles.rowDraftProject : styles.rowDraft)]}>
          <View style={[styles.rowAccent, accentStyle]} />
          {/* Ligne 1 : libellé + montant */}
          <View style={styles.draftTopRow}>
            <TouchableOpacity style={styles.rowLeft} onPress={navigateToEdit} activeOpacity={0.7}>
              <View style={styles.rowLabelRow}>
                <Ionicons name={iconForTransaction(item) as any} size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />
                {isProject && <View style={[styles.projectDot, { backgroundColor: COLORS.teal }]} />}
                <Text style={[styles.rowLabel, isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft]} numberOfLines={1}>
                  {item.note || item.category?.name || 'Sans libellé'}
                </Text>
                {isReserved ? (
                  <View style={styles.reservedBadge}>
                    <Ionicons name="bookmark" size={9} color={COLORS.blue} />
                    <Text style={styles.reservedBadgeText}>Réservé</Text>
                  </View>
                ) : (
                  <View style={[styles.draftBadge, isProjectDraft && styles.draftBadgeProject]}>
                    <Text style={[styles.draftBadgeText, isProjectDraft && styles.draftBadgeTextProject]}>Brouillon</Text>
                  </View>
                )}
                {isRecurring && (
                  <Ionicons name="repeat" size={11} color={COLORS.textSecondary} style={{ marginLeft: 6, opacity: 0.6 }} />
                )}
              </View>
              <Text style={styles.rowMeta}>
                {item.account?.name ?? ''} · {formatDate(effectiveDate)}{isSharedAcct ? ` - par ${authorLabel(item)}` : ''}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg, { textAlign: 'right' }]}>
              {amt > 0 ? '+' : ''}{amt.toFixed(2)} {currencySymbolFor(item.account?.currency)}
            </Text>
          </View>
          {/* Ligne 2 : actions */}
          <View style={styles.draftActionRow}>
            {isReserved ? (
              <TouchableOpacity style={styles.draftActionDelete} onPress={() => confirmLiberateReserved(item)} activeOpacity={0.7}>
                <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                <Text style={[styles.draftActionValidateText, { color: COLORS.danger }]}>Libérer</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity style={styles.draftActionValidate} onPress={() => confirmValidateDraft(item)} activeOpacity={0.7}>
                  <Ionicons name="checkmark" size={14} color={COLORS.green} />
                  <Text style={styles.draftActionValidateText}>Valider</Text>
                </TouchableOpacity>
                {isProjectTransferDraft && (
                  <TouchableOpacity style={styles.draftActionConserve} onPress={() => confirmConserveDraft(item)} activeOpacity={0.7}>
                    <Ionicons name="bookmark-outline" size={14} color={COLORS.blue} />
                    <Text style={styles.draftActionConserveText}>Conserver</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.draftActionDelete} onPress={() => confirmDeleteDraft(item)} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        key={`${item.id}-${item.displayDate || ''}`}
        style={rowBaseStyle}
        {...hoverRow}
        onPress={isReadOnlyAcct ? () => setDetailTx(item) : navigateToEdit}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <View style={[styles.rowAccent, accentStyle]} />
        <View style={styles.rowLeft}>
          <View style={styles.rowLabelRow}>
            <Ionicons name={iconForTransaction(item) as any} size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />
            {isProject && <View style={[styles.projectDot, { backgroundColor: COLORS.teal }]} />}
            {isSharedAcct && <View style={[styles.projectDot, { backgroundColor: COLORS.textSecondary }]} />}
            <Text style={[styles.rowLabel, isDraft && (isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft)]} numberOfLines={1}>
              {item.note || item.category?.name || 'Sans libellé'}
            </Text>
            {isDraft && (
              <View style={[styles.draftBadge, isProjectDraft && styles.draftBadgeProject]}>
                <Text style={[styles.draftBadgeText, isProjectDraft && styles.draftBadgeTextProject]}>Brouillon</Text>
              </View>
            )}
            {isRecurring && (
              <Ionicons name="repeat" size={11} color={COLORS.textSecondary} style={{ marginLeft: 6, opacity: 0.6 }} />
            )}
          </View>
          <Text style={styles.rowMeta}>
            {item.account?.name ?? ''} · {formatDate(effectiveDate)}{isSharedAcct ? ` - par ${authorLabel(item)}` : ''}
          </Text>
        </View>
        {isReservation ? (
          <View style={styles.reservationBadge}>
            <Text style={styles.reservationText}>Réservé</Text>
          </View>
        ) : (
          <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg]}>
            {amt > 0 ? '+' : ''}{amt.toFixed(2)} {currencySymbolFor(item.account?.currency)}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // renderItem de la FlatList : chaque « brique » (pub, en-tête de mois, bascule « À venir », ligne, vide).
  const renderListItem = ({ item: li }: { item: TxListItem }) => {
    switch (li.t) {
      case 'ad':
        return <AdSlot placement={li.placement as any} />;
      case 'monthHeader':
        return (
          <View style={[styles.monthHeader, li.gap && { marginTop: 16 }]}>
            <Text style={styles.monthHeaderText}>{formatMonthHeader(li.year, li.month)}</Text>
          </View>
        );
      case 'futureToggle':
        return (
          <TouchableOpacity style={styles.futureToggle} onPress={() => setShowFutureThisMonth((v) => !v)} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name={showFutureThisMonth ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
            <Text style={styles.futureToggleText}>À venir ce mois ({li.count})</Text>
          </TouchableOpacity>
        );
      case 'row': {
        const first = li.pos === 0;
        const last = li.pos === li.groupCount - 1;
        // Reproduit la carte arrondie qui englobait le groupe : bg partout, rayon en haut (1ʳᵉ ligne) et
        // en bas (dernière). Un écart sépare le groupe « À venir » du groupe « passé » et les mois.
        return (
          <View style={[
            styles.rowWrap,
            first && styles.rowWrapTop,
            last && styles.rowWrapBottom,
            last && (li.group === 'future' ? { marginBottom: 8 } : { marginBottom: 20 }),
          ]}>
            {renderRow(li.item, li.pos, li.groupCount)}
          </View>
        );
      }
      case 'emptyPast':
        return (
          <View style={[styles.card, { marginBottom: 20 }]}>
            <Text style={styles.empty}>Aucune transaction passée pour l'instant ce mois.</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <OnboardingHintBanner />
      {/* Bureau : toute la page (filtres + liste) tient dans une colonne de lecture centrée —
          une liste de transactions étalée sur 1600 px devient illisible (l'œil perd la ligne). */}
      <SafeAreaView style={[styles.safe, isDesktop && styles.safeDesktop]} edges={['left', 'right']}>
        {/* Question du profil progressif — entrer dans ses transactions est un déclencheur sûr. */}
        {cameFromDeepLink && (
          <TouchableOpacity style={styles.backRow} onPress={goBack} accessibilityRole="button">
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
            <Text style={styles.backText}>Retour</Text>
          </TouchableOpacity>
        )}
        {showPeriodNav && (
          <View style={styles.periodNav} ref={periodNavRef}>
            <TouchableOpacity
              style={styles.periodBtn}
              onPress={() => goPeriod(-1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodLabel} onPress={() => { setPeriodOffset(-2); setShowFutureThisMonth(false); }} activeOpacity={0.7}>
              <Text style={styles.periodText}>{monthRangeText}</Text>
              {periodOffset !== -2 && <Text style={styles.periodLabelHint}>Appuyer pour revenir</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.periodBtn}
              onPress={() => goPeriod(1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity
              ref={recurBtnRef}
              style={[styles.filterBtn, { backgroundColor: COLORS.orange + '22', borderColor: COLORS.orange }]}
              onPress={() => setShowRecurring(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Transactions récurrentes"
            >
              {/* Le bouton trace lui-même son anneau quand le guide le désigne — en même temps que
                  la feuille qu'il ouvre (cf. GUIDE_TX_BUBBLES). */}
              <Ionicons name="repeat" size={18} color={COLORS.orange} />
            </TouchableOpacity>
            <TouchableOpacity
              ref={filterBtnRef}
              style={[styles.filterBtn, accountFilterIds.length > 0 && styles.filterBtnActive]}
              onPress={() => setShowAccountFilter(!showAccountFilter)}
              activeOpacity={0.7}
            >
              <Ionicons name="filter" size={18} color={accountFilterIds.length > 0 ? COLORS.bg : COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        {showAccountFilter && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountFilterScroll} contentContainerStyle={styles.accountFilterContent}>
            <TouchableOpacity
              style={[styles.accountFilterChip, accountFilterIds.length === 0 && styles.accountFilterChipActive]}
              onPress={() => setAccountFilterIds([])}
            >
              <Text style={[styles.accountFilterChipText, accountFilterIds.length === 0 && styles.accountFilterChipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {sortedAccounts.map((acc) => {
              const selected = accountFilterIds.includes(acc.id);
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.accountFilterChip, selected && styles.accountFilterChipActive]}
                  onPress={() => {
                    setAccountFilterIds((prev) =>
                      prev.includes(acc.id) ? prev.filter((id) => id !== acc.id) : [...prev, acc.id]
                    );
                  }}
                >
                  <Text style={[styles.accountFilterChipText, selected && styles.accountFilterChipTextActive]}>{acc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {SHOW_TOP_ACTIONS && (
        <View style={[styles.header, onbRecurring ? onbGlow(COLORS, true) : null]} ref={actionsRef}>
          {/* Ordre : Virement, Dépense, Recette (identique à l'écran de création). */}
          <TouchableOpacity
            ref={transferBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=transfer')}
            accessibilityRole="button"
          >
            <Ionicons name="swap-horizontal" size={20} color={COLORS.blue} />
            <Text style={[styles.addBtnLabel, { color: COLORS.blue }]}>Virement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={expenseBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=expense')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-down" size={20} color={COLORS.danger} />
            <Text style={[styles.addBtnLabel, { color: COLORS.danger }]}>Dépense</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={incomeBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=income')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-up" size={20} color={COLORS.green} />
            <Text style={[styles.addBtnLabel, { color: COLORS.green }]}>Recette</Text>
          </TouchableOpacity>
        </View>
        )}
        {hasFilter && (
          <View style={styles.activeFilters}>
            {selectedCategoryName && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setCategoryFilterId(null)} activeOpacity={0.7}>
                <Ionicons name="pricetag-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>{selectedCategoryName}</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {regulFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setRegulFilter(false)} activeOpacity={0.7}>
                <Ionicons name="swap-vertical-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Régularisation solde</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {mouvementsFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setMouvementsFilter(false)} activeOpacity={0.7}>
                <Ionicons name="swap-horizontal-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Mouvements</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {recettesFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setRecettesFilter(false)} activeOpacity={0.7}>
                <Ionicons name="arrow-up-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Recettes</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {depensesFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setDepensesFilter(false)} activeOpacity={0.7}>
                <Ionicons name="arrow-down-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Dépenses</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {isManualFilter && accountFilterIds.length > 0 && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setAccountFilterIds(defaultCheckingIds)} activeOpacity={0.7}>
                <Ionicons name="wallet-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>
                  {accountFilterIds.length === 1
                    ? (accounts.find(a => a.id === accountFilterIds[0])?.name ?? 'Compte')
                    : `${accountFilterIds.length} comptes`}
                </Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={{ flex: 1 }} {...periodPan.panHandlers}>
        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
        ) : (
          <FlatList
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, isDesktop && { paddingBottom: 48 }]}
            data={listData}
            keyExtractor={(li) => li.k}
            renderItem={renderListItem}
            showsVerticalScrollIndicator={false}
            // Virtualisation : seules les lignes visibles (+ marge) sont rendues → fluide même avec
            // des centaines de transactions dans un mois.
            initialNumToRender={20}
            maxToRenderPerBatch={16}
            windowSize={11}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={COLORS.emerald}
                progressBackgroundColor={COLORS.card}
              />
            }
            ListEmptyComponent={
              <View style={styles.card}>
                <Text style={styles.empty}>Aucune transaction{hasFilter ? ' pour ce filtre' : ''}.</Text>
              </View>
            }
            ListFooterComponent={
              <>
                {listData.length > 0 && <Text style={styles.hint}>Appuyez sur une ligne pour modifier ou supprimer.</Text>}
                {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
                <AdSlot placement="transactions" />
              </>
            }
          />
        )}
        </View>
        <Modal visible={!!confirmModal} transparent animationType="fade" onRequestClose={() => setConfirmModal(null)}>
          <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setConfirmModal(null)}>
            <TouchableOpacity style={styles.confirmBox} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
              <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
              <View style={styles.confirmBtns}>
                <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmModal(null)}>
                  <Text style={styles.confirmCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmOk, { borderColor: confirmModal?.confirmColor ?? COLORS.green, backgroundColor: (confirmModal?.confirmColor ?? COLORS.green) + '18' }]}
                  onPress={() => {
                    const cb = confirmModal?.onConfirm;
                    setConfirmModal(null);
                    cb?.();
                  }}
                >
                  <Text style={[styles.confirmOkText, { color: confirmModal?.confirmColor ?? COLORS.green }]}>{confirmModal?.confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Détail d'une transaction sur un compte reçu en CONSULTATION : lecture seule, pas de
            « Modifier ». S'ouvre par le bas comme depuis la page du compte. */}
        <Modal visible={!!detailTx} transparent animationType="slide" onRequestClose={() => setDetailTx(null)}>
          <TouchableOpacity style={styles.detailOverlay} activeOpacity={1} onPress={() => setDetailTx(null)}>
            <TouchableOpacity style={styles.detailSheet} activeOpacity={1} onPress={() => {}}>
              {detailTx && (() => {
                const amt = Number(detailTx.amount);
                const inc = amt >= 0;
                const author = detailTx.profile_id === user?.id ? 'Vous' : (detailParticipants.find((p) => p.user_id === detailTx.profile_id)?.display_name ?? 'Un membre');
                const sym = currencySymbolFor(detailTx.account?.currency);
                const lbl = detailTx.note?.trim() || detailTx.category?.name || 'Transaction';
                const rows: [string, string][] = [
                  ['Date', new Date(detailTx.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
                  ['Montant', `${inc ? '+' : '−'} ${Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${sym}`],
                  ['Compte', detailTx.account?.name ?? ''],
                  ['Par', author],
                ];
                if (detailTx.category?.name) rows.push(['Catégorie', detailTx.category.name]);
                return (
                  <>
                    <View style={styles.detailHandle} />
                    <Text style={[styles.detailAmount, { color: inc ? COLORS.green : COLORS.danger }]}>{inc ? '+' : '−'} {Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {sym}</Text>
                    <Text style={styles.detailLabelText}>{lbl}</Text>
                    <View style={styles.detailDivider} />
                    {rows.map(([k, v]) => (
                      <View key={k} style={styles.detailRow}>
                        <Text style={styles.detailKey}>{k}</Text>
                        <Text style={styles.detailVal}>{v}</Text>
                      </View>
                    ))}
                    <Text style={styles.detailReadOnly}>Compte en consultation — lecture seule.</Text>
                    <TouchableOpacity style={styles.detailCloseBtn} onPress={() => setDetailTx(null)}>
                      <Text style={styles.detailCloseText}>Fermer</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>


      {/* ── GUIDE : repères de la page (filtre, récurrences + leur liste ouverte, bouton de saisie) ── */}

      <CalculatorButton page="transactions" />
      <RecurringTransactionsModal
        visible={showRecurring}
        onClose={() => setShowRecurring(false)}
        userId={user?.id}
      />

      {/* ── GUIDE : créer une première récurrence (reste tant que ce n'est pas fait) ──
          Monté APRÈS la liste des récurrentes pour que la révélation ci-dessous passe par-dessus. */}
      <GuideModal
        visible={guide.is('tx_recurring') && txFocused && !showRecurring && !recurAttempt}
        icon="repeat"
        iconColor={COLORS.orange}
        eyebrow="Étape 2 · Ce qui revient chaque mois"
        step={{ index: 2, total: 4 }}
        title="Enregistre une dépense ou une recette récurrente"
        text="Ton salaire, ton loyer, tes abonnements : saisis-les une seule fois en cochant « Récurrent ». C'est ce qui permet à Relyka d'anticiper ton mois."
        choices={[
          {
            icon: 'arrow-up', color: COLORS.green,
            title: 'Ma rentrée d\'argent',
            text: 'Salaire, pension, revenus d\'activité.',
            onPress: () => { setRecurAttempt(true); router.push('/(tabs)/transactions/add?type=income&recurring=1' as any); },
          },
          {
            icon: 'arrow-down', color: COLORS.danger,
            title: 'Une charge fixe',
            text: 'Loyer, énergie, téléphone, abonnements.',
            onPress: () => { setRecurAttempt(true); router.push('/(tabs)/transactions/add?type=expense&recurring=1' as any); },
          },
        ]}
      />

    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  // Web bureau : colonne de lecture centrée (max 1000) — filtres, en-tête et liste alignés.
  safeDesktop: { width: '100%', maxWidth: 1000, alignSelf: 'center', paddingHorizontal: 32, paddingTop: 16 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  backText: { fontSize: 14, fontWeight: '600', color: c.text },
  header: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.card,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 13, fontWeight: '600', color: c.text },
  clearFilter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingVertical: 8 },
  clearFilterText: { fontSize: 14, color: c.emerald, fontWeight: '600' },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  filterChipText: { fontSize: 13, color: c.emerald, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },
  monthBlock: { marginBottom: 20 },
  monthHeader: { paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
  monthHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: c.card,
    borderRadius: 18,
    overflow: 'hidden',
  },
  // Enveloppe d'UNE ligne dans la FlatList : reconstitue la carte arrondie qui groupait les lignes.
  rowWrap: { backgroundColor: c.card },
  rowWrapTop: { borderTopLeftRadius: 18, borderTopRightRadius: 18, overflow: 'hidden' },
  rowWrapBottom: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: c.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  rowLast: { borderBottomWidth: 0 },
  rowFuture: { opacity: 0.38 },
  rowAlignStart: { alignItems: 'flex-start' },
  rowDraft: { borderLeftWidth: 2, borderLeftColor: c.orange },
  rowDraftProject: { borderLeftWidth: 2, borderLeftColor: c.blue },
  rowLabelDraft: { fontStyle: 'italic', color: c.orange },
  rowLabelDraftProject: { fontStyle: 'italic', color: c.blue },
  draftBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.orange + '22', borderWidth: 1, borderColor: c.orange },
  draftBadgeProject: { backgroundColor: c.blue + '22', borderColor: c.blue },
  draftBadgeText: { fontSize: 10, fontWeight: '700', color: c.orange },
  draftBadgeTextProject: { color: c.blue },
  rowRightDraft: { alignItems: 'flex-end' },
  rowDraftColumn: { flexDirection: 'column', alignItems: 'stretch', gap: 7 },
  draftTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  draftActionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  draftActionValidate: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, borderRadius: 8, backgroundColor: c.green + '18', borderWidth: 1, borderColor: c.green + '44' },
  draftActionValidateText: { fontSize: 12, fontWeight: '700', color: c.green },
  draftActionConserve: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, borderRadius: 8, backgroundColor: c.blue + '18', borderWidth: 1, borderColor: c.blue + '44' },
  draftActionConserveText: { fontSize: 12, fontWeight: '700', color: c.blue },
  draftActionDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.danger + '18', borderWidth: 1, borderColor: c.danger + '44' },
  reservedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.blue + '22', borderWidth: 1, borderColor: c.blue },
  reservedBadgeText: { fontSize: 10, fontWeight: '700', color: c.blue },
  rowAccent: {
    position: 'absolute' as const,
    left: 0,
    top: 8,
    bottom: 8,
    width: 2.5,
    borderRadius: 1.5,
  },
  rowAccentIncome: { backgroundColor: c.green + '60' },
  rowAccentProject: { backgroundColor: c.teal + '60' },
  rowLeft: { flex: 1, marginRight: 10 },
  rowLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  projectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.teal,
    marginRight: 6,
  },
  rowLabel: { fontSize: 15, fontWeight: '600', color: c.text, flexShrink: 1 },
  rowMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: c.green },
  rowAmountNeg: { color: c.text },
  reservationBadge: {
    backgroundColor: c.teal + '18',
    borderWidth: 1,
    borderColor: c.teal + '40',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reservationText: {
    color: c.teal,
    fontSize: 12,
    fontWeight: '600',
  },
  empty: { padding: 24, color: c.textSecondary, textAlign: 'center' },
  futureToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 8, paddingVertical: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  futureToggleText: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  futureCard: { marginBottom: 8 },
  hint: { marginTop: 16, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  periodBtn: {
    padding: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginLeft: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtnActive: {
    backgroundColor: c.emerald,
    borderColor: c.emerald,
  },
  accountFilterScroll: {
    marginBottom: 12,
    height: 44,
    flexGrow: 0,
  },
  accountFilterContent: {
    alignItems: 'center',
  },
  accountFilterChip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginRight: 8,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountFilterChipActive: {
    backgroundColor: c.emerald,
    borderColor: c.emerald,
  },
  accountFilterChipText: {
    fontSize: 13,
    color: c.text,
    fontWeight: '500',
    textAlign: 'center',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  accountFilterChipTextActive: {
    color: c.bg,
    fontWeight: '600',
  },
  periodLabel: {
    flex: 1,
    alignItems: 'center',
  },
  periodText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  periodLabelHint: {
    fontSize: 11,
    color: c.emerald,
    marginTop: 2,
  },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, width: '100%', maxWidth: 340, padding: 20 },
  detailOverlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' },
  detailSheet: { ...sheetWidth, backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  detailHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.cardBorder, marginBottom: 14 },
  detailAmount: { fontSize: 26, fontWeight: '800', textAlign: 'center' },
  detailLabelText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginTop: 2 },
  detailDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 14 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  detailKey: { fontSize: 13.5, color: c.textSecondary },
  detailVal: { fontSize: 13.5, fontWeight: '600', color: c.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  detailReadOnly: { fontSize: 12, color: c.textSecondary, fontStyle: 'italic', textAlign: 'center', marginTop: 10 },
  detailCloseBtn: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
  detailCloseText: { fontSize: 15, fontWeight: '700', color: c.text },
  confirmTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
  confirmMessage: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmOkText: { fontSize: 14, fontWeight: '700' },
});
}
