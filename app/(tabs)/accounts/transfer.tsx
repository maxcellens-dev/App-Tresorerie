import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useAddTransaction } from '../../hooks/useTransactions';
import HeaderWithProfile from '../../components/HeaderWithProfile';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function TransferScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const addTransaction = useAddTransaction(user?.id);

  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('Virement interne');

  async function handleSubmit() {
    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num <= 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant positif.');
      return;
    }
    if (!fromAccountId || !toAccountId) {
      Alert.alert('Comptes requis', 'Choisissez le compte source et le compte cible.');
      return;
    }
    if (fromAccountId === toAccountId) {
      Alert.alert('Comptes différents', 'Le compte source et le compte cible doivent être différents.');
      return;
    }

    try {
      await addTransaction.mutateAsync({
        account_id: fromAccountId,
        category_id: null,
        amount: -Math.abs(num),
        date,
        note: note || 'Virement interne',
      });
      await addTransaction.mutateAsync({
        account_id: toAccountId,
        category_id: null,
        amount: Math.abs(num),
        date,
        note: note || 'Virement interne',
      });
      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’effectuer le virement.');
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.text}>Connectez-vous pour effectuer un virement.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const canSubmit =
    fromAccountId &&
    toAccountId &&
    fromAccountId !== toAccountId &&
    amount &&
    parseFloat(amount.replace(',', '.')) > 0 &&
    !addTransaction.isPending;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <HeaderWithProfile title="Virement entre comptes" showBack={true} />
        <Text style={styles.subtitle}>Débit sur un compte, crédit sur un autre. Les soldes sont mis à jour.</Text>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Compte source (débit)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.chip, fromAccountId === acc.id && styles.chipActive]}
                onPress={() => setFromAccountId(acc.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, fromAccountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {accounts.length === 0 && (
            <Text style={styles.hint}>Aucun compte. Ajoutez-en un depuis l’onglet Comptes.</Text>
          )}

          <Text style={styles.label}>Compte cible (crédit)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.chip, toAccountId === acc.id && styles.chipActive]}
                onPress={() => setToAccountId(acc.id)}
                accessibilityRole="button"
              >
                <Text style={[styles.chipText, toAccountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Montant (€)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={COLORS.textSecondary}
          />

          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Ex. Virement interne"
            placeholderTextColor={COLORS.textSecondary}
          />

          <TouchableOpacity
            style={[styles.submitBtn, (!canSubmit || addTransaction.isPending) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || addTransaction.isPending}
            accessibilityRole="button"
          >
            {addTransaction.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.submitLabel}>Effectuer le virement</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 20,
  },
  chipScroll: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginRight: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  chipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  chipText: { fontSize: 14, color: COLORS.text },
  chipTextActive: { color: COLORS.bg, fontWeight: '600' },
  hint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 16 },
  text: { color: COLORS.text, marginBottom: 16 },
  btn: {
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: 12,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  btnLabel: { color: COLORS.text, fontWeight: '600' },
  submitBtn: {
    backgroundColor: COLORS.emerald,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
});
