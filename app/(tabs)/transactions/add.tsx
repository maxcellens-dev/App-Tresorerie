import { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../components/CalendarWithPicker';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts } from '../../hooks/useAccounts';
import { useCategories } from '../../hooks/useCategories';
import { useAddTransaction, useTransactions } from '../../hooks/useTransactions';
import CategoryPicker, { useSubCategoriesGrouped } from '../../components/CategoryPicker';
import type { RecurrenceRule } from '../../types/database';
import HeaderWithProfile from '../../components/HeaderWithProfile';
import { formatDateFrench, parseDateFromFrench, todayISO } from '../../lib/dateUtils';
import { accountColor } from '../../theme/colors';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';


type TransactionType = 'expense' | 'income' | 'transfer';

export default function AddTransactionScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
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
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const isExpense = transactionType === 'expense';
  const isIncome = transactionType === 'income';
  const isTransfer = transactionType === 'transfer';

  // Dépense / Recette → comptes courants uniquement. Virement → tous les comptes.
  const selectableAccounts = isTransfer ? accounts : accounts.filter(a => a.type === 'checking');

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  useEffect(() => setCategoryId(''), [isExpense, isIncome]);

  // Dépense / Recette → forcer un compte courant si le compte sélectionné ne l'est pas
  useEffect(() => {
    if (isTransfer || !accountId) return;
    const acc = accounts.find(a => a.id === accountId);
    if (acc && acc.type !== 'checking') {
      const firstChecking = accounts.find(a => a.type === 'checking');
      setAccountId(firstChecking ? firstChecking.id : '');
    }
  }, [transactionType, accounts, accountId, isTransfer]);

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

  function showError(msg: string, fields: string[] = []) {
    setFormError(msg);
    setErrorFields(fields);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function handleSubmit(isDraft = false) {
    setFormError(null);
    setErrorFields([]);

    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      showError('Le montant est obligatoire et doit être supérieur à 0.', ['amount']);
      return;
    }
    if (!accountId) {
      showError('Veuillez choisir un compte source.', ['account']);
      return;
    }

    // Sous-catégorie obligatoire pour une dépense / recette validée (les brouillons restent libres).
    if (!isTransfer && !isDraft && !categoryId) {
      showError('Veuillez choisir une sous-catégorie.', ['category']);
      return;
    }

    if (isTransfer) {
      if (!targetAccountId) {
        showError('Veuillez choisir un compte de destination.', ['targetAccount']);
        return;
      }
      if (accountId === targetAccountId) {
        showError('Le compte source et le compte de destination doivent être différents.', ['targetAccount']);
        return;
      }
    }

    // Pour un virement, le compte source est toujours débité (négatif)
    const finalAmount = (isExpense || isTransfer) ? -Math.abs(num) : Math.abs(num);
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
      showError(e instanceof Error ? e.message : 'Impossible d\'enregistrer.');
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
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <HeaderWithProfile title="Nouvelle transaction" showBack={true} hideProfile={true} />
        
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {formError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorBannerText}>{formError}</Text>
            </View>
          )}
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
            {selectableAccounts.map((acc) => {
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
          {selectableAccounts.length === 0 && (
            <Text style={styles.hint}>
              {isTransfer ? 'Aucun compte.' : 'Aucun compte courant.'} Ajoutez-en un dans l'onglet Comptes.
            </Text>
          )}
          {!isTransfer && (
            <Text style={styles.hint}>Les dépenses et recettes se font depuis un compte courant.</Text>
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
          <Text style={styles.label}>Montant ({CURRENCY_SYMBOL}) *</Text>
          <TextInput
            style={[styles.input, errorFields.includes('amount') && styles.inputError]}
            value={amount}
            onChangeText={(v) => { setAmount(v); setErrorFields((p) => p.filter((f) => f !== 'amount')); setFormError(null); }}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => handleSubmit()}
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
              onSelect={(id) => { setCategoryId(id); setErrorFields((p) => p.filter((f) => f !== 'category')); setFormError(null); }}
              label="Sous-catégorie *"
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
                    onSubmitEditing={() => handleSubmit()}
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
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  typeSelector: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder },
  typeBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  typeBtnLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  typeBtnLabelActive: { color: c.bg },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  toggleLabelActive: { color: c.bg },
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
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  chipTextDisabled: { opacity: 0.5 },
  inputError: { borderColor: c.danger },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.danger + '1F',
    borderWidth: 1,
    borderColor: c.danger + '66',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  errorBannerText: { flex: 1, fontSize: 13, color: c.danger, lineHeight: 18 },
  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 16 },
  text: { color: c.text, marginBottom: 16 },
  btn: { backgroundColor: c.card, padding: 14, borderRadius: 12, alignSelf: 'flex-start' },
  btnLabel: { color: c.text, fontWeight: '600' },
  recurringSection: { marginTop: 8, marginBottom: 16 },
  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginBottom: 12,
  },
  recurringToggleActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  recurringLabel: { fontSize: 15, color: c.textSecondary },
  recurringLabelActive: { color: c.bg, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  submitRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  submitBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitBtnPrimary: { backgroundColor: c.emerald },
  submitBtnDraft: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#475569' },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  submitLabelDraft: { fontSize: 16, fontWeight: '600', color: '#94a3b8' },
  calendarBtn: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    borderBottomColor: c.cardBorder,
  },
});
}
