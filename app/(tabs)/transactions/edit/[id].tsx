import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, Modal } from 'react-native';
// Alert/Platform kept for validation alerts (invalid amount, missing date, etc.)
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../../components/CalendarWithPicker';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useAccounts } from '../../../hooks/useAccounts';
import { useCategories } from '../../../hooks/useCategories';
import { useTransactions, useUpdateTransaction, useDeleteTransaction } from '../../../hooks/useTransactions';
import { useTransactionMonthOverrides, useSetTransactionMonthOverride, useDeleteTransactionMonthOverride } from '../../../hooks/useTransactionMonthOverrides';
import CategoryPicker, { useSubCategoriesGrouped } from '../../../components/CategoryPicker';
import type { RecurrenceRule } from '../../../types/database';
import { formatDateFrench, parseDateFromFrench } from '../../../lib/dateUtils';
import { accountColor } from '../../../theme/colors';
import { supabase } from '../../../lib/supabase';

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
  const params = useLocalSearchParams<{ id: string; instanceDate?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const instanceDate = Array.isArray(params.instanceDate) ? params.instanceDate[0] : params.instanceDate;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: transactions = [] } = useTransactions(user?.id);
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);
  const setOverride = useSetTransactionMonthOverride(user?.id);
  const deleteOverride = useDeleteTransactionMonthOverride(user?.id);

  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void;
  } | null>(null);

  function showConfirm(opts: { title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }) {
    setConfirmModal(opts);
  }

  const tx = transactions.find((t) => t.id === id);
  const isPast = tx ? new Date(tx.date) < new Date(new Date().toISOString().slice(0, 10)) : false;
  const isVirement = !!(tx as any)?.linked_account_id;
  const instanceYear = instanceDate ? Number(instanceDate.split('-')[0]) : undefined;
  const instanceMonth = instanceDate ? Number(instanceDate.split('-')[1]) : undefined;
  const { data: instanceOverrides = [] } = useTransactionMonthOverrides(user?.id, instanceYear, instanceMonth);
  // Only use an override when we're editing a specific instance (instanceDate is set) and it matches this transaction
  const currentInstanceOverride = instanceDate ? instanceOverrides.find(o => o.transaction_id === id) : undefined;
  const [editMode, setEditMode] = useState<'single' | 'future'>(instanceDate ? 'single' : 'future');

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
  const [futureAmount, setFutureAmount] = useState('');
  const [futureAmountDate, setFutureAmountDate] = useState('');
  const [futureAmountDateDisplay, setFutureAmountDateDisplay] = useState('');
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end' | 'future'>(false);

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  const prevIsExpense = useRef(isExpense);

  useEffect(() => {
    if (tx) {
      const initialAmount = currentInstanceOverride ? currentInstanceOverride.override_amount : Number(tx.amount);
      setAmount(Math.abs(initialAmount).toString());
      setDate(instanceDate ?? tx.date);
      setDateDisplay(formatDateFrench(instanceDate ?? tx.date));
      setNote(tx.note ?? '');
      setAccountId(tx.account_id);
      setCategoryId(tx.category_id ?? '');
      setIsExpense(tx.amount < 0);
      setIsRecurring(tx.is_recurring ?? false);
      setRecurrenceRule((tx.recurrence_rule as RecurrenceRule) ?? 'monthly');
      setRecurrenceEndDateInput(tx.recurrence_end_date ? formatDateFrench(tx.recurrence_end_date) : '');
      setFutureAmount('');
      setFutureAmountDate('');
      setFutureAmountDateDisplay('');
    }
  }, [tx, instanceDate, currentInstanceOverride]);

  useEffect(() => {
    if (prevIsExpense.current !== isExpense) {
      prevIsExpense.current = isExpense;
      setCategoryId('');
    }
  }, [isExpense]);

  useEffect(() => {
    if (instanceDate && editMode === 'future' && !futureAmountDate) {
      setFutureAmountDate(instanceDate);
      setFutureAmountDateDisplay(formatDateFrench(instanceDate));
    }
  }, [instanceDate, editMode, futureAmountDate]);

  function toIsoDate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const closeEditor = () => {
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/transactions');
  };

  const isInstanceEdit = Boolean(instanceDate && tx?.is_recurring);
  const isInstanceOccurrenceEdit = isInstanceEdit && editMode === 'single';

  async function handleSubmitWithDraft(isDraft = false) {
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

    const futureAmountNum = futureAmount.trim() ? parseFloat(futureAmount.replace(',', '.')) : null;
    const effectiveDateISO = futureAmountDate.trim()
      ? (parseDateFromFrench(futureAmountDate.trim()) || futureAmountDate.trim())
      : '';

    if (futureAmount.trim() && !effectiveDateISO) {
      Alert.alert("Date d'effet manquante", "Indiquez la date à partir de laquelle appliquer le nouveau montant.");
      return;
    }

    if (effectiveDateISO && (!futureAmountNum || Number.isNaN(futureAmountNum))) {
      Alert.alert('Montant futur invalide', 'Saisissez un montant futur valide.');
      return;
    }

    if (isInstanceOccurrenceEdit) {
      const [year, month] = instanceDate!.split('-').map(Number);
      const originalAmount = Number(tx.amount);
      const currentOverrideAmount = currentInstanceOverride?.override_amount;

      const amountUnchanged =
        (currentOverrideAmount !== undefined && Math.abs(finalAmount - currentOverrideAmount) < 0.01) ||
        (currentOverrideAmount === undefined && Math.abs(finalAmount - originalAmount) < 0.01);
      const categoryChanged = categoryId !== (tx.category_id ?? '');

      if (amountUnchanged && !categoryChanged) {
        closeEditor();
        return;
      }

      try {
        if (!amountUnchanged) {
          if (currentOverrideAmount !== undefined && Math.abs(finalAmount - originalAmount) < 0.01) {
            await deleteOverride.mutateAsync({ transaction_id: id, year, month });
          } else {
            await setOverride.mutateAsync({ transaction_id: id, year, month, override_amount: finalAmount });
          }
        }
        if (categoryChanged) {
          await updateTx.mutateAsync({ id, category_id: categoryId ? categoryId : null });
        }
        closeEditor();
      } catch (e: unknown) {
        Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
      }
      return;
    }

    const shouldUpdateFutureAmount = isRecurring && editMode === 'future' && futureAmountNum !== null && !Number.isNaN(futureAmountNum);
    if (shouldUpdateFutureAmount) {
      const newRecurringAmount = isExpense ? -Math.abs(futureAmountNum) : Math.abs(futureAmountNum);
      try {
        if (effectiveDateISO && effectiveDateISO > tx.date) {
          // Tronquer la série originale à la veille de la date d'effet (pas de changement de montant = pas de mise à jour du solde)
          const d = new Date(effectiveDateISO + 'T00:00:00');
          d.setDate(d.getDate() - 1);
          const dayBefore = toIsoDate(d);
          await updateTx.mutateAsync({ id, recurrence_end_date: dayBefore });
          // Créer la nouvelle série à partir de la date d'effet sans modifier le solde du compte
          const { error } = await supabase!.from('transactions').insert({
            profile_id: user!.id,
            account_id: accountId,
            category_id: categoryId || null,
            amount: newRecurringAmount,
            date: effectiveDateISO,
            note: note || null,
            is_forecast: false,
            is_recurring: true,
            recurrence_rule: recurrenceRule,
            recurrence_end_date: endDateISO,
            project_id: null,
            linked_account_id: null,
          });
          if (error) throw error;
          queryClient.invalidateQueries({ queryKey: ['transactions', user!.id] });
          queryClient.invalidateQueries({ queryKey: ['pilotage_data', user!.id] });
        } else {
          // La date d'effet est la même que le début de la récurrence : juste mettre à jour le montant
          await updateTx.mutateAsync({
            id,
            account_id: accountId,
            category_id: categoryId ? categoryId : null,
            amount: newRecurringAmount,
            note: note || undefined,
            is_recurring: true,
            recurrence_rule: recurrenceRule,
            recurrence_end_date: endDateISO,
          });
        }
        closeEditor();
      } catch (e: unknown) {
        Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
      }
      return;
    }

    try {
      await updateTx.mutateAsync({
        id,
        account_id: accountId,
        category_id: categoryId ? categoryId : null,
        amount: finalAmount,
        date,
        note: note || undefined,
        is_draft: isDraft,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
      });
      closeEditor();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
    }
  }

  function handleDelete() {
    if (!id) return;
    const message = isPast
      ? 'Cette transaction est passée. La supprimer mettra à jour le solde du compte.'
      : 'Supprimer cette transaction ?';
    showConfirm({
      title: 'Supprimer la transaction',
      message,
      confirmLabel: 'Supprimer',
      confirmColor: '#f87171',
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(id);
          router.back();
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de supprimer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  if (!user || !tx) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.text}>{tx ? 'Transaction introuvable.' : 'Chargement…'}</Text>
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
        <Text style={styles.title}>Modifier la transaction</Text>
        {isPast && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={20} color={COLORS.danger} />
            <Text style={styles.warningText}>Transaction passée. La modifier ou supprimer met à jour le solde du compte.</Text>
          </View>
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isVirement ? (
            /* ── Virement : affichage read-only type + comptes ── */
            <>
              <View style={styles.virementBadge}>
                <Ionicons name="swap-horizontal" size={16} color="#60a5fa" />
                <Text style={styles.virementBadgeText}>Virement</Text>
              </View>
              <Text style={styles.label}>Compte source → destination</Text>
              <View style={styles.virementAccounts}>
                <Text style={styles.virementAccountText}>
                  {accounts.find((a) => a.id === (tx as any).account_id)?.name ?? '—'}
                </Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} style={{ marginHorizontal: 8 }} />
                <Text style={styles.virementAccountText}>
                  {accounts.find((a) => a.id === (tx as any).linked_account_id)?.name ?? '—'}
                </Text>
              </View>
            </>
          ) : (
            /* ── Dépense / Recette ── */
            <>
              <View style={styles.toggle}>
                <TouchableOpacity style={[styles.toggleBtn, isExpense && styles.toggleBtnActive]} onPress={() => setIsExpense(true)}>
                  <Text style={[styles.toggleLabel, isExpense && styles.toggleLabelActive]}>Dépense</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, !isExpense && styles.toggleBtnActive]} onPress={() => setIsExpense(false)}>
                  <Text style={[styles.toggleLabel, !isExpense && styles.toggleLabelActive]}>Recette</Text>
                </TouchableOpacity>
              </View>

              {/* Compte */}
              <Text style={styles.label}>Compte</Text>
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
            </>
          )}

          {/* Libellé */}
          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Ex. Courses, Salaire..."
            placeholderTextColor={COLORS.textSecondary}
            returnKeyType="next"
          />

          {/* Montant */}
          <Text style={styles.label}>{isRecurring ? 'Montant actuel' : 'Montant (€)'}</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            placeholderTextColor={COLORS.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={() => handleSubmitWithDraft(false)}
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
          {isRecurring && !isInstanceOccurrenceEdit && (
            <Text style={styles.hint}>Ce montant reste appliqué aux échéances avant la date de changement.</Text>
          )}
          {isInstanceOccurrenceEdit && (
            <Text style={styles.hint}>Cette modification s'appliquera uniquement à cette échéance.</Text>
          )}

          <View style={styles.recurringSection}>
            <TouchableOpacity
              style={[styles.recurringToggle, isRecurring && styles.recurringToggleActive]}
              onPress={() => setIsRecurring(!isRecurring)}
              disabled={isInstanceEdit}
            >
              <Ionicons name={isRecurring ? 'repeat' : 'repeat-outline'} size={22} color={isRecurring ? COLORS.bg : COLORS.textSecondary} />
              <Text style={[styles.recurringLabel, isRecurring && styles.recurringLabelActive]}>Récurrent</Text>
            </TouchableOpacity>
            {isRecurring && (
              <>
                {isInstanceEdit && (
                  <View style={styles.instanceModeRow}>
                    <TouchableOpacity
                      style={[styles.instanceModeBtn, editMode === 'single' && styles.instanceModeBtnActive]}
                      onPress={() => setEditMode('single')}
                    >
                      <Text style={[styles.instanceModeLabel, editMode === 'single' && styles.instanceModeLabelActive]}>Cette échéance uniquement</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.instanceModeBtn, editMode === 'future' && styles.instanceModeBtnActive]}
                      onPress={() => setEditMode('future')}
                    >
                      <Text style={[styles.instanceModeLabel, editMode === 'future' && styles.instanceModeLabelActive]}>Modifier la récurrence</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {isInstanceEdit && editMode === 'single' && (
                  <Text style={styles.hint}>Cette modification s'appliquera uniquement à cette échéance.</Text>
                )}
                {isRecurring && (!isInstanceEdit || editMode === 'future') && (
                  <>
                    <View style={styles.chipRow}>
                      {(['weekly', 'monthly', 'quarterly', 'yearly'] as RecurrenceRule[]).map((rule) => (
                        <TouchableOpacity key={rule} style={[styles.chip, recurrenceRule === rule && styles.chipActive]} onPress={() => setRecurrenceRule(rule)}>
                          <Text style={[styles.chipText, recurrenceRule === rule && styles.chipTextActive]}>{rule === 'weekly' ? 'Hebdo' : rule === 'monthly' ? 'Mensuel' : rule === 'quarterly' ? 'Trim.' : 'Annuel'}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={[styles.label, { marginBottom: 8 }]}>Date de fin de la récurrence (optionnel)</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        value={recurrenceEndDateInput}
                        onChangeText={setRecurrenceEndDateInput}
                        placeholder="jj-mm-aaaa ou vide"
                        placeholderTextColor={COLORS.textSecondary}
                        returnKeyType="done"
                        onSubmitEditing={() => handleSubmitWithDraft(false)}
                      />
                      <TouchableOpacity
                        style={styles.calendarBtn}
                        onPress={() => setShowCalendar('end')}
                      >
                        <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.futureBlock}>
                      <Text style={styles.sectionTitle}>Modifier le montant futur</Text>
                      <Text style={styles.label}>Date d'effet</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                        <TextInput
                          style={[styles.input, { flex: 1, marginBottom: 0 }]}
                          value={futureAmountDateDisplay}
                          onChangeText={(text) => {
                            setFutureAmountDateDisplay(text);
                            const parsed = parseDateFromFrench(text);
                            if (parsed) setFutureAmountDate(parsed);
                          }}
                          placeholder="jj-mm-aaaa"
                          placeholderTextColor={COLORS.textSecondary}
                        />
                        <TouchableOpacity
                          style={styles.calendarBtn}
                          onPress={() => setShowCalendar('future')}
                        >
                          <Ionicons name="calendar-outline" size={22} color={COLORS.emerald} />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.label}>Nouveau montant récurrent</Text>
                      <TextInput
                        style={styles.input}
                        value={futureAmount}
                        onChangeText={setFutureAmount}
                        placeholder="0,00"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={() => handleSubmitWithDraft(false)}
                      />
                      <Text style={styles.hint}>Les échéances antérieures à la date choisie restent avec l'ancien montant. Le nouveau montant s'appliquera seulement pour les échéances suivantes.</Text>
                    </View>
                  </>
                )}
              </>
            )}
          </View>

          {/* Sous-catégorie */}
          <CategoryPicker
            key={isExpense ? 'expense' : 'income'}
            groups={categoryGroups}
            selectedCategoryId={categoryId}
            onSelect={setCategoryId}
            label="Sous-catégorie (optionnel)"
          />

          <View style={styles.submitRow}>
            <TouchableOpacity
              style={[styles.submitBtn, styles.submitBtnPrimary, updateTx.isPending && styles.submitBtnDisabled]}
              onPress={() => handleSubmitWithDraft(false)}
              disabled={updateTx.isPending}
              accessibilityRole="button"
            >
              {updateTx.isPending ? <ActivityIndicator color={COLORS.bg} /> : (
                <Text style={styles.submitLabel}>
                  {tx?.is_draft ? (isExpense ? 'Valider la dépense' : 'Valider la recette') : 'Enregistrer'}
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, styles.submitBtnDraft, updateTx.isPending && styles.submitBtnDisabled]}
              onPress={() => handleSubmitWithDraft(true)}
              disabled={updateTx.isPending}
              accessibilityRole="button"
            >
              <Text style={styles.submitLabelDraft}>{tx?.is_draft ? 'Enregistrer' : 'Brouillon'}</Text>
            </TouchableOpacity>
          </View>
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
              <CalendarWithPicker
                current={showCalendar === 'end'
                  ? (parseDateFromFrench(recurrenceEndDateInput) || date)
                  : showCalendar === 'future'
                    ? futureAmountDate || date
                    : date}
                maxDate="2050-12-31"
                onDayPress={(day: any) => {
                  if (showCalendar === 'end') {
                    setRecurrenceEndDateInput(formatDateFrench(day.dateString));
                  } else if (showCalendar === 'future') {
                    setFutureAmountDate(day.dateString);
                    setFutureAmountDateDisplay(formatDateFrench(day.dateString));
                  } else {
                    setDate(day.dateString);
                    setDateDisplay(formatDateFrench(day.dateString));
                  }
                  setShowCalendar(false);
                }}
                markedDates={(() => {
                  const d = showCalendar === 'end'
                    ? (parseDateFromFrench(recurrenceEndDateInput) || '')
                    : showCalendar === 'future'
                      ? futureAmountDate
                      : date;
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

        {/* Confirm Modal */}
        <Modal visible={!!confirmModal} transparent animationType="fade" onRequestClose={() => setConfirmModal(null)}>
          <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setConfirmModal(null)}>
            <TouchableOpacity style={styles.confirmBox} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
              <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
              <View style={styles.confirmBtns}>
                <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmModal(null)}>
                  <Text style={styles.confirmCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmOk, { borderColor: confirmModal?.confirmColor ?? '#34d399', backgroundColor: (confirmModal?.confirmColor ?? '#34d399') + '18' }]}
                  onPress={() => { const cb = confirmModal?.onConfirm; setConfirmModal(null); cb?.(); }}
                >
                  <Text style={[styles.confirmOkText, { color: confirmModal?.confirmColor ?? '#34d399' }]}>{confirmModal?.confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(248,113,113,0.15)', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.danger },
  warningText: { flex: 1, fontSize: 13, color: COLORS.danger },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  virementBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e3a5f', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 20, alignSelf: 'flex-start' as const },
  virementBadgeText: { fontSize: 14, fontWeight: '700', color: '#60a5fa' },
  virementAccounts: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 20 },
  virementAccountText: { flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.text, textAlign: 'center' as const },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textSecondary },
  toggleLabelActive: { color: COLORS.bg },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: COLORS.text, marginBottom: 20 },
  hint: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 16 },
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
  instanceModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  instanceModeBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, backgroundColor: COLORS.card, alignItems: 'center' },
  instanceModeBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  instanceModeLabel: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  instanceModeLabelActive: { color: COLORS.bg, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  futureBlock: { backgroundColor: '#08101f', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 16 },
  submitRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  submitBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitBtnPrimary: { backgroundColor: COLORS.emerald },
  submitBtnDraft: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#475569' },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  submitLabelDraft: { fontSize: 16, fontWeight: '600', color: '#94a3b8' },
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
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: COLORS.card, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: COLORS.cardBorder },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  confirmMessage: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' },
  confirmCancelText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 15 },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmOkText: { fontWeight: '700', fontSize: 15 },
});
