import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { useAddTransaction, useTransactions } from '../../hooks/useTransactions';
import CategoryPicker, { useSubCategoriesGrouped } from '../../components/CategoryPicker';
import type { RecurrenceRule } from '../../types/database';
import HeaderWithProfile from '../../components/HeaderWithProfile';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../lib/dateUtils';
import { accountColor } from '../../theme/colors';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

type TransactionType = 'expense' | 'income' | 'transfer';

export default function AddTransactionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const addTransaction = useAddTransaction(user?.id);

  // Déterminer le type initial depuis les params ou par défaut 'expense'
  const getInitialType = (): TransactionType => {
    if (params.type === 'income') return 'income';
    if (params.type === 'transfer') return 'transfer';
    return 'expense';
  };

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dateDisplay, setDateDisplay] = useState(formatDateFrench(todayISO()));
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [targetAccountId, setTargetAccountId] = useState(''); // Pour les virements
  const [categoryId, setCategoryId] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>(getInitialType());
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState(''); // vide = sans fin
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end'>(false);

  const isExpense = transactionType === 'expense';
  const isIncome = transactionType === 'income';
  const isTransfer = transactionType === 'transfer';

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  useEffect(() => setCategoryId(''), [isExpense, isIncome]);

  // Sélection automatique du dernier compte courant utilisé
  useEffect(() => {
    if (accountId || !accounts.length) return;
    const checkingAccounts = accounts.filter(a => a.type === 'checking');
    if (!checkingAccounts.length) {
      setAccountId(accounts[0].id);
      return;
    }
    const checkingIds = new Set(checkingAccounts.map(a => a.id));
    const lastUsed = [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .find(t => checkingIds.has(t.account_id));
    setAccountId(lastUsed ? lastUsed.account_id : checkingAccounts[0].id);
  }, [accounts, transactions]);

  async function handleSubmit(isDraft = false) {
    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant.');
      return;
    }
    if (!accountId) {
      Alert.alert('Compte requis', 'Choisissez un compte source.');
      return;
    }

    if (isTransfer) {
      if (!targetAccountId) {
        Alert.alert('Compte cible requis', 'Choisissez un compte de destination.');
        return;
      }
      if (accountId === targetAccountId) {
        Alert.alert('Comptes identiques', 'Choisissez des comptes différents.');
        return;
      }
    }

    const finalAmount = isExpense ? -Math.abs(num) : Math.abs(num);
    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;

    try {
      await addTransaction.mutateAsync({
        account_id: accountId,
        category_id: isTransfer ? null : (categoryId || null),
        amount: finalAmount,
        date,
        note: note || (isTransfer ? `Virement vers ${accounts.find(a => a.id === targetAccountId)?.name}` : undefined),
        is_draft: isDraft,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
      });

      if (isTransfer) {
        await addTransaction.mutateAsync({
          account_id: targetAccountId,
          category_id: null,
          amount: num,
          date,
          note: note || `Virement depuis ${accounts.find(a => a.id === accountId)?.name}`,
          is_draft: isDraft,
          is_recurring: isRecurring,
          recurrence_rule: isRecurring ? recurrenceRule : null,
          recurrence_end_date: endDateISO,
        });
      }

      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
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
        <HeaderWithProfile title="Nouvelle transaction" showBack={true} hideProfile={true} />
        
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[styles.typeBtn, isExpense && styles.typeBtnActive]}
              onPress={() => setTransactionType('expense')}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-down" size={18} color={isExpense ? COLORS.bg : COLORS.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.typeBtnLabel, isExpense && styles.typeBtnLabelActive]}>Dépense</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, isIncome && styles.typeBtnActive]}
              onPress={() => setTransactionType('income')}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-up" size={18} color={isIncome ? COLORS.bg : COLORS.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.typeBtnLabel, isIncome && styles.typeBtnLabelActive]}>Recette</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, isTransfer && styles.typeBtnActive]}
              onPress={() => setTransactionType('transfer')}
              accessibilityRole="button"
            >
              <Ionicons name="swap-horizontal" size={18} color={isTransfer ? COLORS.bg : COLORS.textSecondary} style={{ marginRight: 6 }} />
              <Text style={[styles.typeBtnLabel, isTransfer && styles.typeBtnLabelActive]}>Virement</Text>
            </TouchableOpacity>
          </View>

          {/* Compte */}
          <Text style={styles.label}>Compte {isTransfer ? 'source' : ''}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => {
              const color = accountColor(acc.type);
              const isActive = accountId === acc.id;
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.chip, { borderColor: isActive ? color : COLORS.cardBorder, backgroundColor: isActive ? color + '22' : 'transparent' }]}
                  onPress={() => setAccountId(acc.id)}
                >
                  <Text style={[styles.chipText, { color: isActive ? color : COLORS.text }]}>{acc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {accounts.length === 0 && (
            <Text style={styles.hint}>Aucun compte. Ajoutez-en un dans l'onglet Comptes.</Text>
          )}

          {isTransfer && (
            <>
              <Text style={styles.label}>Compte cible</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {accounts.map((acc) => {
                  const color = accountColor(acc.type);
                  const isActive = targetAccountId === acc.id;
                  const isDisabled = acc.id === accountId;
                  return (
                    <TouchableOpacity
                      key={acc.id}
                      style={[styles.chip, { borderColor: isActive ? color : COLORS.cardBorder, backgroundColor: isActive ? color + '22' : 'transparent', opacity: isDisabled ? 0.35 : 1 }]}
                      onPress={() => setTargetAccountId(acc.id)}
                      disabled={isDisabled}
                    >
                      <Text style={[styles.chipText, { color: isActive ? color : COLORS.text }]}>{acc.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}

          {/* Libellé */}
          <Text style={styles.label}>Libellé {isTransfer ? '' : '(optionnel)'}</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={isTransfer ? "Ex. Virement épargne..." : "Ex. Courses, Salaire..."}
            placeholderTextColor={COLORS.textSecondary}
            returnKeyType="next"
          />

          {/* Montant */}
          <Text style={styles.label}>Montant (€)</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          {/* Date */}
          <Text style={styles.label}>Date</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={dateDisplay}
              onChangeText={(text) => {
                setDateDisplay(text);
                const parsed = parseDateFromFrench(text);
                if (parsed) setDate(parsed);
              }}
              onBlur={() => {
                if (date) setDateDisplay(formatDateFrench(date));
              }}
              placeholder="jj-mm-aaaa"
              placeholderTextColor={COLORS.textSecondary}
            />
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => setShowCalendar('date')}
            >
              <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {!isTransfer && (
            <CategoryPicker
              key={isExpense ? 'expense' : 'income'}
              groups={categoryGroups}
              selectedCategoryId={categoryId}
              onSelect={setCategoryId}
              label="Sous-catégorie (optionnel)"
            />
          )}

          <View style={styles.recurringSection}>
            <TouchableOpacity
              style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>{isTransfer ? 'Virement récurrent' : 'Récurrent (ex. salaire mensuel)'}</Text>
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
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    value={recurrenceEndDateInput}
                    onChangeText={setRecurrenceEndDateInput}
                    placeholder="jj-mm-aaaa ou vide"
                    placeholderTextColor={COLORS.textSecondary}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity
                    style={styles.calendarBtn}
                    onPress={() => setShowCalendar('end')}
                  >
                    <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <View style={styles.submitRow}>
            <TouchableOpacity
              style={[styles.submitBtn, styles.submitBtnPrimary, addTransaction.isPending && styles.submitBtnDisabled]}
              onPress={() => handleSubmit(false)}
              disabled={addTransaction.isPending}
              accessibilityRole="button"
            >
              {addTransaction.isPending ? (
                <ActivityIndicator color={COLORS.bg} />
              ) : (
                <Text style={styles.submitLabel}>Enregistrer</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, styles.submitBtnDraft, addTransaction.isPending && styles.submitBtnDisabled]}
              onPress={() => handleSubmit(true)}
              disabled={addTransaction.isPending}
              accessibilityRole="button"
            >
              <Text style={styles.submitLabelDraft}>Brouillon</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Calendar Modal */}
        <Modal visible={!!showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
          <View style={styles.calendarOverlay}>
            <View style={styles.calendarContainer}>
              <View style={styles.calendarHeader}>
                <TouchableOpacity onPress={() => setShowCalendar(false)}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.emerald }}>Fermer</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text }}>
                  {showCalendar === 'end' ? 'Date de fin' : 'Sélectionner une date'}
                </Text>
                <View style={{ width: 50 }} />
              </View>
              <Calendar
                current={showCalendar === 'end' ? (recurrenceEndDateInput || date) : date}
                maxDate="2050-12-31"
                onDayPress={(day: any) => {
                  if (showCalendar === 'end') {
                    setRecurrenceEndDateInput(formatDateFrench(day.dateString));
                  } else {
                    setDate(day.dateString);
                    setDateDisplay(formatDateFrench(day.dateString));
                  }
                  setShowCalendar(false);
                }}
                markedDates={(() => {
                  const d = showCalendar === 'end' ? recurrenceEndDateInput : date;
                  if (!d) return {};
                  return { [d]: { selected: true, selectedColor: COLORS.emerald, selectedTextColor: '#fff' } };
                })()}
                theme={{
                  backgroundColor: COLORS.card,
                  calendarBackground: COLORS.card,
                  textSectionTitleColor: COLORS.text,
                  selectedDayBackgroundColor: COLORS.emerald,
                  selectedDayTextColor: '#ffffff',
                  todayTextColor: COLORS.emerald,
                  dayTextColor: COLORS.text,
                  textDisabledColor: '#334155',
                  monthTextColor: COLORS.text,
                  arrowColor: COLORS.emerald,
                }}
              />
            </View>
          </View>
        </Modal>
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
  typeSelector: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder },
  typeBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  typeBtnLabelActive: { color: COLORS.bg },
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
  chipTextDisabled: { opacity: 0.5 },
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
  submitRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  submitBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitBtnPrimary: { backgroundColor: COLORS.emerald },
  submitBtnDraft: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#475569' },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  submitLabelDraft: { fontSize: 16, fontWeight: '600', color: '#94a3b8' },
  calendarBtn: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  calendarContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    width: '90%',
    maxWidth: 380,
    overflow: 'hidden',
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
});
