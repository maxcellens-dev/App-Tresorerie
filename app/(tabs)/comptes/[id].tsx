import { useMemo, useState, useEffect } from 'react';
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
} from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/ScreenHeader';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import { iconForCategory, VIREMENT_ICON } from '../../../lib/categoryIcons';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../../lib/dateUtils';
import { compareTransactionsForDisplay, isRegulRow } from '../../../lib/txOrder';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts, useUpdateAccount } from '../../../hooks/useAccounts';
import { useAccountParticipants } from '../../../hooks/useSharedAccounts';
import { useAllTransactions, useAddTransaction } from '../../../hooks/useTransactions';
import { computeContributed } from '../../../lib/contributed';
import type { TransactionWithDetails } from '../../../types/database';
import { useAppColors } from '../../../hooks/useAppColors';
import { currencySymbolFor } from '../../../lib/currency';


const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

const VIREMENT_NOTE = 'Virement interne';
const INVESTMENT_GAIN_NOTE = 'Plus-value';
const INVESTMENT_LOSS_NOTE = 'Moins-value';

function isTransferNote(note: string | null): boolean {
  return note === VIREMENT_NOTE || (note != null && note.trim().toLowerCase().startsWith('virement'));
}

function isInvestmentGainLossNote(note: string | null | undefined): boolean {
  return !!note && /plus|moins|gain|perte/i.test(note);
}

/** Cherche la transaction symétrique (même note + date + montant opposé sur un autre compte, sans catégorie). */
function findSymmetricTx(
  t: TransactionWithDetails,
  allTx: TransactionWithDetails[],
  currentAccountId: string,
): TransactionWithDetails | null {
  if (!t.note || t.category_id != null) return null;
  return allTx.find(
    (p) =>
      p.id !== t.id &&
      p.account_id !== currentAccountId &&
      p.category_id == null &&
      p.date === t.date &&
      Math.abs(Number(p.amount) + Number(t.amount)) < 0.01 &&
      p.note === t.note
  ) ?? null;
}

