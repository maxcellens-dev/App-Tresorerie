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

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
};

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

export default function AccountDetailScreen() {
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

  const transferHistory = useMemo(() => {
    if (!id || !account) return [];
    const allTx = transactions as TransactionWithDetails[];
    const virementTx = allTx.filter(
      (t) => t.account_id === id && t.category_id == null && isTransferNote(t.note ?? null)
    );
    const result: { date: string; note: string; amount: number; otherAccountName: string; direction: 'in' | 'out' }[] = [];
    for (const t of virementTx) {
      const amount = Number(t.amount);
      const pair = allTx.find(
        (p) =>
          p.account_id !== id &&
          p.category_id == null &&
          isTransferNote(p.note ?? null) &&
          p.date === t.date &&
          Number(p.amount) === -amount
      );
      const otherAccount = pair ? accounts.find((a) => a.id === pair.account_id) : null;
      result.push({
        date: t.date,
        note: t.note ?? VIREMENT_NOTE,
        amount: Math.abs(amount),
        otherAccountName: otherAccount?.name ?? 'Compte',
        direction: amount > 0 ? 'in' : 'out',
      });
    }
    result.sort((a, b) => (b.date.localeCompare(a.date)));
    return result;
  }, [id, account, transactions, accounts]);

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
        </TouchableOpacity>

        <View style={styles.headerRow}>
          <Text style={styles.title}>{account.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde</Text>
          <Text style={styles.balanceAmount}>
            {account.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {account.currency}
          </Text>
          <Text style={styles.accountType}>{TYPE_LABELS[account.type] ?? account.type}</Text>
        </View>

        <Text style={styles.sectionTitle}>Historique des virements</Text>
        {txLoading ? (
          <ActivityIndicator size="small" color={COLORS.emerald} style={styles.loader} />
        ) : transferHistory.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="swap-horizontal-outline" size={32} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>Aucun virement vers ou depuis ce compte.</Text>
          </View>
        ) : (
          <View style={styles.listCard}>
            {transferHistory.map((item, idx) => (
              <View
                key={`${item.date}-${item.amount}-${idx}`}
                style={[styles.transferRow, idx === transferHistory.length - 1 && styles.transferRowLast]}
              >
                <View style={styles.transferLeft}>
                  <Text style={styles.transferDate}>
                    {new Date(item.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                  <Text style={styles.transferLabel}>
                    {item.direction === 'in' ? 'Depuis' : 'Vers'} {item.otherAccountName}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.transferAmount,
                    item.direction === 'in' ? styles.transferAmountIn : styles.transferAmountOut,
                  ]}
                >
                  {item.direction === 'in' ? '+' : '−'} {item.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.hint}>Les virements entre vos comptes apparaissent ici.</Text>
      </SafeAreaView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, flex: 1 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  editBtnLabel: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  balanceCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
    marginBottom: 24,
  },
  balanceLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 },
  balanceAmount: { fontSize: 26, fontWeight: '800', color: COLORS.emerald },
  accountType: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 12 },
  loader: { marginVertical: 20 },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 12 },
  listCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
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
    borderBottomColor: COLORS.cardBorder,
  },
  transferRowLast: { borderBottomWidth: 0 },
  transferLeft: {},
  transferDate: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 2 },
  transferLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  transferAmount: { fontSize: 15, fontWeight: '700' },
  transferAmountIn: { color: COLORS.emerald },
  transferAmountOut: { color: COLORS.danger },
  hint: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  text: { color: COLORS.text },
});

const modalStyles = StyleSheet.create({
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
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 24,
  },
  title: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 20, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    color: COLORS.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  cancelLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary },
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
