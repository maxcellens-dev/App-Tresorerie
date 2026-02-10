import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Calendar } from 'react-native-calendars';
import { useAuth } from '../../../contexts/AuthContext';
import { useAccounts } from '../../../hooks/useAccounts';
import { useCategories } from '../../../hooks/useCategories';
import { useTransactions, useUpdateTransaction, useDeleteTransaction } from '../../../hooks/useTransactions';
import CategoryPicker, { useSubCategoriesGrouped } from '../../../components/CategoryPicker';
import type { RecurrenceRule } from '../../../types/database';
import { formatDateFrench, parseDateFromFrench } from '../../../lib/dateUtils';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
};

export default function EditTransactionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { user } = useAuth();
  const { data: transactions = [] } = useTransactions(user?.id);
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);

  const tx = transactions.find((t) => t.id === id);
  const isPast = tx ? new Date(tx.date) < new Date(new Date().toISOString().slice(0, 10)) : false;

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [dateDisplay, setDateDisplay] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState('');
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end'>(false);

  useEffect(() => {
    if (tx) {
      setAmount(Math.abs(tx.amount).toString());
      setDate(tx.date);
      setDateDisplay(formatDateFrench(tx.date));
      setNote(tx.note ?? '');
      setAccountId(tx.account_id);
      setCategoryId(tx.category_id ?? '');
      setIsExpense(tx.amount < 0);
      setIsRecurring(tx.is_recurring ?? false);
      setRecurrenceRule((tx.recurrence_rule as RecurrenceRule) ?? 'monthly');
      setRecurrenceEndDateInput(tx.recurrence_end_date ? formatDateFrench(tx.recurrence_end_date) : '');
    }
  }, [tx]);

  async function handleSubmit() {
    if (!id || !tx) return;
    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant.');
      return;
    }
    const finalAmount = isExpense ? -Math.abs(num) : Math.abs(num);
    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;
    try {
      await updateTx.mutateAsync({
        id,
        account_id: accountId,
        category_id: categoryId ? categoryId : null,
        amount: finalAmount,
        date,
        note: note || undefined,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
      });
      router.back();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’enregistrer.');
    }
  }

  function handleDelete() {
    if (!id) return;
    const message = isPast
      ? 'Cette transaction est passée. La supprimer mettra à jour le solde du compte. Confirmer ?'
      : 'Supprimer cette transaction ? Le solde du compte sera mis à jour.';
    const doDelete = () => {
      deleteTx.mutateAsync(id).then(() => router.back()).catch((e: unknown) => {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer.');
      });
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Supprimer la transaction\n\n${message}`)) doDelete();
      return;
    }
    Alert.alert('Supprimer la transaction', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: doDelete },
    ]);
  }

  if (!user || !tx) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.text}>{tx ? 'Transaction introuvable.' : 'Chargement…'}</Text>
        </SafeAreaView>
      </View>
    );
  }

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  const prevIsExpense = useRef(isExpense);
  useEffect(() => {
    if (prevIsExpense.current !== isExpense) {
      prevIsExpense.current = isExpense;
      setCategoryId('');
    }
  }, [isExpense]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Modifier la transaction</Text>
        {isPast && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={20} color={COLORS.danger} />
            <Text style={styles.warningText}>Transaction passée. La modifier ou supprimer met à jour le solde du compte.</Text>
          </View>
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.toggle}>
            <TouchableOpacity style={[styles.toggleBtn, isExpense && styles.toggleBtnActive]} onPress={() => setIsExpense(true)}>
              <Text style={[styles.toggleLabel, isExpense && styles.toggleLabelActive]}>Dépense</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, !isExpense && styles.toggleBtnActive]} onPress={() => setIsExpense(false)}>
              <Text style={[styles.toggleLabel, !isExpense && styles.toggleLabelActive]}>Recette</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Montant (€)</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" />

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
              onBlur={() => { if (date) setDateDisplay(formatDateFrench(date)); }}
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

          <Text style={styles.label}>Compte</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {accounts.map((acc) => (
              <TouchableOpacity key={acc.id} style={[styles.chip, accountId === acc.id && styles.chipActive]} onPress={() => setAccountId(acc.id)}>
                <Text style={[styles.chipText, accountId === acc.id && styles.chipTextActive]}>{acc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

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
            <TouchableOpacity style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]} onPress={() => setIsRecurring(!isRecurring)}>
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>Récurrent</Text>
            </TouchableOpacity>
            {isRecurring && (
              <>
                <View style={styles.chipRow}>
                  {(['weekly', 'monthly', 'quarterly', 'yearly'] as RecurrenceRule[]).map((rule) => (
                    <TouchableOpacity key={rule} style={[styles.chip, recurrenceRule === rule && styles.chipActive]} onPress={() => setRecurrenceRule(rule)}>
                      <Text style={[styles.chipText, recurrenceRule === rule && styles.chipTextActive]}>{rule === 'weekly' ? 'Hebdo' : rule === 'monthly' ? 'Mensuel' : rule === 'quarterly' ? 'Trim.' : 'Annuel'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
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

          <TouchableOpacity style={[styles.submitBtn, updateTx.isPending && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={updateTx.isPending} accessibilityRole="button">
            {updateTx.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.submitLabel}>Enregistrer</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={deleteTx.isPending} accessibilityRole="button">
            <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
            <Text style={styles.deleteLabel}>Supprimer la transaction</Text>
          </TouchableOpacity>
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
                current={showCalendar === 'end' ? (parseDateFromFrench(recurrenceEndDateInput) || date) : date}
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
                  const d = showCalendar === 'end' ? (parseDateFromFrench(recurrenceEndDateInput) || '') : date;
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
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(248,113,113,0.15)', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.danger },
  warningText: { flex: 1, fontSize: 13, color: COLORS.danger },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary },
  toggleLabelActive: { color: COLORS.bg },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: COLORS.text, marginBottom: 20 },
  chipScroll: { marginBottom: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COLORS.cardBorder, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  chipText: { fontSize: 14, color: COLORS.text },
  chipTextActive: { color: COLORS.bg, fontWeight: '600' },
  recurringSection: { marginTop: 8, marginBottom: 16 },
  recurringToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 12 },
  recurringToggleActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  recurringLabel: { fontSize: 15, color: COLORS.textSecondary },
  recurringLabelActive: { color: COLORS.bg, fontWeight: '600' },
  submitBtn: { backgroundColor: COLORS.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingVertical: 14 },
  deleteLabel: { fontSize: 15, color: COLORS.danger, fontWeight: '600' },
  text: { color: COLORS.text },
  calendarBtn: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  calendarOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  calendarContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    padding: 8,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
});
