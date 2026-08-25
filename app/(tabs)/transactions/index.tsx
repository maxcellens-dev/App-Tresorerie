import { useMemo, useState, useEffect, useRef } from 'react';
import PageLoader from '../../../components/layout/PageLoader';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, PanResponder, FlatList, TextInput } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import { useDeferredMount } from '../../../hooks/platform/useDeferredMount';
import OnboardingHintBanner from '../../../components/onboarding/OnboardingHintBanner';
import AdSlot from '../../../components/marketing/AdSlot';
import { useOnbHighlight, onbGlow } from '../../../lib/engagement/onbHighlight';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllTransactions, useUpdateTransaction, useDeleteTransaction, useValidateProjectDraft } from '../../../hooks/data/useTransactions';
import { useCreditFlows } from '../../../hooks/data/useCreditFlows';
import { useTransactionMonthOverrides } from '../../../hooks/data/useTransactionMonthOverrides';
import { buildOverrideMap, overrideKey as ovrKey } from '../../../lib/finance/txOverrides';
import { useCategories } from '../../../hooks/data/useCategories';
import { useSubCategoriesGrouped } from '../../../components/transaction/CategoryPicker';
import { useAllAccounts } from '../../../hooks/data/useAccounts';
import { useAccountParticipants, useAllParticipants, useAllMemberNames } from '../../../hooks/data/useSharedAccounts';
import { accountColor } from '../../../theme/colors';
import type { TransactionWithDetails } from '../../../types/database';
import GuideModal from '../../../components/guide/GuideModal';
import { useGuide } from '../../../contexts/GuideContext';
import { useIsFocused } from 'expo-router';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import RecurringTransactionsModal from '../../../components/transaction/RecurringTransactionsModal';
import { useAppColors } from '../../../hooks/theme/useAppColors';
// Plus de `CURRENCY_SYMBOL` ici : cette page raisonne PAR COMPTE, jamais en devise de référence.
import { currencySymbolFor } from '../../../lib/finance/currency';
import { isRegul, REGUL_CATEGORY_NAME } from '../../../lib/finance/regul';
// `todayISO` : la date du jour en heure LOCALE. Elle était recalculée à la main juste en dessous.
import { todayISO } from '../../../lib/dateUtils';
import { getMonthKey, getMonthsFromOffset } from '../../../lib/finance/treasuryTable';
import { addRecurrenceToMonth } from '../../../lib/finance/recurrence';
import { compareTransactionsForDisplay, getEffectiveDate } from '../../../lib/finance/txOrder';
import { sheetWidth, useSheetBottomPadding } from '../../../lib/ui/appLayout';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { hoverRow } from '../../../lib/ui/webLayout';
import { iconForTransaction, iconForCategory } from '../../../lib/ui/categoryIcons';
import { isProjectSpendTx } from '../../../lib/finance/projectTx';
import { useRwLinkedTransactionIds } from '../../../hooks/engagement/useRelykaWorld';
import { useReadOnlyGuard } from '../../../hooks/platform/useReadOnlyGuard';

// Les 3 boutons « Virement / Dépense / Recette » en haut de l'écran font doublon avec le bouton de
// saisie rapide (« + »), désormais présent ici aussi. On les masque, mais on garde le code : passer
// cette constante à `true` les rétablit tels quels.
const SHOW_TOP_ACTIONS = false;


