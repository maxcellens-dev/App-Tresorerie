import { useMemo, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useTransactions, useAddTransaction } from '../../hooks/useTransactions';
import type { TransactionWithDetails } from '../../types/database';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';


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

export default function AccountDetailScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const modalStyles = makeModalStyles(COLORS);
  const txDetailStyles = makeTxDetailStyles(COLORS);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: transactions = [], isLoading: txLoading } = useTransactions(user?.id);
  const addTransaction = useAddTransaction(user?.id);

  const account = accounts.find((a) => a.id === id);

  const [showApport, setShowApport] = useState(false);
  const [apportAmount, setApportAmount] = useState('');
  const [apportNote, setApportNote] = useState('Apport');
  const [apportLoading, setApportLoading] = useState(false);

  const [showBalance, setShowBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [balanceNote, setBalanceNote] = useState('Régularisation solde');
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [selectedTx, setSelectedTx] = useState<TransactionWithDetails | null>(null);

  const [showGainLoss, setShowGainLoss] = useState(false);
  const [gainLossMode, setGainLossMode] = useState<'amount' | 'balance'>('balance');
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [gainLossAmount, setGainLossAmount] = useState('');
  const [gainLossBalance, setGainLossBalance] = useState('');
  const [gainLossNote, setGainLossNote] = useState(INVESTMENT_GAIN_NOTE);
  const [gainLossLoading, setGainLossLoading] = useState(false);
  const [isLoss, setIsLoss] = useState(false);

  async function handleBalance() {
    const newBalance = parseFloat(balanceInput.replace(',', '.'));
    if (Number.isNaN(newBalance)) {
      Alert.alert('Solde invalide', 'Saisissez un solde valide.');
      return;
    }
    if (!account || !id || !user?.id) return;
    const diff = newBalance - Number(account.balance);
    if (diff === 0) {
      Alert.alert('Aucune variation', 'Le solde saisi est identique au solde actuel.');
      return;
    }
    setBalanceLoading(true);
    try {
      await addTransaction.mutateAsync({
        account_id: id,
        category_id: null,
        amount: diff,
        date: new Date().toISOString().slice(0, 10),
        note: balanceNote.trim() || 'Ajustement de solde',
        is_recurring: false,
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
        date: new Date().toISOString().slice(0, 10),
        note: apportNote.trim() || 'Apport',
        is_recurring: false,
      });
      setShowApport(false);
      setApportAmount('');
      setApportNote('Apport');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setApportLoading(false);
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
        date: new Date().toISOString().slice(0, 10),
        note: gainLossNote.trim() || (num < 0 ? INVESTMENT_LOSS_NOTE : INVESTMENT_GAIN_NOTE),
        is_recurring: false,
      });
      setShowGainLoss(false);
      setGainLossAmount('');
      setGainLossBalance('');
      setGainLossMode('balance');
      setIsLoss(false);
      setGainLossNote(INVESTMENT_GAIN_NOTE);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
    } finally {
      setGainLossLoading(false);
    }
  }

  const accountTransactions = useMemo(() => {
    if (!id) return [];
    const today = new Date().toISOString().slice(0, 10);
    const allTx = transactions as TransactionWithDetails[];
    return allTx
      .filter((t) => t.account_id === id && !(t as any).is_draft && t.date <= today)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [id, transactions]);

  if (!user || !account) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.text}>{account ? 'Compte introuvable.' : 'Chargement…'}</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
        </TouchableOpacity>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 }]}>

        <View style={styles.headerRow}>
          <Text style={styles.title}>{account.name}</Text>
          <View style={styles.modifyRow}>
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
          </View>
          <View style={styles.buttonRow}>
            {account.type === 'checking' ? (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setShowBalance(true); setBalanceInput(''); setBalanceNote('Régularisation solde'); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Ajuster le solde"
              >
                <Ionicons name="wallet-outline" size={20} color="#60a5fa" />
                <Text style={[styles.editBtnLabel, { color: '#60a5fa' }]}>Solde</Text>
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
                <Ionicons name="trending-up-outline" size={20} color="#a78bfa" />
                <Text style={[styles.editBtnLabel, { color: '#a78bfa' }]}>+/- value</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => setShowApport(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Apport"
            >
              <Ionicons name="add-circle-outline" size={20} color="#f59e0b" />
              <Text style={[styles.editBtnLabel, { color: '#f59e0b' }]}>Apport</Text>
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
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde</Text>
          <Text style={styles.balanceAmount}>
            {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
          </Text>
          <Text style={styles.accountType}>{TYPE_LABELS[account.type] ?? account.type}</Text>
        </View>

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
              const isTransfer = t.category_id == null && isTransferNote(t.note ?? null);
              const pair = isTransfer
                ? (transactions as TransactionWithDetails[]).find(
                    (p) =>
                      p.account_id !== id &&
                      p.category_id == null &&
                      isTransferNote(p.note ?? null) &&
                      p.date === t.date &&
                      Number(p.amount) === -amount
                  )
                : null;
              const otherAccountName = pair ? accounts.find((a) => a.id === pair.account_id)?.name ?? 'Compte' : 'Compte';
              const label = isTransfer
                ? amount > 0
                  ? `Depuis ${otherAccountName}`
                  : `Vers ${otherAccountName}`
                : t.note?.trim() || t.category?.name || 'Transaction';
              return (
                <TouchableOpacity
                  key={`${t.id}-${idx}`}
                  style={[styles.transferRow, idx === accountTransactions.length - 1 && styles.transferRowLast]}
                  onPress={() => setSelectedTx(t)}
                  activeOpacity={0.7}
                >
                  <View style={styles.transferLeft}>
                    <Text style={styles.transferDate}>
                      {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </Text>
                    <Text style={styles.transferLabel}>{label}</Text>
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
        </ScrollView>
      </SafeAreaView>

      {/* ── Solde modal ── */}
      <Modal visible={showBalance} transparent animationType="fade" onRequestClose={() => setShowBalance(false)}>
        <View style={modalStyles.overlay}>
          <View style={modalStyles.container}>
            <Text style={modalStyles.title}>Ajuster le solde</Text>

            <Text style={modalStyles.label}>Solde actuel</Text>
            <View style={modalStyles.readOnlyInput}>
              <Text style={modalStyles.readOnlyText}>
                {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
              </Text>
            </View>

            <Text style={modalStyles.label}>Nouveau solde</Text>
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
                if (Number.isNaN(v)) return 'Saisissez le nouveau solde du compte.';
                const diff = v - Number(account.balance);
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
              <Text style={modalStyles.dropdownText}>{gainLossMode === 'amount' ? 'Montant' : 'Solde'}</Text>
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
                  <Text style={modalStyles.dropdownOptionLabel}>Solde</Text>
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

      {/* Transaction detail (read-only) */}
      <Modal visible={!!selectedTx} transparent animationType="slide" onRequestClose={() => setSelectedTx(null)}>
        <TouchableOpacity style={txDetailStyles.overlay} activeOpacity={1} onPress={() => setSelectedTx(null)}>
          <TouchableOpacity style={txDetailStyles.sheet} activeOpacity={1} onPress={() => {}}>
            {selectedTx && (() => {
              const amt = Number(selectedTx.amount);
              const isIncoming = amt >= 0;
              const isTransfer = selectedTx.category_id == null && isTransferNote(selectedTx.note ?? null);
              const pairTx = isTransfer
                ? (transactions as TransactionWithDetails[]).find(
                    (p) => p.account_id !== id && p.category_id == null && isTransferNote(p.note ?? null) &&
                      p.date === selectedTx.date && Number(p.amount) === -amt
                  )
                : null;
              const otherName = pairTx ? accounts.find((a) => a.id === pairTx.account_id)?.name ?? 'Compte' : null;
              const label = isTransfer
                ? isIncoming ? `Depuis ${otherName ?? 'Compte'}` : `Vers ${otherName ?? 'Compte'}`
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
                  <TouchableOpacity style={txDetailStyles.closeBtn} onPress={() => setSelectedTx(null)}>
                    <Text style={txDetailStyles.closeBtnText}>Fermer</Text>
                  </TouchableOpacity>
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
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, flex: 1, minWidth: 0 },
  buttonRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', width: '100%' },
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
  balanceAmount: { fontSize: 26, fontWeight: '800', color: c.emerald },
  accountType: { fontSize: 12, color: c.textSecondary, marginTop: 6 },
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
  transferLeft: {},
  transferDate: { fontSize: 13, color: c.textSecondary, marginBottom: 2 },
  transferLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  transferAmount: { fontSize: 15, fontWeight: '700' },
  transferAmountIn: { color: c.emerald },
  transferAmountOut: { color: c.danger },
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
    backgroundColor: c.card,
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
    sheet: { backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder },
    handle: { width: 40, height: 4, backgroundColor: c.cardBorder, borderRadius: 2, alignSelf: 'center' as const, marginBottom: 20 },
    amount: (isIn: boolean) => ({ fontSize: 32, fontWeight: '700' as const, color: isIn ? '#34d399' : '#f87171', textAlign: 'center' as const, marginBottom: 4 }),
    labelText: { fontSize: 16, color: c.textSecondary, textAlign: 'center' as const, marginBottom: 20 },
    divider: { height: 1, backgroundColor: c.cardBorder, marginBottom: 16 },
    row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    rowKey: { fontSize: 14, color: c.textSecondary },
    rowValue: { fontSize: 14, color: c.text, fontWeight: '500' as const, flexShrink: 1, textAlign: 'right' as const, marginLeft: 16 },
    closeBtn: { marginTop: 24, backgroundColor: c.cardBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' as const },
    closeBtnText: { fontSize: 15, fontWeight: '600' as const, color: c.text },
  };
}
