import { useMemo, useState, useEffect } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Alert,
  Modal,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import CalendarWithPicker from '../../../components/transaction/CalendarWithPicker';
import { iconForCategory, VIREMENT_ICON } from '../../../lib/ui/categoryIcons';
import { formatDateFrench, todayISO } from '../../../lib/dateUtils';
import { sheetWidth, useSheetBottomPadding } from '../../../lib/ui/appLayout';
import { compareTransactionsForDisplay, isRegulRow } from '../../../lib/finance/txOrder';
import { findRegulCategoryId } from '../../../lib/finance/regul';
import { useCategories } from '../../../hooks/data/useCategories';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts, useUpdateAccount } from '../../../hooks/data/useAccounts';
import { useAccountParticipants, useAccountMembers } from '../../../hooks/data/useSharedAccounts';
import { useAllTransactions, useAddTransaction, TX_FETCH_LIMIT } from '../../../hooks/data/useTransactions';
import { useTransactionMonthOverrides } from '../../../hooks/data/useTransactionMonthOverrides';
import { useCreditFlows } from '../../../hooks/data/useCreditFlows';
import { buildOverrideMap, applyMonthOverrides, overrideKey } from '../../../lib/finance/txOverrides';
import { recurrenceOccurrencesInMonth } from '../../../lib/finance/recurrenceMonth';
import { computeContributed } from '../../../lib/finance/contributed';
import type { TransactionWithDetails } from '../../../types/database';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { currencySymbolFor } from '../../../lib/finance/currency';
import { INVESTMENT_GAIN_NOTE, INVESTMENT_LOSS_NOTE, isInvestmentGainLossNote } from '../../../lib/finance/investment';
import { useRecalibrateReliability } from '../../../hooks/pilotage/useReliability';
import BalanceChart from '../../../components/charts/BalanceChart';
import AccountSettingsForm from '../../../components/account/AccountSettingsForm';
import PageLoader from '../../../components/layout/PageLoader';
import { buildBalanceHistory } from '../../../lib/finance/balanceHistory';
import KeyboardAwareOverlay from '../../../components/layout/KeyboardAwareOverlay';


/** Les trois façons de regarder un compte. Une seule à la fois : la fiche empilait tout. */
type AccountTab = 'solde' | 'transactions' | 'parametres';

const TABS: Array<{ id: AccountTab; label: string; icon: string }> = [
  { id: 'solde', label: 'Solde', icon: 'stats-chart-outline' },
  { id: 'transactions', label: 'Transactions', icon: 'list-outline' },
  { id: 'parametres', label: 'Paramètres', icon: 'settings-outline' },
];

const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

const VIREMENT_NOTE = 'Virement interne';

function isTransferNote(note: string | null): boolean {
  return note === VIREMENT_NOTE || (note != null && note.trim().toLowerCase().startsWith('virement'));
}

/**
 * INDEX DES JAMBES DE VIREMENT — construit UNE fois, interrogé en temps constant.
 *
 * Retrouver la jambe symétrique (même note + date + montant opposé, sur un autre compte, sans
 * catégorie) se faisait par un balayage de TOUTES les transactions, et deux fois par ligne affichée
 * (une pour savoir si c'en est un, une pour retrouver le compte d'en face). Sur un compte fourni,
 * c'est quadratique : l'écran ramait à l'ouverture et à chaque « charger 3 mois de plus ».
 *
 * La clé de recherche est exactement le critère d'appariement — date, note, et montant ARRONDI au
 * centime (la tolérance de 0,01 € d'origine ; les montants viennent d'une colonne numeric, pas de
 * dérive flottante à absorber au-delà). On indexe donc par `date|note|montant`, et une jambe se
 * cherche à la clé du montant OPPOSÉ.
 */
type TransferIndex = Map<string, TransactionWithDetails[]>;

const legKey = (date: string, cents: number) => `${date}|${cents}`;
const centsOf = (amount: number | string) => Math.round(Number(amount) * 100);

/** Regroupe les lignes SANS catégorie (seules candidates) par date + montant au centime. */
function buildTransferIndex(allTx: TransactionWithDetails[]): TransferIndex {
  const index: TransferIndex = new Map();
  for (const t of allTx) {
    if (t.category_id != null) continue;
    const key = legKey(t.date, centsOf(t.amount));
    const bucket = index.get(key);
    if (bucket) bucket.push(t); else index.set(key, [t]);
  }
  return index;
}

/** Lignes du montant OPPOSÉ, même date, sur un AUTRE compte — le vivier d'une jambe symétrique. */
function oppositeLegs(t: TransactionWithDetails, index: TransferIndex, currentAccountId: string) {
  return (index.get(legKey(t.date, -centsOf(t.amount))) ?? [])
    .filter((p) => p.id !== t.id && p.account_id !== currentAccountId);
}

/** Jambe symétrique STRICTE (même libellé) : sert à reconnaître un virement non nommé « Virement ». */
function findSymmetricTx(
  t: TransactionWithDetails,
  index: TransferIndex,
  currentAccountId: string,
): TransactionWithDetails | null {
  if (!t.note || t.category_id != null) return null;
  return oppositeLegs(t, index, currentAccountId).find((p) => p.note === t.note) ?? null;
}

function AccountDetailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const { width: screenWidth } = useWindowDimensions();
  const modalStyles = makeModalStyles(COLORS);
  const txDetailStyles = makeTxDetailStyles(COLORS);
  /** Onglet courant. « Solde » d'abord : c'est la question qu'on se pose en ouvrant un compte. */
  const [tab, setTab] = useState<AccountTab>('solde');
  // Feuilles du bas : marge basse incluant la barre de navigation Android (cf. useSheetBottomPadding).
  const sheetPad = useSheetBottomPadding(36);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; verify?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  // Catégories du profil : sert à ranger la régularisation selon son sens (cf. lib/regul).
  const { data: categories = [] } = useCategories(user?.id);
  const accountsQuery = useAllAccounts(user?.id);
  const accounts = accountsQuery.data ?? [];
  const { data: rawTransactions = [], isLoading: txLoading } = useAllTransactions(user?.id);
  // Une échéance modifiée « pour ce mois seulement » vit dans transaction_month_overrides, pas dans
  // la ligne : sans ça, la fiche du compte affichait l'ancien montant d'une transaction que la page
  // Transactions montrait déjà modifiée (même transaction, deux valeurs).
  const { data: overrides = [] } = useTransactionMonthOverrides(user?.id);
  const overrideMap = useMemo(() => buildOverrideMap(overrides), [overrides]);
  const transactions = useMemo(
    () => applyMonthOverrides(rawTransactions as TransactionWithDetails[], overrideMap),
    [rawTransactions, overrideMap],
  );
  // Échéances de crédit FUTURES : ce ne sont pas des lignes en base tant qu'elles ne sont pas échues
  // (matérialisation, migration 143) → sans elles, un prélèvement de crédit du 28 n'apparaissait
  // nulle part sur la fiche du compte. Vue COMPTE → montant RÉEL, non pondéré par le % d'impact.
  const creditFlows = useCreditFlows(user?.id, false);
  const addTransaction = useAddTransaction(user?.id);
  const updateAccount = useUpdateAccount(user?.id);
  const recalibrate = useRecalibrateReliability(user?.id);

  const account = accounts.find((a) => a.id === id);

  // Compte partagé/joint : on identifie l'AUTEUR de chaque transaction (sans exposer les comptes
  // personnels des autres membres). isSharedView = joint, OU compte reçu d'un autre utilisateur.
  const isSharedView = !!(account as any)?.is_joint || (!!account && account._role !== 'owner');
  const { data: participants = [] } = useAccountParticipants(isSharedView ? id : undefined);
  const { data: acctMembers = [] } = useAccountMembers(isSharedView ? id : undefined);
  const nameByUser = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of participants) m[p.user_id] = p.display_name;
    return m;
  }, [participants]);
  const nameByMember = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mm of acctMembers) m[mm.id] = mm.display_name;
    return m;
  }, [acctMembers]);
  // #4bis — une opération « au nom de » un membre (on_behalf_member_id) est attribuée à ce membre.
  const authorOf = (t: any): string =>
    (t?.on_behalf_member_id && nameByMember[t.on_behalf_member_id]) ? nameByMember[t.on_behalf_member_id]
    // L'app TUTOIE partout : c'était « Vous », affiché sur chaque ligne d'un compte partagé.
    : (t?.profile_id === user?.id ? 'Toi' : (nameByUser[t?.profile_id] ?? 'Un membre'));

  const [showOnBehalf, setShowOnBehalf] = useState(false);
  const [showApport, setShowApport] = useState(false);
  const [apportAmount, setApportAmount] = useState('');
  const [apportNote, setApportNote] = useState('Apport');
  const [apportLoading, setApportLoading] = useState(false);
  const [apportDate, setApportDate] = useState(todayISO());
  const [apportDateDisplay, setApportDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showApportCalendar, setShowApportCalendar] = useState(false);
  const [apportBase, setApportBase] = useState('');
  const [apportBaseDirty, setApportBaseDirty] = useState(false);

  const [showBalance, setShowBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceNote, setBalanceNote] = useState('Régularisation solde');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceDate, setBalanceDate] = useState(todayISO());
  const [balanceDateDisplay, setBalanceDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showBalanceCalendar, setShowBalanceCalendar] = useState(false);

  // On garde l'ID, pas la ligne : une copie figée dans le state continuait d'afficher l'ancien
  // montant après une modification (le cache se rafraîchit, pas le snapshot).
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const selectedTx = useMemo(
    () => (selectedTxId ? transactions.find((t) => t.id === selectedTxId) ?? null : null),
    [transactions, selectedTxId],
  );

  // Historique paginé : on n'affiche que les N derniers mois, « Charger plus » en ajoute 3.
  // La liste n'est pas virtualisée et chaque ligne cherche sa jambe symétrique de virement dans
  // TOUTES les transactions (O(n²)) : sur un compte ancien, tout afficher d'un coup faisait ramer
  // l'écran à l'ouverture. Remis à 3 dès qu'on change de compte.
  const MONTHS_STEP = 3;
  const [monthsShown, setMonthsShown] = useState(MONTHS_STEP);
  useEffect(() => { setMonthsShown(MONTHS_STEP); }, [id]);

  // Deeplink « Vérifie ton solde » (bandeau prochain geste) : ?verify=1 ouvre directement le modal
  // Nouveau Solde — le user n'a plus qu'à saisir le montant (~10 s réels).
  useEffect(() => {
    if (params.verify === '1' && account?.type === 'checking') {
      setShowBalance(true);
      setBalanceInput('');
      setBalanceNote('Régularisation solde');
      const today = todayISO();
      setBalanceDate(today);
      setBalanceDateDisplay(formatDateFrench(today));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.verify, account?.id]);

  const [showGainLoss, setShowGainLoss] = useState(false);
  const [gainLossMode, setGainLossMode] = useState<'amount' | 'balance'>('balance');
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [gainLossAmount, setGainLossAmount] = useState('');
  const [gainLossBalance, setGainLossBalance] = useState('');
  const [gainLossNote, setGainLossNote] = useState(INVESTMENT_GAIN_NOTE);
  const [gainLossLoading, setGainLossLoading] = useState(false);
  const [gainLossDate, setGainLossDate] = useState(todayISO());
  const [gainLossDateDisplay, setGainLossDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showGainLossCalendar, setShowGainLossCalendar] = useState(false);
  const [isLoss, setIsLoss] = useState(false);

  // Intérêts (comptes épargne)
  const [showInterest, setShowInterest] = useState(false);
  const [interestMode, setInterestMode] = useState<'amount' | 'balance'>('amount');
  const [showInterestMethodPicker, setShowInterestMethodPicker] = useState(false);
  const [interestAmount, setInterestAmount] = useState('');
  const [interestBalance, setInterestBalance] = useState('');
  const [interestNote, setInterestNote] = useState('Intérêts');
  const [interestDate, setInterestDate] = useState(todayISO());
  const [interestDateDisplay, setInterestDateDisplay] = useState(formatDateFrench(todayISO()));
  const [showInterestCalendar, setShowInterestCalendar] = useState(false);
  const [interestLoading, setInterestLoading] = useState(false);

  async function handleBalance() {
    const newBalance = parseFloat(balanceInput.replace(',', '.'));
    if (Number.isNaN(newBalance)) {
      Alert.alert('Solde invalide', 'Saisis un solde valide.');
      return;
    }
    if (!account || !id || !user?.id) return;
    const diff = newBalance - balanceAtDate;
    // Écart 0 = le user CONFIRME son solde → c'est une vraie VÉRIFICATION (ancre écart 0) :
    // elle calibre sa dérive vers 0 et fait remonter la confiance. On ne la refuse plus.
    setBalanceLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        // Rangée selon son sens : « Frais variables › Régularisation Solde » si le solde baisse,
        // « Autres recettes › Régularisation Solde » s'il monte (cf. lib/regul).
        category_id: findRegulCategoryId(categories, diff),
        amount: diff,
        date: balanceDate,
        note: balanceNote.trim() || 'Ajustement de solde',
        is_recurring: false,
        regul_target: newBalance, // solde cible saisi → affiché sur la ligne de régul
      });
      // Vérification effectuée → recalibrer la dérive du user (silencieux, non bloquant).
      recalibrate.mutate();
      setShowBalance(false);
      setBalanceInput('');
      setBalanceNote('');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
    } finally {
      setBalanceLoading(false);
    }
  }

  async function handleApport() {
    const num = parseFloat(apportAmount.replace(',', '.'));
    if (Number.isNaN(num) || num <= 0) {
      Alert.alert('Montant invalide', 'Saisis un montant positif.');
      return;
    }
    if (!id || !user?.id) return;
    setApportLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: num,
        date: apportDate,
        note: apportNote.trim() || 'Apport',
        is_recurring: false,
        checkRegulConflict: true,
      });
      // L'apport « actuel » est dérivé des transactions (computeContributed) → rien à mettre à jour ici.
      setShowApport(false);
      setApportAmount('');
      setApportNote('Apport');
      setApportDate(todayISO());
      setApportDateDisplay(formatDateFrench(todayISO()));
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setApportLoading(false);
    }
  }

  // Apport à la création (capital de base) — éditable. L'apport actuel en est dérivé.
  useEffect(() => {
    if (account?.type === 'investment' && !apportBaseDirty) {
      setApportBase(account.initial_contributed != null ? String(Math.round(account.initial_contributed)) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.initial_contributed, account?.type]);

  // Apport actuel = dérivé des transactions (apports/virements − retraits au prorata).
  const apportActuel = account ? computeContributed(account, transactions as any) : null;

  async function saveApportBase() {
    if (!id) return;
    const v = parseFloat(apportBase.replace(',', '.'));
    if (Number.isNaN(v)) { Alert.alert('Montant invalide', 'Saisis un montant valide.'); return; }
    try {
      await updateAccount.mutateAsync({ id, current_contributed: v, initial_contributed: v } as any);
      setApportBaseDirty(false);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    }
  }

  async function handleGainLoss() {
    let num: number;
    if (gainLossMode === 'amount') {
      num = parseFloat(gainLossAmount.replace(',', '.'));
      if (Number.isNaN(num) || num <= 0) {
        Alert.alert('Montant invalide', 'Saisis un montant positif.');
        return;
      }
      num = isLoss ? -Math.abs(num) : Math.abs(num);
    } else {
      const balance = parseFloat(gainLossBalance.replace(',', '.'));
      if (Number.isNaN(balance)) {
        Alert.alert('Solde invalide', 'Saisis un solde final valide.');
        return;
      }
      if (!account) {
        Alert.alert('Compte introuvable', 'Impossible de calculer le solde.');
        return;
      }
      num = balance - Number(account.balance);
      if (num === 0) {
        Alert.alert('Aucune variation', 'Le solde est identique au solde actuel.');
        return;
      }
    }

    if (!id || !user?.id) return;
    setGainLossLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: num,
        date: gainLossDate,
        note: gainLossNote.trim() || (num < 0 ? INVESTMENT_LOSS_NOTE : INVESTMENT_GAIN_NOTE),
        is_recurring: false,
        checkRegulConflict: true,
      });
      setShowGainLoss(false);
      setGainLossAmount('');
      setGainLossBalance('');
      setGainLossMode('balance');
      setIsLoss(false);
      setGainLossNote(INVESTMENT_GAIN_NOTE);
      setGainLossDate(todayISO());
      setGainLossDateDisplay(formatDateFrench(todayISO()));
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setGainLossLoading(false);
    }
  }

  async function handleInterest() {
    let num: number;
    if (interestMode === 'amount') {
      num = parseFloat(interestAmount.replace(',', '.'));
      if (Number.isNaN(num) || num === 0) {
        Alert.alert('Montant invalide', 'Saisis un montant.');
        return;
      }
      num = Math.abs(num); // les intérêts sont toujours crédités
    } else {
      const balance = parseFloat(interestBalance.replace(',', '.'));
      if (Number.isNaN(balance)) {
        Alert.alert('Solde invalide', 'Saisis un solde final valide.');
        return;
      }
      if (!account) {
        Alert.alert('Compte introuvable', 'Impossible de calculer le solde.');
        return;
      }
      num = balance - Number(account.balance);
      if (num === 0) {
        Alert.alert('Aucune variation', 'Le solde est identique au solde actuel.');
        return;
      }
    }

    if (!id || !user?.id) return;
    setInterestLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: num,
        date: interestDate,
        note: interestNote.trim() || 'Intérêts',
        is_recurring: false,
        checkRegulConflict: true,
      });
      setShowInterest(false);
      setInterestAmount('');
      setInterestBalance('');
      setInterestMode('amount');
      setInterestNote('Intérêts');
      setInterestDate(todayISO());
      setInterestDateDisplay(formatDateFrench(todayISO()));
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setInterestLoading(false);
    }
  }

  const balanceAtDate = useMemo(() => {
    if (!id) return account ? Number(account.balance) : 0;
    // Le solde du compte ne reflète QUE le passé (transactions échues ≤ aujourd'hui).
    // Pour remonter à la date de référence, on ne retire donc que les transactions
    // réellement portées au solde, c.-à-d. comprises entre la date de réf. et aujourd'hui.
    // (Les transactions FUTURES ne sont pas dans le solde → ne pas les réintégrer.)
    const today = todayISO();
    const afterDate = (transactions as TransactionWithDetails[]).filter(
      (t) => t.account_id === id && !(t as any).is_draft && !(t as any).is_recurring
        && t.date > balanceDate && t.date <= today
    );
    const sumAfter = afterDate.reduce((s, t) => s + Number(t.amount), 0);
    return (account ? Number(account.balance) : 0) - sumAfter;
  }, [id, transactions, balanceDate, account]);

  const accountTransactions = useMemo(() => {
    if (!id) return [];
    const today = todayISO();
    const allTx = transactions as TransactionWithDetails[];
    // Les échéances de crédit échues sont de VRAIES lignes (matérialisation, migration 143) → elles
    // arrivent naturellement ici via useAllTransactions, comme toute transaction du compte.
    return allTx
      .filter((t) => t.account_id === id && !(t as any).is_draft && t.date <= today)
      .sort(compareTransactionsForDisplay);
  }, [id, transactions]);

  /* À VENIR CE MOIS — les opérations de ce compte datées APRÈS aujourd'hui mais encore dans le
     mois courant. L'historique s'arrête volontairement à aujourd'hui (il raconte ce qui s'est
     passé) : sans ce bloc, une échéance déjà saisie pour le 28 n'apparaissait NULLE PART sur la
     fiche du compte, alors qu'elle va bel et bien sortir. */
  const upcomingThisMonth = useMemo(() => {
    const today = todayISO();
    const monthPrefix = today.slice(0, 7);
    const year = Number(monthPrefix.slice(0, 4));
    const month = Number(monthPrefix.slice(5, 7));
    const all = ((transactions as TransactionWithDetails[]) ?? []);
    const inWindow = (d?: string | null) => !!d && d > today && d.startsWith(monthPrefix);

    // 1) Lignes RÉELLES déjà datées après aujourd'hui. Un modèle récurrent à jour en fait partie :
    //    la matérialisation l'ancre sur sa prochaine occurrence non échue.
    const rows: any[] = all.filter((t) => t.account_id === id && !(t as any).is_draft && inWindow(t.date));

    // 2) Récurrentes que la matérialisation n'a PAS avancées : `materialize_due_recurring` ne tourne
    //    que pour le propriétaire du modèle. Sur un compte JOINT, le prélèvement d'un co-titulaire
    //    qui n'a pas ouvert l'app reste ancré dans le passé → son échéance du mois n'apparaissait
    //    nulle part. On la projette, sauf si une occurrence de ce mois est déjà matérialisée.
    const materializedThisMonth = new Set(
      all.filter((t) => (t as any).materialized_from && (t.date ?? '').startsWith(monthPrefix))
        .map((t) => (t as any).materialized_from as string),
    );
    for (const t of all) {
      if (t.account_id !== id || !(t as any).is_recurring || !(t as any).recurrence_rule) continue;
      if (inWindow(t.date) || materializedThisMonth.has(t.id)) continue; // déjà couvert par une ligne réelle
      const ovr = overrideMap[overrideKey(t.id, year, month)];
      const amount = ovr?.amount != null ? Number(ovr.amount) : Number(t.amount);
      if (!amount) continue;
      for (const occ of recurrenceOccurrencesInMonth(t as any, year, month)) {
        const date = ovr?.date || occ;
        if (date <= today || !date.startsWith(monthPrefix)) continue;
        rows.push({ ...(t as any), amount, date, _virtual: true, instance_month: monthPrefix });
      }
    }

    // 3) Échéances de crédit à venir (virtuelles jusqu'à leur date, cf. useCreditFlows).
    for (const f of creditFlows) {
      if (f.account_id === id && inWindow(f.date)) rows.push({ ...f, _virtual: true });
    }

    return rows.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''));
  }, [id, transactions, creditFlows, overrideMap]);
  const upcomingTotal = useMemo(
    () => upcomingThisMonth.reduce((sum, t) => sum + Number(t.amount), 0),
    [upcomingThisMonth],
  );
  /** Bascule « à venir » : la liste montre alors ce qui reste à passer, au lieu de l'historique. */
  const [showUpcoming, setShowUpcoming] = useState(false);

  /* ÉVOLUTION DU SOLDE — remontée à rebours depuis le solde du jour (cf. lib/balanceHistory) : la
     courbe finit donc EXACTEMENT sur le chiffre affiché juste au-dessus d'elle. */
  /* Jusqu'où l'historique chargé est-il COMPLET ? La liste des opérations est bornée à 500 lignes
     (useAllTransactions) : si on en a exactement autant, il en manque avant la plus ancienne, et
     remonter au-delà donnerait des soldes passés faux — mais crédibles. On borne donc la courbe. */
  const completeSince = useMemo(() => {
    const all = transactions as TransactionWithDetails[];
    if (all.length < TX_FETCH_LIMIT) return null;                 // rien n'a été tronqué
    return all.reduce((min, t) => (t.date < min ? t.date : min), all[0].date);
  }, [transactions]);

  const balanceHistory = useMemo(
    () => (account && id
      ? buildBalanceHistory(
          id, Number(account.balance), transactions as any, todayISO(),
          (account as any).init_date ?? null, completeSince,
        )
      : []),
    [id, account, transactions, completeSince],
  );
  /* Index des jambes de virement, construit UNE fois par jeu de transactions (cf. buildTransferIndex) :
     l'appariement se faisait ligne par ligne sur TOUTE la liste, deux fois — quadratique. */
  const transferIndex = useMemo(
    () => buildTransferIndex(transactions as TransactionWithDetails[]),
    [transactions],
  );

  /** Largeur utile de la courbe : la colonne d'écran moins ses marges (20 de chaque côté + carte). */
  const chartWidth = Math.max(220, Math.min(isDesktop ? 640 : screenWidth, 640) - 40 - 28);

  // Fenêtre affichée : les `monthsShown` derniers MOIS CALENDAIRES (mois courant inclus).
  // On borne par mois plutôt que par nombre de lignes pour que « charger plus » ait un sens lisible
  // (« depuis avril 2026 ») quel que soit le rythme de saisie de l'utilisateur.
  const { visibleTransactions, hasMoreHistory, historySince } = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - (monthsShown - 1), 1);
    const cutoff = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    const visible = accountTransactions.filter((t) => (t.date ?? '') >= cutoff);
    return {
      visibleTransactions: visible,
      hasMoreHistory: visible.length < accountTransactions.length,
      historySince: from.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    };
  }, [accountTransactions, monthsShown]);

  /* PAS ENCORE CHARGÉ ≠ INTROUVABLE. Tant que la liste des comptes est en vol, on montre la
     coquille de chargement plutôt qu'un « Chargement… » posé sur un écran nu. Et on ne conclut à
     l'absence que si la requête a RÉELLEMENT abouti : une lecture en erreur rend elle aussi une
     liste vide, en déduire « ce compte n'existe pas » serait faux. */
  if (!user || !account) {
    if (!accountsQuery.isSuccess) return <PageLoader />;
    return (
      <View style={styles.root}>
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]}>
          <ScreenHeader title="Compte" onBack={() => router.back()} />
          <Text style={styles.text}>Ce compte n’existe plus.</Text>
        </SafeAreaView>
      </View>
    );
  }

  // Toutes les valeurs de cet écran sont dans la devise DU COMPTE (le solde et ses transactions
  // sont mono-devise). On affiche donc le symbole de la devise du compte partout ici.
  const CURRENCY_SYMBOL = currencySymbolFor((account as any).currency);

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={[]}>
        <ScreenHeader title={account.name} onBack={() => router.back()} />

        {/* TROIS FAÇONS DE REGARDER UN COMPTE, une seule à la fois. La fiche empilait tout —
            actions, solde, historique — et envoyait sur un AUTRE écran pour le moindre réglage.
            Les réglages sont donc devenus un onglet : plus de bouton « Modifier » en en-tête. */}
        <View style={styles.tabBar}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setTab(t.id)}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Ionicons name={t.icon as any} size={15} color={active ? COLORS.bg : COLORS.textSecondary} />
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}>

        {tab === 'solde' && (<>
        {/* LE SOLDE, EN UNE LIGNE. Le libellé « Solde » au-dessus et le type en dessous encadraient
            le chiffre de deux lignes de texte pour ne rien apprendre : l'onglet dit déjà « Solde »,
            et le type tient dans une pastille à côté du montant. */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit>
              {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
            </Text>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{TYPE_LABELS[account.type] ?? account.type}</Text>
            </View>
          </View>

          {/* L'ÉVOLUTION depuis l'ouverture, sous le chiffre auquel elle aboutit. Un compte sans
              mouvement échu n'a pas d'histoire : on ne trace pas une ligne plate pour faire joli. */}
          {balanceHistory.length >= 2 && (
            <View style={styles.chartWrap}>
              <BalanceChart
                points={balanceHistory}
                width={chartWidth}
                color={account.type === 'investment' ? COLORS.violet : account.type === 'savings' ? COLORS.green : COLORS.blue}
              />
              {/* La légende ne promet PAS « depuis l'ouverture » : sur un compte fourni, la courbe
                  démarre au plus ancien mouvement connu (cf. completeSince). Les mois sont lisibles
                  sous l'axe — inutile d'y ajouter une affirmation qu'on ne peut pas toujours tenir. */}
              <Text style={styles.chartCaption}>Évolution du solde</Text>
            </View>
          )}
        </View>

          {/* Actions d'écriture masquées pour un membre en consultation (rôle read).
              Tuiles de LARGEUR ÉGALE : la rangée de boutons-pilules de largeurs différentes se
              cassait en deux lignes bancales dès qu'il y en avait trois. */}
          {account._role !== 'read' && (
          <View style={styles.actionRow}>
            {account.type === 'checking' ? (
              <TouchableOpacity
                style={styles.actionTile}
                onPress={() => { setShowBalance(true); setBalanceInput(''); setBalanceNote('Régularisation solde'); const today = todayISO(); setBalanceDate(today); setBalanceDateDisplay(formatDateFrench(today)); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Nouveau solde"
              >
                <View style={[styles.actionIcon, { backgroundColor: COLORS.blue + '1F' }]}>
                  <Ionicons name="wallet-outline" size={19} color={COLORS.blue} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>Nouveau solde</Text>
              </TouchableOpacity>
            ) : null}
            {account.type === 'investment' ? (
              <TouchableOpacity
                style={styles.actionTile}
                onPress={() => { setShowGainLoss(true); setShowMethodPicker(false); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Plus / moins value"
              >
                <View style={[styles.actionIcon, { backgroundColor: COLORS.violet + '1F' }]}>
                  <Ionicons name="trending-up-outline" size={19} color={COLORS.violet} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>+/− value</Text>
              </TouchableOpacity>
            ) : null}
            {account.type === 'savings' ? (
              <TouchableOpacity
                style={styles.actionTile}
                onPress={() => { setShowInterest(true); setShowInterestMethodPicker(false); const today = todayISO(); setInterestDate(today); setInterestDateDisplay(formatDateFrench(today)); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Intérêts"
              >
                <View style={[styles.actionIcon, { backgroundColor: COLORS.green + '1F' }]}>
                  <Ionicons name="cash-outline" size={19} color={COLORS.green} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>Intérêts</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.actionTile}
              onPress={() => setShowApport(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Apport"
            >
              <View style={[styles.actionIcon, { backgroundColor: COLORS.orange + '1F' }]}>
                <Ionicons name="add-circle-outline" size={19} color={COLORS.orange} />
              </View>
              <Text style={styles.actionLabel} numberOfLines={1}>Apport</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionTile}
              onPress={() => router.push(`/(tabs)/comptes/transfer?from=${id}`)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Virement"
            >
              <View style={[styles.actionIcon, { backgroundColor: COLORS.emerald + '1F' }]}>
                <Ionicons name="swap-horizontal" size={19} color={COLORS.emerald} />
              </View>
              <Text style={styles.actionLabel} numberOfLines={1}>Virement</Text>
            </TouchableOpacity>
            {/* #4bis — compte joint : saisir une opération « au nom de » un membre non-user (simuler sa participation). */}
            {!!(account as any).is_joint && acctMembers.some((m) => !m.user_id) && (
              <TouchableOpacity
                style={styles.actionTile}
                onPress={() => setShowOnBehalf(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Au nom d'un membre"
              >
                <View style={[styles.actionIcon, { backgroundColor: COLORS.blue + '1F' }]}>
                  <Ionicons name="people-circle-outline" size={19} color={COLORS.blue} />
                </View>
                <Text style={styles.actionLabel} numberOfLines={1}>Au nom de…</Text>
              </TouchableOpacity>
            )}
          </View>
          )}

        {/* Première ouverture d'un compte courant vierge → inviter à renseigner le solde à date */}
        {account.type === 'checking' && Number(account.balance) === 0 && accountTransactions.length === 0 && (
          <TouchableOpacity
            style={styles.setupBanner}
            onPress={() => { setShowBalance(true); setBalanceInput(''); setBalanceNote('Régularisation solde'); const today = todayISO(); setBalanceDate(today); setBalanceDateDisplay(formatDateFrench(today)); }}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Ionicons name="information-circle" size={22} color={COLORS.blue} />
            <View style={{ flex: 1 }}>
              <Text style={styles.setupBannerTitle}>Renseigne ton solde pour bien démarrer</Text>
              <Text style={styles.setupBannerText}>Appuyez ici pour saisir le solde réel de ce compte à aujourd'hui.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}

        {account.type === 'investment' && (
          <View style={styles.apportCard}>
            <View style={styles.apportRow}>
              <Text style={styles.apportLabel}>Apport à la création</Text>
              <View style={styles.apportEditRow}>
                <TextInput
                  style={styles.apportInput}
                  value={apportBase}
                  onChangeText={(v) => { setApportBase(v.replace(/[^0-9.,-]/g, '')); setApportBaseDirty(true); }}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={styles.apportCur}>{CURRENCY_SYMBOL}</Text>
                {apportBaseDirty && (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Valider l'apport" style={styles.apportSave} onPress={saveApportBase}>
                    <Ionicons name="checkmark" size={16} color={COLORS.bg} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.apportRow}>
              <Text style={styles.apportLabel}>Apport actuel</Text>
              <Text style={styles.apportValueRO}>
                {apportActuel != null ? apportActuel.toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL : '—'}
              </Text>
            </View>
            <Text style={styles.apportHint}>L'apport actuel (repris dans la Projection) est calculé automatiquement : apport de création + apports/virements entrants − part de capital retirée au prorata lors des retraits.</Text>
          </View>
        )}
        </>)}

        {tab === 'transactions' && (<>
        {/* À VENIR CE MOIS — même geste que sur la liste des transactions : un bouton qui bascule
            la liste sur ce qui n'est pas encore passé. Posé AU-DESSUS de l'historique, puisqu'il
            parle du futur proche et que l'historique, lui, remonte le temps. */}
        {upcomingThisMonth.length > 0 && (
          <TouchableOpacity
            style={[styles.upcomingBtn, showUpcoming && styles.upcomingBtnActive]}
            onPress={() => setShowUpcoming((v) => !v)}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Ionicons name="time-outline" size={16} color={showUpcoming ? COLORS.bg : COLORS.textSecondary} />
            <Text style={[styles.upcomingLabel, showUpcoming && { color: COLORS.bg }]}>
              À venir ce mois ({upcomingThisMonth.length})
            </Text>
            <Text style={[styles.upcomingAmount, showUpcoming && { color: COLORS.bg }]}>
              {upcomingTotal > 0 ? '+' : ''}{Math.round(upcomingTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
            </Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>
          {showUpcoming ? 'À venir ce mois' : 'Historique des transactions'}
        </Text>
        {txLoading ? (
          <ActivityIndicator size="small" color={COLORS.emerald} style={styles.loader} />
        ) : (showUpcoming ? upcomingThisMonth : accountTransactions).length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>
              {showUpcoming ? 'Plus rien à venir ce mois sur ce compte.' : 'Aucune transaction sur ce compte.'}
            </Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {(showUpcoming ? upcomingThisMonth : visibleTransactions).map((t, idx) => {
              const amount = Number(t.amount);
              // Ligne PROJETÉE (échéance de crédit ou récurrente pas encore matérialisée) : aucune
              // ligne réelle derrière → pas d'appariement de virement, et le détail n'a rien à ouvrir.
              const isVirtual = !!(t as any)._virtual;
              const creditId = (t as any).credit_id as string | undefined;
              const isTransfer = !isVirtual && t.category_id == null && (isTransferNote(t.note ?? null) || !!findSymmetricTx(t, transferIndex, id));
              // Compte d'en face : critère plus LARGE que l'appariement strict (le libellé des deux
              // jambes peut différer dès lors que l'une s'annonce comme un virement).
              const pair = isTransfer
                ? (oppositeLegs(t, transferIndex, id)
                    .find((p) => isTransferNote(p.note ?? null) || p.note === t.note) ?? null)
                : null;
              // Confidentialité : si le compte d'en face n'est pas accessible (compte perso d'un autre
              // membre), on n'affiche PAS son nom → libellé générique « compte de {auteur} ».
              const counterpartName = pair ? (accounts.find((a) => a.id === pair.account_id)?.name ?? null) : null;
              const otherAccountName = counterpartName ?? (isSharedView ? `compte de ${authorOf(t)}` : 'Compte');
              const label = isTransfer
                ? (isTransferNote(t.note ?? null)
                    ? (amount > 0 ? `Depuis ${otherAccountName}` : `Vers ${otherAccountName}`)
                    : (t.note?.trim() || (amount > 0 ? `Depuis ${otherAccountName}` : `Vers ${otherAccountName}`)))
                : t.note?.trim() || t.category?.name || 'Transaction';
              return (
                <TouchableOpacity
                  key={`${t.id}-${idx}`}
                  style={[styles.transferRow, idx === (showUpcoming ? upcomingThisMonth : visibleTransactions).length - 1 && styles.transferRowLast]}
                  onPress={() => {
                    if (creditId) { router.push(`/(tabs)/comptes/credit/${creditId}` as any); return; }
                    if (!isVirtual) setSelectedTxId(t.id);
                  }}
                  disabled={isVirtual && !creditId}
                  activeOpacity={0.7}
                >
                  <Ionicons name={(isTransfer ? VIREMENT_ICON : iconForCategory(t.category)) as any} size={16} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                  <View style={styles.transferLeft}>
                    <Text style={styles.transferDate}>
                      {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {isSharedView && !creditId ? ` - par ${authorOf(t)}` : ''}
                    </Text>
                    <Text style={[styles.transferLabel, t.category?.name === 'Projets' && { color: COLORS.blue }]}>{label}</Text>
                    {isRegulRow(t) && (t as any).regul_target != null && (
                      <Text style={styles.regulTarget}>
                        → solde {Number((t as any).regul_target).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                      </Text>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.transferAmount,
                      amount >= 0 ? styles.transferAmountIn : styles.transferAmountOut,
                    ]}
                  >
                    {amount >= 0 ? '+' : '−'} {Math.abs(amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Pagination de l'historique — la période affichée est nommée, pour que l'utilisateur
            sache qu'il ne manque rien : c'est masqué, pas absent. */}
        {!txLoading && !showUpcoming && accountTransactions.length > 0 && (
          <View style={styles.historyFooter}>
            <Text style={styles.historyRange}>
              {`${visibleTransactions.length} opération${visibleTransactions.length > 1 ? 's' : ''} depuis ${historySince}`}
            </Text>
            {hasMoreHistory && (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                onPress={() => setMonthsShown((m) => m + MONTHS_STEP)}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-down" size={16} color={COLORS.emerald} />
                <Text style={styles.loadMoreText}>Charger 3 mois de plus</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        </>)}

        {/* PARAMÈTRES — le même formulaire que la route « Modifier le compte », posé ici : renommer
            un compte ne fait plus changer d'écran, et seul le bouton « Enregistrer » subsiste. */}
        {tab === 'parametres' && <AccountSettingsForm account={account} />}
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* ── Solde modal ── */}
      <Modal visible={showBalance} transparent animationType="fade" onRequestClose={() => setShowBalance(false)}>
        <KeyboardAwareOverlay style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <Text style={modalStyles.title}>Ajuster le solde</Text>

            <Text style={modalStyles.label}>Date de référence</Text>
            <TouchableOpacity
              style={[modalStyles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }]}
              onPress={() => setShowBalanceCalendar(true)}
              activeOpacity={0.8}
            >
              <Text style={{ color: COLORS.text, fontSize: 16 }}>{balanceDateDisplay}</Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.emerald} />
            </TouchableOpacity>
            <Text style={[modalStyles.helperText, { marginBottom: 14 }]}>
              Le solde calculé tient compte des transactions jusqu'à cette date.
            </Text>
            <View style={modalStyles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={COLORS.blue} style={{ marginTop: 1 }} />
              <Text style={modalStyles.infoText}>
                Cette date devient une référence : une transaction ajoutée plus tard avec une date antérieure ne modifiera pas ce solde (il a déjà été constaté ici).
              </Text>
            </View>

            <Text style={modalStyles.label}>Solde calculé à cette date</Text>
            <View style={modalStyles.readOnlyInput}>
              <Text style={modalStyles.readOnlyText}>
                {balanceAtDate.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
              </Text>
            </View>

            <Text style={modalStyles.label}>Solde réel à cette date</Text>
            <TextInput
              style={modalStyles.input}
              value={balanceInput}
              onChangeText={setBalanceInput}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={COLORS.textSecondary}
              autoFocus
            />
            <Text style={modalStyles.helperText}>
              {(() => {
                const v = parseFloat(balanceInput.replace(',', '.'));
                if (Number.isNaN(v)) return 'Saisis le solde réel relevé sur ta banque.';
                const diff = v - balanceAtDate;
                /* Comparaison au CENTIME, pas à l'égalité stricte : c'est une soustraction de
                   flottants, et retaper exactement le solde affiché pouvait laisser un résidu de
                   l'ordre de 1e-13 — l'écran annonçait alors « + 0,00 € seront ajoutés » au lieu
                   de « Aucune variation ». Même seuil (0,005) que partout ailleurs dans l'app. */
                if (Math.abs(diff) < 0.005) return 'Aucune variation.';
                const abs = Math.abs(diff).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                return diff > 0
                  ? `+ ${abs} ${CURRENCY_SYMBOL} seront ajoutés`
                  : `− ${abs} ${CURRENCY_SYMBOL} seront retirés`;
              })()}
            </Text>

            <Text style={modalStyles.label}>Libellé</Text>
            <TextInput
              style={modalStyles.input}
              value={balanceNote}
              onChangeText={setBalanceNote}
              placeholder="Ex. Relevé bancaire..."
              placeholderTextColor={COLORS.textSecondary}
            />

            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancel} onPress={() => setShowBalance(false)} activeOpacity={0.7}>
                <Text style={modalStyles.cancelLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.confirm, { backgroundColor: COLORS.blue }, balanceLoading && { opacity: 0.5 }]}
                onPress={handleBalance}
                disabled={balanceLoading}
                activeOpacity={0.8}
              >
                {balanceLoading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={modalStyles.confirmLabel}>Valider</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* ── Calendrier pour le solde ── */}
      <Modal visible={showBalanceCalendar} transparent animationType="fade" onRequestClose={() => setShowBalanceCalendar(false)}>
        <Pressable style={modalStyles.overlay} onPress={() => setShowBalanceCalendar(false)}>
          <Pressable style={[modalStyles.container, { padding: 8 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <Text style={modalStyles.title}>Date de référence</Text>
              <TouchableOpacity onPress={() => setShowBalanceCalendar(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={balanceDate}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setBalanceDate(day.dateString);
                setBalanceDateDisplay(formatDateFrench(day.dateString));
                setShowBalanceCalendar(false);
              }}
              markedDates={balanceDate ? { [balanceDate]: { selected: true, selectedColor: COLORS.blue, selectedTextColor: '#000' } } : {}}
              accentColor="#60a5fa"
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor="#334155"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Apport modal ── */}
      <Modal visible={showApport} transparent animationType="fade" onRequestClose={() => setShowApport(false)}>
        <KeyboardAwareOverlay style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <Text style={modalStyles.title}>Apport</Text>

            <Text style={modalStyles.label}>Montant</Text>
            <TextInput
              style={modalStyles.input}
              value={apportAmount}
              onChangeText={setApportAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.textSecondary}
              autoFocus
            />

            <Text style={modalStyles.label}>Date</Text>
            <TouchableOpacity
              style={[modalStyles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }]}
              onPress={() => setShowApportCalendar(true)}
              activeOpacity={0.8}
            >
              <Text style={{ color: COLORS.text, fontSize: 16 }}>{apportDateDisplay}</Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.emerald} />
            </TouchableOpacity>

            <Text style={modalStyles.label}>Note (optionnel)</Text>
            <TextInput
              style={modalStyles.input}
              value={apportNote}
              onChangeText={setApportNote}
              placeholder="Apport"
              placeholderTextColor={COLORS.textSecondary}
            />

            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancel} onPress={() => setShowApport(false)} activeOpacity={0.7}>
                <Text style={modalStyles.cancelLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.confirm, apportLoading && { opacity: 0.5 }]}
                onPress={handleApport}
                disabled={apportLoading}
                activeOpacity={0.8}
              >
                {apportLoading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={modalStyles.confirmLabel}>Valider</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* #4bis — picker : choisir le membre non-user au nom duquel saisir l'opération sur le compte joint. */}
      <Modal visible={showOnBehalf} transparent animationType="fade" onRequestClose={() => setShowOnBehalf(false)}>
        <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={() => setShowOnBehalf(false)}>
          <TouchableOpacity style={modalStyles.container} activeOpacity={1} onPress={() => {}}>
            <Text style={modalStyles.title}>Saisir au nom de…</Text>
            <Text style={[modalStyles.label, { marginBottom: 12 }]}>Choisis le membre dont tu veux simuler la participation (virement, recette ou dépense sur ce compte).</Text>
            {acctMembers.filter((m) => !m.user_id).map((m) => (
              <TouchableOpacity
                key={m.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.cardBorder }}
                onPress={() => {
                  setShowOnBehalf(false);
                  router.push(`/(tabs)/transactions/add?account=${id}&on_behalf=${m.id}&on_behalf_name=${encodeURIComponent(m.display_name)}` as any);
                }}
              >
                <Ionicons name="person-circle-outline" size={22} color={COLORS.blue} />
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text }}>{m.display_name}</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showGainLoss} transparent animationType="fade" onRequestClose={() => {
        setShowGainLoss(false);
        setShowMethodPicker(false);
      }}>
        <KeyboardAwareOverlay style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <Text style={modalStyles.title}>Plus / moins-value</Text>

            <Text style={modalStyles.sectionLabel}>Méthode de saisie</Text>
            <TouchableOpacity
              style={modalStyles.dropdownField}
              onPress={() => setShowMethodPicker((value) => !value)}
              activeOpacity={0.8}
            >
              <Text style={modalStyles.dropdownText}>{gainLossMode === 'amount' ? 'Montant' : 'Nouveau Solde'}</Text>
              <Ionicons name={showMethodPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {showMethodPicker ? (
              <View style={modalStyles.dropdownOptions}>
                <TouchableOpacity
                  style={modalStyles.dropdownOption}
                  onPress={() => {
                    setGainLossMode('amount');
                    setShowMethodPicker(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={modalStyles.dropdownOptionLabel}>Montant</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={modalStyles.dropdownOption}
                  onPress={() => {
                    setGainLossMode('balance');
                    setShowMethodPicker(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={modalStyles.dropdownOptionLabel}>Nouveau Solde</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {gainLossMode === 'amount' ? (
              <>
                <Text style={modalStyles.sectionLabel}>Type</Text>
                <View style={modalStyles.toggleRow}>
                  <TouchableOpacity
                    style={[modalStyles.toggleBtn, !isLoss && modalStyles.toggleBtnActive]}
                    onPress={() => {
                      setIsLoss(false);
                      setGainLossNote(INVESTMENT_GAIN_NOTE);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[modalStyles.toggleLabel, !isLoss && modalStyles.toggleLabelActive]}>Plus-value</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[modalStyles.toggleBtn, isLoss && modalStyles.toggleBtnActive]}
                    onPress={() => {
                      setIsLoss(true);
                      setGainLossNote(INVESTMENT_LOSS_NOTE);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[modalStyles.toggleLabel, isLoss && modalStyles.toggleLabelActive]}>Moins-value</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {gainLossMode === 'amount' ? (
              <>
                <Text style={modalStyles.label}>Montant</Text>
                <TextInput
                  style={modalStyles.input}
                  value={gainLossAmount}
                  onChangeText={setGainLossAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={modalStyles.helperText}>Entrez la plus/moins-value à ajouter au compte.</Text>
              </>
            ) : (
              <>
                <Text style={modalStyles.label}>Solde actuel</Text>
                <View style={modalStyles.readOnlyInput}>
                  <Text style={modalStyles.readOnlyText}>
                    {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                </View>
                <Text style={modalStyles.label}>Nouveau solde</Text>
                <TextInput
                  style={modalStyles.input}
                  value={gainLossBalance}
                  onChangeText={setGainLossBalance}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textSecondary}
                  autoFocus
                />
                <Text style={modalStyles.helperText}>La plus/moins-value est calculée automatiquement à partir du nouveau solde.</Text>
              </>
            )}

            <Text style={modalStyles.label}>Date</Text>
            <TouchableOpacity
              style={[modalStyles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }]}
              onPress={() => setShowGainLossCalendar(true)}
              activeOpacity={0.8}
            >
              <Text style={{ color: COLORS.text, fontSize: 16 }}>{gainLossDateDisplay}</Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.emerald} />
            </TouchableOpacity>

            <Text style={modalStyles.label}>Note (optionnel)</Text>
            <TextInput
              style={modalStyles.input}
              value={gainLossNote}
              onChangeText={setGainLossNote}
              placeholder={isLoss ? INVESTMENT_LOSS_NOTE : INVESTMENT_GAIN_NOTE}
              placeholderTextColor={COLORS.textSecondary}
            />

            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancel} onPress={() => {
                setShowGainLoss(false);
                setShowMethodPicker(false);
              }} activeOpacity={0.7}>
                <Text style={modalStyles.cancelLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.confirm, gainLossLoading && { opacity: 0.5 }]}
                onPress={handleGainLoss}
                disabled={gainLossLoading}
                activeOpacity={0.8}
              >
                {gainLossLoading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={modalStyles.confirmLabel}>Valider</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* ── Calendrier Apport ── */}
      <Modal visible={showApportCalendar} transparent animationType="fade" onRequestClose={() => setShowApportCalendar(false)}>
        <Pressable style={modalStyles.overlay} onPress={() => setShowApportCalendar(false)}>
          <Pressable style={[modalStyles.container, { padding: 8 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <Text style={modalStyles.title}>Date de l'apport</Text>
              <TouchableOpacity onPress={() => setShowApportCalendar(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={apportDate}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setApportDate(day.dateString);
                setApportDateDisplay(formatDateFrench(day.dateString));
                setShowApportCalendar(false);
              }}
              markedDates={apportDate ? { [apportDate]: { selected: true, selectedColor: COLORS.emerald, selectedTextColor: '#000' } } : {}}
              accentColor={COLORS.emerald}
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor="#334155"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Calendrier +/- value ── */}
      <Modal visible={showGainLossCalendar} transparent animationType="fade" onRequestClose={() => setShowGainLossCalendar(false)}>
        <Pressable style={modalStyles.overlay} onPress={() => setShowGainLossCalendar(false)}>
          <Pressable style={[modalStyles.container, { padding: 8 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <Text style={modalStyles.title}>Date de la +/- value</Text>
              <TouchableOpacity onPress={() => setShowGainLossCalendar(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={gainLossDate}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setGainLossDate(day.dateString);
                setGainLossDateDisplay(formatDateFrench(day.dateString));
                setShowGainLossCalendar(false);
              }}
              markedDates={gainLossDate ? { [gainLossDate]: { selected: true, selectedColor: COLORS.violet, selectedTextColor: '#000' } } : {}}
              accentColor="#a78bfa"
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor="#334155"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Intérêts modal (comptes épargne) ── */}
      <Modal visible={showInterest} transparent animationType="fade" onRequestClose={() => { setShowInterest(false); setShowInterestMethodPicker(false); }}>
        <KeyboardAwareOverlay style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <Text style={modalStyles.title}>Intérêts</Text>

            <Text style={modalStyles.sectionLabel}>Méthode de saisie</Text>
            <TouchableOpacity
              style={modalStyles.dropdownField}
              onPress={() => setShowInterestMethodPicker((v) => !v)}
              activeOpacity={0.8}
            >
              <Text style={modalStyles.dropdownText}>{interestMode === 'amount' ? 'Montant' : 'Nouveau Solde'}</Text>
              <Ionicons name={showInterestMethodPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {showInterestMethodPicker ? (
              <View style={modalStyles.dropdownOptions}>
                <TouchableOpacity style={modalStyles.dropdownOption} onPress={() => { setInterestMode('amount'); setShowInterestMethodPicker(false); }} activeOpacity={0.8}>
                  <Text style={modalStyles.dropdownOptionLabel}>Montant</Text>
                </TouchableOpacity>
                <TouchableOpacity style={modalStyles.dropdownOption} onPress={() => { setInterestMode('balance'); setShowInterestMethodPicker(false); }} activeOpacity={0.8}>
                  <Text style={modalStyles.dropdownOptionLabel}>Nouveau Solde</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {interestMode === 'amount' ? (
              <>
                <Text style={modalStyles.label}>Montant des intérêts</Text>
                <TextInput
                  style={modalStyles.input}
                  value={interestAmount}
                  onChangeText={setInterestAmount}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={modalStyles.helperText}>Montant des intérêts à créditer sur le compte.</Text>
              </>
            ) : (
              <>
                <Text style={modalStyles.label}>Solde actuel</Text>
                <View style={modalStyles.readOnlyInput}>
                  <Text style={modalStyles.readOnlyText}>
                    {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                </View>
                <Text style={modalStyles.label}>Nouveau solde</Text>
                <TextInput
                  style={modalStyles.input}
                  value={interestBalance}
                  onChangeText={setInterestBalance}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={modalStyles.helperText}>Les intérêts sont calculés à partir du nouveau solde.</Text>
              </>
            )}

            <Text style={modalStyles.label}>Date</Text>
            <TouchableOpacity
              style={[modalStyles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
              onPress={() => setShowInterestCalendar(true)}
              activeOpacity={0.8}
            >
              <Text style={{ color: COLORS.text, fontSize: 16 }}>{interestDateDisplay}</Text>
              <Ionicons name="calendar-outline" size={20} color={COLORS.emerald} />
            </TouchableOpacity>

            <Text style={modalStyles.label}>Note (optionnel)</Text>
            <TextInput
              style={modalStyles.input}
              value={interestNote}
              onChangeText={setInterestNote}
              placeholder="Intérêts"
              placeholderTextColor={COLORS.textSecondary}
            />

            <View style={modalStyles.actions}>
              <TouchableOpacity style={modalStyles.cancel} onPress={() => { setShowInterest(false); setShowInterestMethodPicker(false); }} activeOpacity={0.7}>
                <Text style={modalStyles.cancelLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[modalStyles.confirm, { backgroundColor: COLORS.green }, interestLoading && { opacity: 0.5 }]}
                onPress={handleInterest}
                disabled={interestLoading}
                activeOpacity={0.8}
              >
                {interestLoading ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Text style={modalStyles.confirmLabel}>Valider</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* ── Calendrier Intérêts ── */}
      <Modal visible={showInterestCalendar} transparent animationType="fade" onRequestClose={() => setShowInterestCalendar(false)}>
        <Pressable style={modalStyles.overlay} onPress={() => setShowInterestCalendar(false)}>
          <Pressable style={[modalStyles.container, { padding: 8 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <Text style={modalStyles.title}>Date des intérêts</Text>
              <TouchableOpacity onPress={() => setShowInterestCalendar(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={interestDate}
              maxDate={todayISO()}
              onDayPress={(day: any) => {
                setInterestDate(day.dateString);
                setInterestDateDisplay(formatDateFrench(day.dateString));
                setShowInterestCalendar(false);
              }}
              markedDates={interestDate ? { [interestDate]: { selected: true, selectedColor: COLORS.green, selectedTextColor: '#000' } } : {}}
              accentColor={COLORS.green}
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor="#334155"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Transaction detail (read-only) */}
      <Modal visible={!!selectedTx} transparent animationType="slide" onRequestClose={() => setSelectedTxId(null)}>
        <TouchableOpacity style={txDetailStyles.overlay} activeOpacity={1} onPress={() => setSelectedTxId(null)}>
          <TouchableOpacity style={[txDetailStyles.sheet, { paddingBottom: sheetPad }]} activeOpacity={1} onPress={() => {}}>
            {selectedTx && (() => {
              const amt = Number(selectedTx.amount);
              const isIncoming = amt >= 0;
              const isTransfer = selectedTx.category_id == null && (isTransferNote(selectedTx.note ?? null) || !!findSymmetricTx(selectedTx, transferIndex, id!));
              const pairTx = isTransfer
                ? oppositeLegs(selectedTx, transferIndex, id!)
                    .find((p) => isTransferNote(p.note ?? null) || p.note === selectedTx.note)
                : null;
              const otherAccName = pairTx ? (accounts.find((a) => a.id === pairTx.account_id)?.name ?? null) : null;
              // Compte d'en face inaccessible (compte perso d'un autre membre) → libellé générique.
              const otherName = otherAccName ?? (isSharedView ? `compte de ${authorOf(selectedTx)}` : null);
              const label = isTransfer
                ? (isTransferNote(selectedTx.note ?? null)
                    ? (isIncoming ? `Depuis ${otherName ?? 'Compte'}` : `Vers ${otherName ?? 'Compte'}`)
                    : (selectedTx.note?.trim() || (isIncoming ? `Depuis ${otherName ?? 'Compte'}` : `Vers ${otherName ?? 'Compte'}`)))
                : selectedTx.note?.trim() || selectedTx.category?.name || 'Transaction';

              const linkedAccountId = (selectedTx as any).linked_account_id as string | null;
              const linkedAccount = linkedAccountId ? accounts.find((a) => a.id === linkedAccountId) : null;
              const isVirement = isTransfer || !!linkedAccount;

              const isGainLoss = isInvestmentGainLossNote(selectedTx.note);
              const isApport = selectedTx.note === 'Apport' || selectedTx.category?.name === 'Apport' ||
                (selectedTx.note?.toLowerCase().includes('apport') ?? false);
              const txType = isVirement
                ? 'Virement'
                : isGainLoss
                  ? '+/- value'
                  : amt > 0
                    ? (isApport ? 'Apport' : 'Recette')
                    : (selectedTx.note?.toLowerCase().includes('régularisation') ? 'Régularisation' : 'Dépense');

              const rows: { key: string; value: string }[] = [
                { key: 'Type', value: txType },
                { key: 'Date', value: new Date(selectedTx.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
                { key: 'Montant', value: `${isIncoming ? '+' : '−'} ${Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL}` },
              ];
              // Sur un compte partagé/joint : qui a saisi cette transaction.
              if (isSharedView) rows.push({ key: 'Par', value: authorOf(selectedTx) });
              if (isVirement) {
                const srcName = isIncoming ? (linkedAccount?.name ?? otherName ?? '—') : (account?.name ?? '—');
                const dstName = isIncoming ? (account?.name ?? '—') : (linkedAccount?.name ?? otherName ?? '—');
                rows.push({ key: 'Compte source', value: srcName });
                rows.push({ key: 'Compte destination', value: dstName });
              } else {
                rows.push({ key: 'Compte', value: account?.name ?? '' });
              }
              if (selectedTx.category?.name) rows.push({ key: 'Catégorie', value: selectedTx.category.name });

              return (
                <>
                  <View style={txDetailStyles.handle} />
                  <Text style={txDetailStyles.amount(isIncoming)}>
                    {isIncoming ? '+' : '−'} {Math.abs(amt).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                  </Text>
                  <Text style={txDetailStyles.labelText}>{label}</Text>
                  <View style={txDetailStyles.divider} />
                  {rows.map((r) => (
                    <View key={r.key} style={txDetailStyles.row}>
                      <Text style={txDetailStyles.rowKey}>{r.key}</Text>
                      <Text style={txDetailStyles.rowValue}>{r.value}</Text>
                    </View>
                  ))}
                  <View style={txDetailStyles.btnRow}>
                    <TouchableOpacity style={txDetailStyles.closeBtn} onPress={() => setSelectedTxId(null)}>
                      <Text style={txDetailStyles.closeBtnText}>Fermer</Text>
                    </TouchableOpacity>
                    {account?._role !== 'read' && (
                      <TouchableOpacity
                        style={txDetailStyles.editBtn}
                        onPress={() => {
                          const tx = selectedTx!;
                          setSelectedTxId(null);
                          // Même geste que depuis Transactions / Pilotage : sur une échéance
                          // récurrente on passe le mois de l'occurrence, sinon l'éditeur modifiait
                          // toute la SÉRIE alors que la même ligne, ouverte depuis Transactions,
                          // ne modifiait que cette échéance.
                          const instance = (tx as any).instance_month as string | undefined;
                          const origin = `origin=${encodeURIComponent(`/comptes/${id}`)}`;
                          const route = instance
                            ? `/(tabs)/transactions/edit/${tx.id}?instanceDate=${instance}&${origin}`
                            : `/(tabs)/transactions/edit/${tx.id}?${origin}`;
                          router.push(route as any);
                        }}
                      >
                        <Ionicons name="pencil" size={16} color={COLORS.emerald} />
                        <Text style={txDetailStyles.editBtnText}>Modifier</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  scrollContent: { paddingTop: 4 },

  // ── Onglets de la fiche (Solde / Transactions / Paramètres) ──
  tabBar: {
    flexDirection: 'row', gap: 6, padding: 4, marginBottom: 16,
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 6, borderRadius: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabBtnActive: { backgroundColor: c.emerald },
  tabLabel: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary, flexShrink: 1 },
  tabLabelActive: { color: c.bg },

  balanceCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  // Montant et type sur UNE ligne : plus de libellé au-dessus ni de type en dessous.
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceAmount: { flex: 1, minWidth: 0, fontSize: 27, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
  typePill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.cardSolid,
  },
  typePillText: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
  chartWrap: { alignItems: 'center', marginTop: 10 },
  chartCaption: { fontSize: 10.5, color: c.textSecondary, marginTop: 2, textAlign: 'center' },

  // ── Actions du compte : tuiles de largeur ÉGALE (icône + libellé), au lieu de pilules qui
  //    se cassaient en lignes bancales selon la longueur des mots. ──
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  actionTile: {
    flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4,
    backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  actionIcon: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 11, fontWeight: '600', color: c.text, textAlign: 'center' },
  setupBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.blue + '14', borderWidth: 1, borderColor: c.blue + '55', borderRadius: 14, padding: 14, marginBottom: 24, marginTop: -8 },
  setupBannerTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  setupBannerText: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  apportCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 24 },
  apportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  apportLabel: { fontSize: 13, color: c.textSecondary },
  apportValueRO: { fontSize: 15, fontWeight: '700', color: c.text },
  apportEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  apportInput: { minWidth: 90, textAlign: 'right', fontSize: 15, fontWeight: '700', color: c.text, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: c.cardBorder, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  apportCur: { fontSize: 14, color: c.textSecondary },
  apportSave: { width: 30, height: 30, borderRadius: 8, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
  apportHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: c.textSecondary, marginBottom: 12 },

  // Bascule « À venir ce mois » : discrète quand elle dort, pleine quand elle filtre.
  upcomingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
  },
  upcomingBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  upcomingLabel: { flex: 1, fontSize: 13.5, fontWeight: '700', color: c.text },
  upcomingAmount: { fontSize: 13.5, fontWeight: '800', color: c.textSecondary },
  loader: { marginVertical: 20 },
  emptyCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 14, color: c.textSecondary, marginTop: 12 },
  listCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 16,
    overflow: 'hidden',
  },
  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
  transferRowLast: { borderBottomWidth: 0 },
  transferLeft: { flex: 1 },
  transferDate: { fontSize: 13, color: c.textSecondary, marginBottom: 2 },
  transferLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  regulTarget: { fontSize: 12, color: c.emerald, fontWeight: '600', marginTop: 1 },
  transferAmount: { fontSize: 15, fontWeight: '700' },
  transferAmountIn: { color: c.green },
  transferAmountOut: { color: c.text },
  // Pied de l'historique : période affichée + « Charger 3 mois de plus ».
  historyFooter: { alignItems: 'center', gap: 10, marginTop: -4, marginBottom: 16 },
  historyRange: { fontSize: 12, color: c.textSecondary, textAlign: 'center' },
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: c.emerald },
  text: { color: c.text },
});
}

function makeModalStyles(c: any) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 20, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: c.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
    color: c.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  readOnlyInput: {
    backgroundColor: c.cardBorder,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    opacity: 0.7,
  },
  readOnlyText: { fontSize: 16, color: c.textSecondary },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  toggleBtn: {
    flex: 1,
    backgroundColor: c.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleBtnActive: {
    /* Fond TEINTÉ, et non une ardoise sombre écrite en dur (`#1f2937`) : en thème clair, le bouton
       actif devenait un rectangle gris foncé au milieu d'une carte blanche. La bordure et le
       libellé étant déjà en accent, on garde le style « contour teinté » plutôt que le remplissage
       plein utilisé ailleurs (qui rendrait le libellé illisible). */
    backgroundColor: c.emerald + '1F',
    borderColor: c.emerald,
  },
  toggleLabel: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  toggleLabelActive: { color: c.emerald },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 10 },
  dropdownField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
  },
  dropdownText: { color: c.text, fontSize: 15, fontWeight: '600' },
  dropdownOptions: {
    backgroundColor: c.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 18,
    overflow: 'hidden',
  },
  dropdownOption: {
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  dropdownOptionLabel: { color: c.text, fontSize: 15 },
  helperText: { color: c.textSecondary, fontSize: 12, marginTop: -8, marginBottom: 12 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.blue + '14', borderWidth: 1, borderColor: c.blue + '40', borderRadius: 10, padding: 10, marginTop: -4, marginBottom: 14 },
  infoText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 16 },
  cancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  cancelLabel: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  confirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    // Ambre du thème (`c.orange`), pas la valeur du thème SOMBRE recopiée en dur.
    backgroundColor: c.orange,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  confirmLabel: { fontSize: 15, fontWeight: '700', color: '#000' },
});
}

function makeTxDetailStyles(c: any) {
  return {
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
    sheet: { ...sheetWidth, backgroundColor: c.cardSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder },
    handle: { width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center' as const, marginBottom: 20 },
    amount: (isIn: boolean) => ({ fontSize: 32, fontWeight: '700' as const, color: isIn ? c.green : c.text, textAlign: 'center' as const, marginBottom: 4 }),
    labelText: { fontSize: 16, color: c.textSecondary, textAlign: 'center' as const, marginBottom: 20 },
    divider: { height: 1, backgroundColor: c.cardBorder, marginBottom: 16 },
    row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    rowKey: { fontSize: 14, color: c.textSecondary },
    rowValue: { fontSize: 14, color: c.text, fontWeight: '500' as const, flexShrink: 1, textAlign: 'right' as const, marginLeft: 16 },
    closeBtn: { flex: 1, backgroundColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' as const },
    closeBtnText: { fontSize: 15, fontWeight: '600' as const, color: c.text },
    btnRow: { flexDirection: 'row' as const, gap: 10, marginTop: 24 },
    editBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, backgroundColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: c.green + '44' },
    editBtnText: { fontSize: 15, fontWeight: '600' as const, color: c.green },
  };
}

/* OUVERTURE INSTANTANÉE : la page s'affiche en silhouette le temps que son corps (hooks,
   calculs, listes) se monte — sinon le tap reste sans effet visible pendant tout le montage.
   Cf. hooks/useDeferredMount. */
export default withDeferredMount(AccountDetailScreen);