/** Normalise pour une recherche insensible à la casse et aux accents. */
function normTxt(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * « 21 août » — date d'une ligne.
 *
 * ⚠️ `new Date('2026-08-21')` est parsé en UTC, puis rendu en heure LOCALE : dans tout fuseau à
 * l'OUEST de Greenwich, chaque date reculait donc d'un jour à l'affichage (Montréal, São Paulo,
 * Mexico… — des devises que l'app propose). On force la lecture en heure locale avec `T00:00:00`,
 * la convention déjà suivie ailleurs (cf. lib/finance/regul, Relyka World).
 */
function formatDate(dateStr: string) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatMonthHeader(year: number, month: number) {
  return new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/* `getMonthKey` et `getMonthsFromOffset` étaient RÉÉCRITS ici, alors qu'ils sont exportés par
   lib/finance/treasuryTable — et c'est de là que la Trésorerie les tient. Deux implémentations de
   la même fenêtre de mois, à garder synchronisées à la main, pour deux écrans qui doivent justement
   tomber d'accord sur le mois qu'ils affichent. La version de la lib prend en plus une horloge
   injectable, ce dont on se sert ci-dessous. (Import en haut de fichier.) */

/* `addRecurrenceToMonth` était RÉÉCRIT ici — une TROISIÈME copie de la fonction que
   lib/finance/recurrence dit justement avoir unifiée (son en-tête raconte les deux premières : le
   moteur du Pilotage et l'écran Trésorerie, « deux sources de vérité pour un même montant », qui
   pouvaient diverger sur la même ligne). Les deux versions étaient encore identiques ; la question
   n'était que de savoir laquelle des deux serait corrigée sans l'autre. On importe donc la lib —
   au passage, cet écran hérite de ses tests (__tests__/recurrence.test.ts). */

/* `getEffectiveDate` vit désormais dans lib/finance/txOrder, aux côtés du comparateur qui s'en sert
   (import en haut de fichier) : c'est un CALCUL de date, et il décide de la frontière passé /
   à venir — il devait être testable. */

// Élément de la liste APLATIE (FlatList) — un type par « brique » visuelle.
type TxListItem =
  | { t: 'ad'; placement: string; k: string }
  /* `future` : nb de transactions à venir du mois en cours. La bascule « À venir » vit SUR la ligne
     du libellé du mois (et non plus sur sa propre ligne) — une hauteur de moins à faire défiler. */
  | { t: 'monthHeader'; year: number; month: number; gap: boolean; future: number; k: string }
  | { t: 'row'; item: any; group: 'future' | 'past'; pos: number; groupCount: number; k: string }
  | { t: 'emptyPast'; k: string };

/** Montage différé (écran LOURD) : squelette 1 frame → l'onglet s'ouvre instantanément, la liste
 *  (3 mois projetés + récurrences) arrive juste après. Cf. hooks/useDeferredMount. */
export default function TransactionsListScreen() {
  return useDeferredMount() ? <TransactionsListBody /> : <PageLoader />;
}

function TransactionsListBody() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(28);
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
  /* Feuille « Filtres » : comptes ET sous-catégorie au même endroit. Les comptes s'affichaient
     avant dans une rangée de puces qui poussait la liste vers le bas, et la sous-catégorie n'était
     atteignable que par lien profond (depuis la Tréso) — impossible à choisir depuis cette page. */
  const [showFilters, setShowFilters] = useState(false);
  const [catQuery, setCatQuery] = useState('');
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


  // Consultation admin : cet écran ne doit rien écrire sur le compte visité (useReadOnlyGuard).
  const readOnly = useReadOnlyGuard();
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
  /* ── Nom et devise du compte d'une ligne ────────────────────────────────────────────────────
     ⚠️ Ne PAS lire `item.account` seul. Cette jointure manque sur plusieurs lignes parfaitement
     légitimes, qui s'affichaient alors sans aucun compte (juste « · 25 sept. ») :
       • les échéances de crédit, construites côté client (`mkFlow` ne pose que la devise) ;
       • une ligne fraîchement enregistrée sur un compte JOINT ou partagé, reconstituée depuis le
         cache des comptes PERSO — qui, par construction, ne les contient pas.
     `accountById` vient de `useAllAccounts` : c'est la liste complète des comptes accessibles, donc
     la source de vérité. La jointure ne sert plus que de repli. */
  const accountOf = (item: any) => accountById[item?.account_id] ?? item?.account ?? null;
  const accountNameOf = (item: any) => accountOf(item)?.name ?? '';
  const accountCurrencyOf = (item: any) => accountOf(item)?.currency ?? item?.account?.currency;
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
    // L'app TUTOIE partout : c'était « Vous » (affiché en clair sur chaque ligne d'un compte partagé).
    : (t?.profile_id === user?.id ? 'Toi' : (authorNameById[t?.profile_id] ?? 'Un membre'));
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

  /* ⚠️ `now` DOIT être stable d'un rendu à l'autre.
     Il valait `new Date()` à chaque rendu, et il figure dans les dépendances du memo qui déplie les
     récurrences : cette dépendance changeait donc TOUJOURS, et le memo ne mémoïsait rien. Toute la
     chaîne derrière (filtrage, regroupement par mois, construction de la liste) se rejouait alors
     à chaque frappe dans la recherche de catégories, à chaque bascule de filtre, à chaque rendu —
     sur plusieurs centaines d'opérations dépliées sur trois mois.
     On l'ancre sur le JOUR : la date reste fraîche au passage de minuit (c'est la seule granularité
     dont ces calculs ont besoin — l'horizon des récurrences se compte en mois), mais elle ne bouge
     plus pendant une session de tri. */
  const todayStr = todayISO();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [todayStr]);
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
  /* Horloge passée EXPLICITEMENT : la fenêtre de mois se déduit d'« aujourd'hui », et la version
     locale lisait `new Date()` en interne — l'app laissée ouverte au passage de minuit le 1ᵉʳ du
     mois continuait d'afficher la fenêtre de la veille jusqu'à ce qu'on change de période. */
  const displayMonths = useMemo(
    () => getMonthsFromOffset(periodOffset, displayMonthCount, now),
    [periodOffset, displayMonthCount, now],
  );

  // Source unique de la lecture des overrides (montant, date, libellé, catégorie, compte).
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);

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
          const ovr = overrideMap[ovrKey(t.id, m.year, m.month)];
          const finalAmount = ovr && ovr.amount != null ? ovr.amount : appliedAmount;
          if (Math.abs(finalAmount) > 0) {
            /* Instance de la transaction pour ce mois. Une échéance peut être modifiée POUR CE MOIS
               SEULEMENT : montant, date (#2), et depuis la migration 163 libellé / catégorie /
               compte. `category` et `account` (objets joints) sont vidés quand l'id change, sinon
               la ligne afficherait l'ancien nom sous le nouvel identifiant. */
            result.push({
              ...t,
              displayDate: getMonthKey(m.year, m.month),
              amount: finalAmount,
              ...(ovr?.date ? { date: ovr.date } : {}),
              ...(ovr?.note != null ? { note: ovr.note } : {}),
              ...(ovr?.categoryId != null ? { category_id: ovr.categoryId, category: null } : {}),
              ...(ovr?.accountId != null ? { account_id: ovr.accountId, account: null } : {}),
            } as TransactionWithDetails & { displayDate?: string });
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
  // Sous-catégories groupées par catégorie parente — même source et même ordre que les écrans de
  // saisie (« Mouvements » exclu : ces virements internes ne se filtrent pas par catégorie).
  const expenseGroups = useSubCategoriesGrouped(categories, 'expense');
  const incomeGroups = useSubCategoriesGrouped(categories, 'income');
  const catSections = useMemo(
    () => [
      { key: 'expense', label: 'Dépenses', groups: expenseGroups },
      { key: 'income', label: 'Recettes', groups: incomeGroups },
    ].filter((s) => s.groups.length > 0),
    [expenseGroups, incomeGroups]
  );
  // Recherche dans la feuille de filtres : un parent reste visible si son nom correspond, sinon
  // seuls ses enfants correspondants sont gardés.
  const catSectionsFiltered = useMemo(() => {
    const q = normTxt(catQuery);
    if (!q) return catSections;
    return catSections
      .map((s) => ({
        ...s,
        groups: s.groups
          .map((g) => (normTxt(g.parentName).includes(q) ? g : { ...g, children: g.children.filter((c) => normTxt(c.name).includes(q)) }))
          .filter((g) => g.children.length > 0),
      }))
      .filter((s) => s.groups.length > 0);
  }, [catSections, catQuery]);


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
          /* Les régularisations À LA BAISSE sont rangées sous « Frais variables › Régularisation
             Solde » (cf. lib/finance/regul) : filtrer sur le parent doit donc aussi ramener les
             anciennes, qui n'ont pas de catégorie du tout.
             ⚠️ Le parent était reconnu par son NOM écrit en dur. Or ce référentiel est éditable en
             admin ET renommable par l'utilisateur (`user_renamed`) : au premier renommage, les
             régularisations disparaissaient silencieusement de ce filtre. On se base donc sur la
             présence de la sous-catégorie de régul PARMI ses enfants — un fait, pas un libellé. */
          const hasRegulChild = categories.some(
            (c) => c.parent_id === selectedCategory.id
              && c.name.trim().toLowerCase() === REGUL_CATEGORY_NAME.toLowerCase(),
          );
          list = list.filter((t) =>
            !outOfCategories(t) &&
            (
              (t.category_id && allIdsToFilter.includes(t.category_id)) ||
              (hasRegulChild && !t.category_id && isRegul(t as any))
            )
          );
        } else {
          list = list.filter((t) => !outOfCategories(t) && t.category_id === categoryFilterId);
        }
      }
    }
    /* Filtre Régularisation solde — via `isRegul`, la définition UNIQUE (lib/finance/regul).
       Le test posé ici (`note` commençant par « Régularisation ») était l'une de ces détections
       ad hoc que `isRegul` a justement été créé pour remplacer : il ignorait le marqueur de
       référence `regul_target`, et laissait donc échapper toute régularisation dont la note ne
       commence pas par ce mot — alors qu'elle en est une pour tout le reste de l'app. */
    if (regulFilter) {
      list = list.filter((t) => isRegul(t as any));
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
    /* Comparateur PARTAGÉ (lib/finance/txOrder) — il était recopié ici, alors que le détail d'un
       compte l'importait déjà. Deux listes de transactions, deux copies du même ordre à maintenir. */
    for (const arr of Object.values(map)) arr.sort(compareTransactionsForDisplay);
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
  // visibles sont rendues). On reproduit fidèlement la structure : en-tête de mois (porteur de la
  // bascule « À venir » repliable), cartes de lignes (rayons haut/bas par groupe), pub inter-mois,
  // placeholders. ──
  const listData = useMemo(() => {
    const out: TxListItem[] = [];
    byMonth.forEach(({ key, year, month, items }, monthIndex) => {
      const isCurrentMonth = key === currentMonthKey;
      const pastItems = isCurrentMonth ? items.filter((it) => getEffectiveDate(it) <= todayStr) : items;
      const futureItems = isCurrentMonth ? items.filter((it) => getEffectiveDate(it) > todayStr) : [];
      if (monthIndex === 1) out.push({ t: 'ad', placement: 'transactions_mois', k: 'ad-mois' });
      out.push({ t: 'monthHeader', year, month, gap: monthIndex > 0, future: futureItems.length, k: `mh-${key}` });
      if (isCurrentMonth && futureItems.length > 0 && showFutureThisMonth) {
        futureItems.forEach((item, i) =>
          out.push({ t: 'row', item, group: 'future', pos: i, groupCount: futureItems.length, k: `f-${item.id}-${(item as any).displayDate || ''}` }));
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
  // Pastille du bouton « Filtres » : ce que l'utilisateur a posé lui-même (la sélection de comptes
  // par défaut n'est pas un filtre — sinon le bouton serait allumé en permanence).
  const activeFilterCount = (isManualFilter ? 1 : 0) + (categoryFilterId ? 1 : 0);
  /** Retour à l'état par défaut : mes comptes courants, aucune sous-catégorie. */
  const resetFilters = () => {
    setAccountFilterIds(defaultCheckingIds);
    setCategoryFilterId(null);
    setCatQuery('');
  };
  // La recherche n'est qu'une aide à la sélection : elle ne survit pas à la fermeture (sinon on
  // rouvre la feuille sur une liste tronquée sans se souvenir pourquoi).
  const closeFilters = () => { setShowFilters(false); setCatQuery(''); };
  
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
    if (readOnly.blocked()) return;
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
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de valider.', confirmLabel: 'OK', confirmColor: COLORS.textSecondary, onConfirm: () => {} });
        }
      },
    });
  }

  function confirmDeleteDraft(item: TransactionWithDetails) {
    if (readOnly.blocked()) return;
    const label = item.note || item.category?.name || 'ce brouillon';
    showConfirm({
      title: 'Supprimer le brouillon',
      message: `Supprimer "${label}" ?`,
      confirmLabel: 'Supprimer',
      confirmColor: COLORS.danger,
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de supprimer.', confirmLabel: 'OK', confirmColor: COLORS.textSecondary, onConfirm: () => {} });
        }
      },
    });
  }

  // Conserver un brouillon de projet : le marque « Réservé » (pas de dépense validée),
  // son montant alimente la ligne Réservé du Pilotage jusqu'à utilisation/libération.
  function confirmConserveDraft(item: TransactionWithDetails) {
    if (readOnly.blocked()) return;
    const label = item.note || item.category?.name || 'ce montant';
    const montant = Math.abs(Number(item.amount));
    showConfirm({
      title: 'Conserver pour plus tard',
      /* Devise du COMPTE de l'opération, pas la devise de référence : ce montant est celui de la
         ligne qu'on a sous les yeux. `maximumFractionDigits` est explicite — sans lui, la valeur
         par défaut (3) laissait passer une 3ᵉ décimale sur un montant qui n'en a que deux. */
      message: `Mettre ${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbolFor(accountCurrencyOf(item))} de "${label}" en Réservé ? Le montant n'est pas dépensé mais mis de côté et visible dans la ligne Réservé du Pilotage.`,
      confirmLabel: 'Conserver',
      confirmColor: COLORS.blue,
      onConfirm: async () => {
        try {
          await updateTx.mutateAsync({ id: item.id, is_reserved: true });
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de conserver.', confirmLabel: 'OK', confirmColor: COLORS.textSecondary, onConfirm: () => {} });
        }
      },
    });
  }

  // Libérer une réservation depuis la liste : supprime le brouillon réservé.
  function confirmLiberateReserved(item: TransactionWithDetails) {
    if (readOnly.blocked()) return;
    const label = item.note || item.category?.name || 'ce montant';
    showConfirm({
      title: 'Libérer la réservation',
      message: `Libérer "${label}" ? Le brouillon réservé sera supprimé et le montant retiré du Réservé.`,
      confirmLabel: 'Libérer',
      confirmColor: COLORS.danger,
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de libérer.', confirmLabel: 'OK', confirmColor: COLORS.textSecondary, onConfirm: () => {} });
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
    /* TROIS SIGNES, PAS UN SEUL.
       Ne reconnaître une transaction de projet qu'au `project_id` (projets perso) ou au set
       `rwTxIds` (projets partagés) laissait la moitié des dépenses partagées en noir : ce set vient
       d'une requête SÉPARÉE, qui n'a pas encore répondu au premier rendu — et qui ne couvre que les
       lignes dont on est l'auteur. La CATÉGORIE, elle, est déjà là, chargée avec la transaction :
       c'est d'ailleurs sur elle que se fonde le détail d'un compte, qui n'a jamais eu ce défaut.
       On garde les trois : le project_id est le plus sûr, la catégorie couvre tout de suite le
       reste, et rwTxIds rattrape les projets partagés sans catégorie « Projets ». */
    const isProject = !!item.project_id
      || (rwTxIds?.has(item.id) ?? false)
      || item.category?.name === 'Projets';
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
      /* #2 — une mensualité de crédit renvoie au CRÉDIT, pas à l'éditeur de transaction : elle est
         le reflet du tableau d'amortissement, et toute modification faite ici serait de toute façon
         réécrite au prochain réalignement (resync_credit_materialized).
         Vaut pour le flux à venir (`is_credit_flow`) comme pour l'échéance déjà prélevée, qui est
         une VRAIE transaction porteuse de `credit_id` — celle-ci ouvrait jusqu'ici l'éditeur
         ordinaire, où la correction saisie disparaissait sans explication quelques jours plus tard.
         Le n° d'échéance suit, pour arriver directement sur la bonne ligne. */
      const creditId = (item as any).credit_id;
      if (creditId && ((item as any).is_credit_flow || (item as any).credit_period != null)) {
        const period = (item as any).credit_period;
        router.push(`/(tabs)/comptes/credit/${creditId}${period != null ? `?period=${period}` : ''}` as any);
        return;
      }
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
                {/* Transaction de PROJET (perso ou partagé) = libellé écrit en BLEU, comme dans
                    l'onglet Transactions d'une page de compte. La pastille qui tenait ce rôle
                    manquait sur une partie des dépenses de projets partagés (elle dépendait d'un
                    second chargement), et deux signalétiques pour la même notion à deux endroits de
                    l'app, c'en était une de trop. */}
                <Text style={[styles.rowLabel, isProject && styles.rowLabelProject, isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft]} numberOfLines={1}>
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
                {accountNameOf(item)} · {formatDate(effectiveDate)}{isSharedAcct ? ` - par ${authorLabel(item)}` : ''}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg, { textAlign: 'right' }]}>
              {amt > 0 ? '+' : ''}{amt.toFixed(2)} {currencySymbolFor(accountCurrencyOf(item))}
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
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer" style={styles.draftActionDelete} onPress={() => confirmDeleteDraft(item)} activeOpacity={0.7}>
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
            {isSharedAcct && <View style={[styles.projectDot, { backgroundColor: COLORS.textSecondary }]} />}
            <Text style={[styles.rowLabel, isProject && styles.rowLabelProject, isDraft && (isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft)]} numberOfLines={1}>
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
            {accountNameOf(item)} · {formatDate(effectiveDate)}{isSharedAcct ? ` - par ${authorLabel(item)}` : ''}
          </Text>
        </View>
        {isReservation ? (
          <View style={styles.reservationBadge}>
            <Text style={styles.reservationText}>Réservé</Text>
          </View>
        ) : (
          <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg]}>
            {amt > 0 ? '+' : ''}{amt.toFixed(2)} {currencySymbolFor(accountCurrencyOf(item))}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // renderItem de la FlatList : chaque « brique » (pub, en-tête de mois + bascule « À venir », ligne, vide).
  const renderListItem = ({ item: li }: { item: TxListItem }) => {
    switch (li.t) {
      case 'ad':
        return <AdSlot placement={li.placement as any} />;
      case 'monthHeader':
        return (
          <View style={[styles.monthHeader, li.gap && { marginTop: 16 }]}>
            <Text style={styles.monthHeaderText}>{formatMonthHeader(li.year, li.month)}</Text>
            {li.future > 0 && (
              <TouchableOpacity style={styles.futureToggle} onPress={() => setShowFutureThisMonth((v) => !v)} activeOpacity={0.7} accessibilityRole="button">
                <Text style={styles.futureToggleText}>À venir ({li.future})</Text>
                <Ionicons name={showFutureThisMonth ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Période précédente"
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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Période suivante"
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
            {/* Un seul bouton pour les DEUX filtres (comptes + sous-catégorie). La pastille compte
                les filtres réellement posés — la sélection de comptes par défaut n'en est pas un. */}
            <TouchableOpacity
              ref={filterBtnRef}
              style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
              onPress={() => (showFilters ? closeFilters() : setShowFilters(true))}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Filtrer les transactions"
            >
              <Ionicons name="filter" size={18} color={activeFilterCount > 0 ? COLORS.bg : COLORS.textSecondary} />
              {/* Compteur DANS le bouton (et non en pastille débordante) : le bandeau de période a
                  un rayon de bordure, une pastille qui dépasse se fait rogner sur Android. */}
              {activeFilterCount > 0 && <Text style={styles.filterCountText}>{activeFilterCount}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Panneau « Filtres » : comptes (multi-sélection) + sous-catégorie (une seule) ──
            Déplié SUR PLACE, juste sous la ligne de période — pas en feuille venue du bas : on
            garde sous les yeux le mois affiché et la liste qu'on est en train de filtrer.
            Les deux filtres se combinent : « Alimentation › Courses » sur « Tous » les comptes
            donne bien toutes les courses, où qu'elles aient été payées. */}
        {showFilters && (
          <View style={styles.filterPanel}>
            <View style={styles.filterPanelHead}>
              <Text style={styles.filterPanelTitle}>Filtres</Text>
              <View style={styles.filterPanelHeadActions}>
                {activeFilterCount > 0 && (
                  <TouchableOpacity onPress={resetFilters} hitSlop={8}>
                    <Text style={styles.filterResetText}>Tout effacer</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={closeFilters} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer les filtres">
                  <Ionicons name="close" size={19} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.filterSectionTitle}>Comptes</Text>
            <View style={styles.filterChipsWrap}>
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
            </View>

            <Text style={styles.filterSectionTitle}>Sous-catégorie</Text>
            {catSections.length === 0 ? (
              <Text style={styles.filterEmptyText}>Aucune sous-catégorie. Ajoutes-en dans Catégories.</Text>
            ) : (
              <>
                <View style={styles.filterSearchRow}>
                  <Ionicons name="search" size={15} color={COLORS.textSecondary} />
                  <TextInput
                    style={styles.filterSearchInput}
                    value={catQuery}
                    onChangeText={setCatQuery}
                    placeholder="Rechercher une sous-catégorie…"
                    placeholderTextColor={COLORS.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {catQuery.length > 0 && (
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setCatQuery('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={17} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={styles.filterCatList} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
                  <TouchableOpacity
                    style={[styles.filterCatRow, !categoryFilterId && styles.filterCatRowActive]}
                    onPress={() => setCategoryFilterId(null)}
                  >
                    <Text style={[styles.filterCatText, !categoryFilterId && styles.filterCatTextActive]}>Toutes</Text>
                  </TouchableOpacity>
                  {catSectionsFiltered.length === 0 && (
                    <Text style={styles.filterEmptyText}>Aucun résultat pour « {catQuery} ».</Text>
                  )}
                  {catSectionsFiltered.map((section) => (
                    <View key={section.key}>
                      <Text style={styles.filterCatKind}>{section.label}</Text>
                      {section.groups.map((group) => (
                        <View key={group.parentId}>
                          <Text style={styles.filterCatParent}>{group.parentName}</Text>
                          {group.children.map((cat) => {
                            const active = categoryFilterId === cat.id;
                            return (
                              <TouchableOpacity
                                key={cat.id}
                                style={[styles.filterCatRow, styles.filterCatRowChild, active && styles.filterCatRowActive]}
                                onPress={() => setCategoryFilterId(active ? null : cat.id)}
                              >
                                <Ionicons name={iconForCategory(cat) as any} size={15} color={active ? COLORS.emerald : COLORS.textSecondary} />
                                <Text style={[styles.filterCatText, active && styles.filterCatTextActive]} numberOfLines={1}>{cat.name}</Text>
                                {active && <Ionicons name="checkmark" size={16} color={COLORS.emerald} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            <TouchableOpacity style={styles.filterDoneBtn} onPress={closeFilters} activeOpacity={0.85}>
              <Text style={styles.filterDoneText}>
                {filtered.length === 0 ? 'Aucune transaction' : `Voir ${filtered.length} transaction${filtered.length > 1 ? 's' : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
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
            <TouchableOpacity style={[styles.detailSheet, { paddingBottom: sheetPad }]} activeOpacity={1} onPress={() => {}}>
              {detailTx && (() => {
                const amt = Number(detailTx.amount);
                const inc = amt >= 0;
                // L'app TUTOIE partout : c'était « Vous ».
                const author = detailTx.profile_id === user?.id ? 'Toi' : (detailParticipants.find((p) => p.user_id === detailTx.profile_id)?.display_name ?? 'Un membre');
                const sym = currencySymbolFor(accountCurrencyOf(detailTx));
                const lbl = detailTx.note?.trim() || detailTx.category?.name || 'Transaction';
                const rows: [string, string][] = [
                  // `T00:00:00` : lecture en heure LOCALE (cf. `formatDate`), sinon la date recule
                  // d'un jour à l'ouest de Greenwich.
                  ['Date', new Date(`${String(detailTx.date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
                  ['Montant', `${inc ? '+' : '−'} ${Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sym}`],
                  ['Compte', accountNameOf(detailTx)],
                  ['Par', author],
                ];
                if (detailTx.category?.name) rows.push(['Catégorie', detailTx.category.name]);
                return (
                  <>
                    <View style={styles.detailHandle} />
                    <Text style={[styles.detailAmount, { color: inc ? COLORS.green : COLORS.danger }]}>{inc ? '+' : '−'} {Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {sym}</Text>
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
  // Libellé du mois à gauche, bascule « À venir » à droite : les deux partagent la même ligne.
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
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
  /* Transaction de PROJET (personnel ou partagé) : le libellé passe en bleu — même signalétique que
     l'onglet Transactions d'une page de compte, où une écriture « Projets » est déjà écrite ainsi. */
  rowLabelProject: { color: c.blue },
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
  // Zone tactile élargie sans hauteur ajoutée : le padding déborde sur celui de l'en-tête.
  futureToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingLeft: 8, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  filterCountText: { fontSize: 11.5, fontWeight: '800', color: c.onAccent, includeFontPadding: false },
  // ── Panneau « Filtres » (déplié sur place, sous la ligne de période) ──
  filterPanel: {
    backgroundColor: c.card,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    marginBottom: 12,
  },
  filterPanelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  filterPanelHeadActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  filterPanelTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  filterResetText: { fontSize: 13, fontWeight: '600', color: c.emerald },
  filterSectionTitle: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  // Les puces de comptes s'enroulent (plutôt qu'un défilement horizontal) : dans une feuille, on
  // voit ainsi d'un coup d'œil tous les comptes sélectionnés.
  filterChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  filterSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
    paddingHorizontal: 12, height: 40, marginBottom: 8,
  },
  filterSearchInput: {
    flex: 1, fontSize: 13.5, color: c.text, paddingVertical: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  // Hauteur plafonnée + défilement interne : le panneau pousse la liste des transactions vers le
  // bas, il ne doit jamais la chasser entièrement de l'écran.
  filterCatList: { maxHeight: 220, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10 },
  filterCatKind: { fontSize: 11, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
  filterCatParent: { fontSize: 12, fontWeight: '700', color: c.text, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  filterCatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
  filterCatRowChild: { paddingLeft: 20 },
  filterCatRowActive: { backgroundColor: c.emerald + '1A' },
  filterCatText: { flex: 1, fontSize: 13.5, color: c.text },
  filterCatTextActive: { color: c.emerald, fontWeight: '700' },
  filterEmptyText: { fontSize: 12.5, color: c.textSecondary, paddingHorizontal: 12, paddingVertical: 10 },
  filterDoneBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  filterDoneText: { fontSize: 14.5, fontWeight: '800', color: c.onAccent },
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
    color: c.onAccent,
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
