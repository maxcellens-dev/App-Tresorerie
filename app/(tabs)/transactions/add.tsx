import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { useAddTransaction } from '../../hooks/useTransactions';
import CategoryPicker, { useSubCategoriesGrouped } from '../../components/CategoryPicker';
import type { RecurrenceRule } from '../../types/database';
import HeaderWithProfile from '../../components/HeaderWithProfile';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function AddTransactionScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const addTransaction = useAddTransaction(user?.id);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState(''); // vide = sans fin

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  useEffect(() => setCategoryId(''), [isExpense]);

  async function handleSubmit() {
    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant.');
      return;
    }
    if (!accountId) {
      Alert.alert('Compte requis', 'Choisissez un compte.');
      return;
    }
    const finalAmount = isExpense ? -Math.abs(num) : Math.abs(num);

    try {
      await addTransaction.mutateAsync({
        account_id: accountId,
        category_id: categoryId || null,
        amount: finalAmount,
        date,
        note: note || undefined,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: isRecurring && recurrenceEndDateInput.trim() ? recurrenceEndDateInput.trim() : null,
      });
      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’enregistrer.');
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Text style={styles.text}>Connectez-vous pour ajouter une transaction.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.back()}>
            <Text style={styles.btnLabel}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <HeaderWithProfile title="Nouvelle transaction" showBack={true} />
        
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[styles.typeBtn, isExpense && styles.typeBtnActive]}
              onPress={() => setIsExpense(true)}
              accessibilityRole="button"
            >
              <Text style={[styles.typeBtnLabel, isExpense && styles.typeBtnLabelActive]}>Dépense</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, !isExpense && styles.typeBtnActive]}
              onPress={() => setIsExpense(false)}
              accessibilityRole="button"
            >
              <Text style={[styles.typeBtnLabel, !isExpense && styles.typeBtnLabelActive]}>Recette</Text>
            </TouchableOpacity>
          </View>

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

          <Text style={styles.label}>Compte</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.chip, accountId === acc.id && styles.chipActive]}
                onPress={() => setAccountId(acc.id)}
              >
                <Text style={[styles.chipText, accountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {accounts.length === 0 && (
            <Text style={styles.hint}>Aucun compte. Ajoutez-en un dans l’onglet Comptes.</Text>
          )}

          <CategoryPicker
            key={isExpense ? 'expense' : 'income'}
            groups={categoryGroups}
            selectedCategoryId={categoryId}
            onSelect={setCategoryId}
            label="Sous-catégorie (optionnel)"
          />

          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Ex. Courses, Salaire..."
            placeholderTextColor={COLORS.textSecondary}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <View style={styles.recurringSection}>
            <TouchableOpacity
              style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>Récurrent (ex. salaire mensuel)</Text>
            </TouchableOpacity>
            {isRecurring && (
              <>
                <Text style={styles.label}>Période</Text>
                <View style={styles.chipRow}>
                  {(['weekly', 'monthly', 'quarterly', 'yearly'] as RecurrenceRule[]).map((rule) => (
                    <TouchableOpacity
                      key={rule}
                      style={[styles.chip, recurrenceRule === rule && styles.chipActive]}
                      onPress={() => setRecurrenceRule(rule)}
                    >
                      <Text style={[styles.chipText, recurrenceRule === rule && styles.chipTextActive]}>
                        {rule === 'weekly' ? 'Hebdo' : rule === 'monthly' ? 'Mensuel' : rule === 'quarterly' ? 'Trim.' : 'Annuel'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.label}>Fin (optionnel, vide = sans fin)</Text>
                <TextInput
                  style={styles.input}
                  value={recurrenceEndDateInput}
                  onChangeText={setRecurrenceEndDateInput}
                  placeholder="YYYY-MM-DD ou vide"
                  placeholderTextColor={COLORS.textSecondary}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, addTransaction.isPending && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={addTransaction.isPending}
            accessibilityRole="button"
          >
            {addTransaction.isPending ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.submitLabel}>Enregistrer</Text>
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
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary },
  toggleLabelActive: { color: COLORS.bg },
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
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COLORS.cardBorder, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  chipText: { fontSize: 14, color: COLORS.text },
  chipTextActive: { color: COLORS.bg, fontWeight: '600' },
  hint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 16 },
  text: { color: COLORS.text, marginBottom: 16 },
  btn: { backgroundColor: COLORS.card, padding: 14, borderRadius: 12, alignSelf: 'flex-start' },
  btnLabel: { color: COLORS.text, fontWeight: '600' },
  recurringSection: { marginTop: 8, marginBottom: 16 },
  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginBottom: 12,
  },
  recurringToggleActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  recurringLabel: { fontSize: 15, color: COLORS.textSecondary },
  recurringLabelActive: { color: COLORS.bg, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  submitBtn: { backgroundColor: COLORS.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
});
