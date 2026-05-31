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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../components/CalendarWithPicker';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useAddTransaction } from '../../hooks/useTransactions';
import HeaderWithProfile from '../../components/HeaderWithProfile';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../lib/dateUtils';
import type { RecurrenceRule } from '../../types/database';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';


export default function TransferScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const { user } = useAuth();
  const { data: accounts = [] } = useAccounts(user?.id);
  const addTransaction = useAddTransaction(user?.id);

  const [fromAccountId, setFromAccountId] = useState(params.from || '');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [dateDisplay, setDateDisplay] = useState(formatDateFrench(todayISO()));
  const [note, setNote] = useState('Virement interne');
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end'>(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState('');

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

    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;

    try {
      await addTransaction.mutateAsync({
        account_id: fromAccountId,
        category_id: null,
        amount: -Math.abs(num),
        date,
        note: note || 'Virement interne',
        linked_account_id: toAccountId,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
      });
      await addTransaction.mutateAsync({
        account_id: toAccountId,
        category_id: null,
        amount: Math.abs(num),
        date,
        note: note || 'Virement interne',
        linked_account_id: fromAccountId,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
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
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
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
                <Text style={[styles.chipSubtext, fromAccountId === acc.id && styles.chipSubtextActive]}>
                  {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                </Text>
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
                <Text style={[styles.chipSubtext, toAccountId === acc.id && styles.chipSubtextActive]}>
                  {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Montant ({CURRENCY_SYMBOL})</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
          />

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

          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Ex. Virement interne"
            placeholderTextColor={COLORS.textSecondary}
          />

          {/* Récurrence */}
          <View style={styles.recurringSection}>
            <TouchableOpacity
              style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>Virement récurrent</Text>
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
                  />
                  <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowCalendar('end')}>
                    <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

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
              <CalendarWithPicker
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
                  return { [d]: { selected: true, selectedColor: COLORS.emerald, selectedTextColor: '#000' } };
                })()}
                accentColor={COLORS.emerald}
                bgColor={COLORS.card}
                textColor={COLORS.text}
                textSecondaryColor="#334155"
              />
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}) },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
    marginBottom: 20,
  },
  chipScroll: { marginBottom: 16 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginRight: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  chipSubtext: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  chipSubtextActive: { color: c.bg },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  recurringSection: { marginTop: 4, marginBottom: 8 },
  recurringToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  recurringToggleActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  recurringLabel: { fontSize: 15, color: c.textSecondary },
  recurringLabelActive: { color: c.bg, fontWeight: '600' },
  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 16 },
  text: { color: c.text, marginBottom: 16 },
  btn: {
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 12,
    alignSelf: 'flex-start',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  btnLabel: { color: c.text, fontWeight: '600' },
  submitBtn: {
    backgroundColor: c.emerald,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 24,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  calendarBtn: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
}