export default function AccountDetailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const modalStyles = makeModalStyles(COLORS);
  const txDetailStyles = makeTxDetailStyles(COLORS);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: transactions = [], isLoading: txLoading } = useAllTransactions(user?.id);
  const addTransaction = useAddTransaction(user?.id);
  const updateAccount = useUpdateAccount(user?.id);

  const account = accounts.find((a) => a.id === id);

  // Compte partagé/joint : on identifie l'AUTEUR de chaque transaction (sans exposer les comptes
  // personnels des autres membres). isSharedView = joint, OU compte reçu d'un autre utilisateur.
  const isSharedView = !!(account as any)?.is_joint || (!!account && account._role !== 'owner');
  const { data: participants = [] } = useAccountParticipants(isSharedView ? id : undefined);
  const nameByUser = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of participants) m[p.user_id] = p.display_name;
    return m;
  }, [participants]);
  const authorOf = (t: any): string =>
    t?.profile_id === user?.id ? 'Vous' : (nameByUser[t?.profile_id] ?? 'Un membre');

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

  const [selectedTx, setSelectedTx] = useState<TransactionWithDetails | null>(null);

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
      Alert.alert('Solde invalide', 'Saisissez un solde valide.');
      return;
    }
    if (!account || !id || !user?.id) return;
    const diff = newBalance - balanceAtDate;
    if (diff === 0) {
      Alert.alert('Aucune variation', 'Le solde saisi est identique au solde à cette date.');
      return;
    }
    setBalanceLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: diff,
        date: balanceDate,
        note: balanceNote.trim() || 'Ajustement de solde',
        is_recurring: false,
        regul_target: newBalance, // solde cible saisi → affiché sur la ligne de régul
      });
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
      Alert.alert('Montant invalide', 'Saisissez un montant positif.');
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
    if (Number.isNaN(v)) { Alert.alert('Montant invalide', 'Saisissez un montant valide.'); return; }
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
        Alert.alert('Montant invalide', 'Saisissez un montant positif.');
        return;
      }
      num = isLoss ? -Math.abs(num) : Math.abs(num);
    } else {
      const balance = parseFloat(gainLossBalance.replace(',', '.'));
      if (Number.isNaN(balance)) {
        Alert.alert('Solde invalide', 'Saisissez un solde final valide.');
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
        Alert.alert('Montant invalide', 'Saisissez un montant.');
        return;
      }
      num = Math.abs(num); // les intérêts sont toujours crédités
    } else {
      const balance = parseFloat(interestBalance.replace(',', '.'));
      if (Number.isNaN(balance)) {
        Alert.alert('Solde invalide', 'Saisissez un solde final valide.');
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
    return allTx
      .filter((t) => t.account_id === id && !(t as any).is_draft && t.date <= today)
      .sort(compareTransactionsForDisplay);
  }, [id, transactions]);

  if (!user || !account) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <ScreenHeader title="Compte" onBack={() => router.back()} />
          <Text style={styles.text}>{account ? 'Compte introuvable.' : 'Chargement…'}</Text>
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
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScreenHeader
          title={account.name}
          onBack={() => router.back()}
          right={
            // En consultation seule : pas de bouton « Modifier » (le membre ne peut rien éditer).
            account._role === 'read' ? undefined : (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => router.push(`/(tabs)/comptes/edit/${id}`)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Modifier le compte"
              >
                <Ionicons name="pencil" size={20} color={COLORS.text} />
                <Text style={styles.editBtnLabel}>Modifier</Text>
              </TouchableOpacity>
            )
          }
        />
        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}>

          {/* Actions d'écriture masquées pour un membre en consultation (rôle read). */}
          {account._role !== 'read' && (
          <View style={styles.buttonRow}>
            {account.type === 'checking' ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setShowBalance(true); setBalanceInput(''); setBalanceNote('Régularisation solde'); const today = todayISO(); setBalanceDate(today); setBalanceDateDisplay(formatDateFrench(today)); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Nouveau Solde"
              >
                <Ionicons name="wallet-outline" size={20} color={COLORS.blue} />
                <Text style={[styles.editBtnLabel, { color: COLORS.blue }]}>Nouveau Solde</Text>
              </TouchableOpacity>
            ) : null}
            {account.type === 'investment' ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setShowGainLoss(true); setShowMethodPicker(false); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Plus / moins value"
              >
                <Ionicons name="trending-up-outline" size={20} color={COLORS.violet} />
                <Text style={[styles.editBtnLabel, { color: COLORS.violet }]}>+/- value</Text>
              </TouchableOpacity>
            ) : null}
            {account.type === 'savings' ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setShowInterest(true); setShowInterestMethodPicker(false); const today = todayISO(); setInterestDate(today); setInterestDateDisplay(formatDateFrench(today)); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Intérêts"
              >
                <Ionicons name="cash-outline" size={20} color={COLORS.green} />
                <Text style={[styles.editBtnLabel, { color: COLORS.green }]}>Intérêts</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => setShowApport(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Apport"
            >
              <Ionicons name="add-circle-outline" size={20} color={COLORS.orange} />
              <Text style={[styles.editBtnLabel, { color: COLORS.orange }]}>Apport</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => router.push(`/(tabs)/comptes/transfer?from=${id}`)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Virement"
            >
              <Ionicons name="swap-horizontal" size={20} color={COLORS.emerald} />
              <Text style={[styles.editBtnLabel, { color: COLORS.emerald }]}>Virement</Text>
            </TouchableOpacity>
          </View>
          )}

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde</Text>
          <Text style={styles.balanceAmount}>
            {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
          </Text>
          <Text style={styles.accountType}>{TYPE_LABELS[account.type] ?? account.type}</Text>
        </View>

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
              <Text style={styles.setupBannerTitle}>Renseignez votre solde pour bien démarrer</Text>
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
                  <TouchableOpacity style={styles.apportSave} onPress={saveApportBase}>
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

        <Text style={styles.sectionTitle}>Historique des transactions</Text>
        {txLoading ? (
          <ActivityIndicator size="small" color={COLORS.emerald} style={styles.loader} />
        ) : accountTransactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>Aucune transaction sur ce compte.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {accountTransactions.map((t, idx) => {
              const amount = Number(t.amount);
              const isTransfer = t.category_id == null && (isTransferNote(t.note ?? null) || !!findSymmetricTx(t, transactions as TransactionWithDetails[], id));
              const pair = isTransfer
                ? ((transactions as TransactionWithDetails[]).find(
                    (p) =>
                      p.account_id !== id &&
                      p.category_id == null &&
                      (isTransferNote(p.note ?? null) || p.note === t.note) &&
                      p.date === t.date &&
                      Number(p.amount) === -amount
                  ) ?? null)
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
                  style={[styles.transferRow, idx === accountTransactions.length - 1 && styles.transferRowLast]}
                  onPress={() => setSelectedTx(t)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={(isTransfer ? VIREMENT_ICON : iconForCategory(t.category)) as any} size={16} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                  <View style={styles.transferLeft}>
                    <Text style={styles.transferDate}>
                      {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {isSharedView ? ` — par ${authorOf(t)}` : ''}
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

        <Text style={styles.hint}>Les écritures de ce compte apparaissent ici.</Text>
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* ── Solde modal ── */}
      <Modal visible={showBalance} transparent animationType="fade" onRequestClose={() => setShowBalance(false)}>
        <View style={modalStyles.overlay}>
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
                if (Number.isNaN(v)) return 'Saisissez le solde réel relevé sur votre banque.';
                const diff = v - balanceAtDate;
                if (diff === 0) return 'Aucune variation.';
                return diff > 0
                  ? `+ ${diff.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL} seront ajoutés`
                  : `${diff.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOL} seront retirés`;
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
                style={[modalStyles.confirm, { backgroundColor: '#60a5fa' }, balanceLoading && { opacity: 0.5 }]}
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
        </View>
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
              markedDates={balanceDate ? { [balanceDate]: { selected: true, selectedColor: '#60a5fa', selectedTextColor: '#000' } } : {}}
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
        <View style={modalStyles.overlay}>
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
        </View>
      </Modal>

      <Modal visible={showGainLoss} transparent animationType="fade" onRequestClose={() => {
        setShowGainLoss(false);
        setShowMethodPicker(false);
      }}>
        <View style={modalStyles.overlay}>
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
        </View>
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
              markedDates={gainLossDate ? { [gainLossDate]: { selected: true, selectedColor: '#a78bfa', selectedTextColor: '#000' } } : {}}
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
        <View style={modalStyles.overlay}>
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
        </View>
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
      <Modal visible={!!selectedTx} transparent animationType="slide" onRequestClose={() => setSelectedTx(null)}>
        <TouchableOpacity style={txDetailStyles.overlay} activeOpacity={1} onPress={() => setSelectedTx(null)}>
          <TouchableOpacity style={txDetailStyles.sheet} activeOpacity={1} onPress={() => {}}>
            {selectedTx && (() => {
              const amt = Number(selectedTx.amount);
              const isIncoming = amt >= 0;
              const isTransfer = selectedTx.category_id == null && (isTransferNote(selectedTx.note ?? null) || !!findSymmetricTx(selectedTx, transactions as TransactionWithDetails[], id!));
              const pairTx = isTransfer
                ? (transactions as TransactionWithDetails[]).find(
                    (p) => p.account_id !== id && p.category_id == null &&
                      (isTransferNote(p.note ?? null) || p.note === selectedTx.note) &&
                      p.date === selectedTx.date && Number(p.amount) === -amt
                  )
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
                    <TouchableOpacity style={txDetailStyles.closeBtn} onPress={() => setSelectedTx(null)}>
                      <Text style={txDetailStyles.closeBtnText}>Fermer</Text>
                    </TouchableOpacity>
                    {account?._role !== 'read' && (
                      <TouchableOpacity
                        style={txDetailStyles.editBtn}
                        onPress={() => {
                          setSelectedTx(null);
                          router.push(`/(tabs)/transactions/edit/${selectedTx!.id}` as any);
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
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, flex: 1, minWidth: 0 },
  buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', width: '100%', marginBottom: 20 },
  modifyRow: { flexDirection: 'row', gap: 8, alignSelf: 'flex-start' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  editBtnLabel: { fontSize: 14, fontWeight: '600', color: c.text },
  balanceCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 20,
    marginBottom: 24,
  },
  balanceLabel: { fontSize: 13, color: c.textSecondary, marginBottom: 4 },
  balanceAmount: { fontSize: 26, fontWeight: '800', color: c.text },
  accountType: { fontSize: 12, color: c.textSecondary, marginTop: 6 },
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
  hint: { fontSize: 13, color: c.textSecondary, textAlign: 'center' },
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
    backgroundColor: '#1f2937',
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
    backgroundColor: '#f59e0b',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  confirmLabel: { fontSize: 15, fontWeight: '700', color: '#000' },
});
}

function makeTxDetailStyles(c: any) {
  return {
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
    sheet: { backgroundColor: c.cardSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder },
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
