import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Modal, Pressable } from 'react-native';
import ScreenGradient from '../../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import CalendarWithPicker from '../../../../components/CalendarWithPicker';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { useMonthlyClosure } from '../../../../hooks/useMonthlyClosure';
import { useAllAccounts } from '../../../../hooks/useAccounts';
import { useCategories, useAddCategory } from '../../../../hooks/useCategories';
import { useAllTransactions, useUpdateTransaction, useDeleteTransaction } from '../../../../hooks/useTransactions';
import { useTransactionMonthOverrides, useSetTransactionMonthOverride, useDeleteTransactionMonthOverride } from '../../../../hooks/useTransactionMonthOverrides';
import CategoryPicker, { useSubCategoriesGrouped } from '../../../../components/CategoryPicker';
import { isRegulRow } from '../../../../lib/txOrder';
import type { RecurrenceRule } from '../../../../types/database';
import { formatDateFrench, parseDateFromFrench } from '../../../../lib/dateUtils';
import { accountColor } from '../../../../theme/colors';
import { supabase } from '../../../../lib/supabase';
import { useAppColors } from '../../../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../../../lib/currency';
import { useKeyboardAwareScroll } from '../../../../hooks/useKeyboardAwareScroll';


export default function EditTransactionScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; instanceDate?: string; origin?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const instanceDate = Array.isArray(params.instanceDate) ? params.instanceDate[0] : params.instanceDate;
  const origin = Array.isArray(params.origin) ? params.origin[0] : params.origin;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: transactions = [] } = useAllTransactions(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  // Verrou de clôture gaté par le flag (null si Clôture désactivée → édition libre).
  const { lockDate: closureLockDate } = useMonthlyClosure(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);
  const setOverride = useSetTransactionMonthOverride(user?.id);
  const deleteOverride = useDeleteTransactionMonthOverride(user?.id);

  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [showRecDelete, setShowRecDelete] = useState(false);
  const { scrollRef, handleFocus, onScroll } = useKeyboardAwareScroll();

  function showConfirm(opts: { title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }) {
    setConfirmModal(opts);
  }

  const tx = transactions.find((t) => t.id === id);
  const isPast = tx ? new Date(tx.date) < new Date(new Date().toISOString().slice(0, 10)) : false;
  const isVirement = !!(tx as any)?.linked_account_id;
  // Régularisation de solde : pas de vraie sous-catégorie stockée (le moteur de solde l'identifie
  // par le libellé + category_id null). On la présente comme « Régularisation solde », verrouillée.
  const isRegul = !!tx && isRegulRow(tx as any);
  const instanceYear = instanceDate ? Number(instanceDate.split('-')[0]) : undefined;
  const instanceMonth = instanceDate ? Number(instanceDate.split('-')[1]) : undefined;
  const { data: instanceOverrides = [] } = useTransactionMonthOverrides(user?.id, instanceYear, instanceMonth);
  // Only use an override when we're editing a specific instance (instanceDate is set) and it matches this transaction
  const currentInstanceOverride = instanceDate ? instanceOverrides.find(o => o.transaction_id === id) : undefined;
  const [editMode, setEditMode] = useState<'single' | 'future'>(instanceDate ? 'single' : 'future');

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [dateDisplay, setDateDisplay] = useState('');
  // Date de l'échéance au chargement → sert à détecter un changement EXPLICITE de date (#2) sans
  // confondre avec l'ancre avancée par la matérialisation.
  const initialDateRef = useRef('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [isExpense, setIsExpense] = useState(true);
  const [isRefund, setIsRefund] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly');
  const [recurrenceEndDateInput, setRecurrenceEndDateInput] = useState('');
  const [futureAmount, setFutureAmount] = useState('');
  const [futureAmountDate, setFutureAmountDate] = useState('');
  const [futureAmountDateDisplay, setFutureAmountDateDisplay] = useState('');
  const [showCalendar, setShowCalendar] = useState<false | 'date' | 'end' | 'future'>(false);

  const categoryGroups = useSubCategoriesGrouped(categories, isExpense ? 'expense' : 'income');
  // Création rapide de sous-catégorie (§12)
  const addCategory = useAddCategory(user?.id);
  const subcatParents = useMemo(() => {
    const t = isExpense ? 'expense' : 'income';
    return categories
      .filter((c) => (c.parent_id == null || c.parent_id === '') && String(c.type).toLowerCase() === t)
      .filter((c) => c.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() !== 'mouvements')
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, isExpense]);

  useEffect(() => {
    if (tx) {
      const initialAmount = currentInstanceOverride?.override_amount != null ? currentInstanceOverride.override_amount : Number(tx.amount);
      setAmount(Math.abs(initialAmount).toString());
      // `instanceDate` peut être un mois (YYYY-MM) pour une occurrence récurrente → date complète.
      const occ = instanceDate ? occurrenceFullDate() : tx.date;
      setDate(occ);
      setDateDisplay(formatDateFrench(occ));
      initialDateRef.current = occ;
      setNote(tx.note ?? '');
      setAccountId(tx.account_id);
      setCategoryId(tx.category_id ?? '');
      // Remboursement = montant positif sur une catégorie de dépense.
      const isRefundTx = tx.amount > 0 && (tx as any).category?.type === 'expense';
      setIsExpense(tx.amount < 0 || isRefundTx);
      setIsRefund(isRefundTx);
      setIsRecurring(tx.is_recurring ?? false);
      setRecurrenceRule((tx.recurrence_rule as RecurrenceRule) ?? 'monthly');
      setRecurrenceEndDateInput(tx.recurrence_end_date ? formatDateFrench(tx.recurrence_end_date) : '');
      setFutureAmount('');
      setFutureAmountDate('');
      setFutureAmountDateDisplay('');
    }
  }, [tx, instanceDate, currentInstanceOverride]);

  // Date d'effet par défaut = date complète de l'échéance concernée (jj-mm-aaaa).
  // `instanceDate` peut être un mois (YYYY-MM) → on complète avec le jour de la transaction.
  function occurrenceFullDate(): string {
    if (instanceDate && /^\d{4}-\d{2}-\d{2}$/.test(instanceDate)) return instanceDate;
    if (instanceDate && /^\d{4}-\d{2}$/.test(instanceDate)) {
      const day = (tx?.date || '').slice(8, 10) || '01';
      // Borne le jour à la longueur du mois.
      const [y, m] = instanceDate.split('-').map(Number);
      const maxDay = new Date(y, m, 0).getDate();
      const d = Math.min(Number(day), maxDay);
      return `${instanceDate}-${String(d).padStart(2, '0')}`;
    }
    return tx?.date || '';
  }

  useEffect(() => {
    if (instanceDate && editMode === 'future' && !futureAmountDate) {
      const full = occurrenceFullDate();
      if (full) {
        setFutureAmountDate(full);
        setFutureAmountDateDisplay(formatDateFrench(full));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceDate, editMode, futureAmountDate, tx?.date]);

  function toIsoDate(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const closeEditor = () => {
    // Ouverte depuis un autre onglet (détail compte) → revenir à l'ORIGINE plutôt que de remonter la
    // pile Transactions (qui pouvait retomber sur l'écran de création).
    if (origin) { router.replace(decodeURIComponent(origin) as any); return; }
    if (typeof router.canGoBack === 'function' && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/transactions');
  };

  const isInstanceEdit = Boolean(instanceDate && tx?.is_recurring);
  const isInstanceOccurrenceEdit = isInstanceEdit && editMode === 'single';
  // Occurrence MATÉRIALISÉE : ligne réelle d'une série récurrente (is_recurring=false mais
  // materialized_from rempli → le modèle parent existe encore). La repasser en récurrente créerait
  // un 2ᵉ modèle qui DOUBLERAIT le futur. On verrouille donc la récurrence sur cette ligne et on
  // renvoie l'utilisateur vers une échéance à venir pour modifier la série.
  const isMaterialized = !!(tx as any)?.materialized_from;

  function showError(msg: string, fields: string[] = []) {
    setFormError(msg);
    setErrorFields(fields);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function handleSubmitWithDraft(isDraft = false) {
    if (!id || !tx) return;
    setFormError(null);
    setErrorFields([]);

    const num = parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      showError('Le montant est obligatoire et doit être supérieur à 0.', ['amount']);
      return;
    }

    // Verrou de clôture : pas de modification d'une transaction à une date clôturée (ni vers une telle date).
    if (closureLockDate && ((tx.date && tx.date <= closureLockDate) || (date && date <= closureLockDate))) {
      showError('Cette période est clôturée : la transaction ne peut plus être modifiée.', ['date']);
      return;
    }

    // Sous-catégorie obligatoire pour une dépense / recette validée (pas les virements ni les brouillons).
    if (!isVirement && !isRegul && !isDraft && !categoryId) {
      showError('Veuillez choisir une sous-catégorie.', ['category']);
      return;
    }

    const finalAmount = isExpense ? (isRefund ? Math.abs(num) : -Math.abs(num)) : Math.abs(num);
    const endDateISO = isRecurring && recurrenceEndDateInput.trim()
      ? (parseDateFromFrench(recurrenceEndDateInput.trim()) || recurrenceEndDateInput.trim())
      : null;

    const futureAmountNum = futureAmount.trim() ? parseFloat(futureAmount.replace(',', '.')) : null;
    // La section « Modifier le montant futur » n'est prise en compte QUE si un nouveau montant
    // est saisi. `futureAmountDate` est stocké en ISO → on exige une date complète valide.
    const useFutureSection = futureAmountNum !== null && !Number.isNaN(futureAmountNum) && futureAmountNum !== 0;
    const effectiveDateISO = /^\d{4}-\d{2}-\d{2}$/.test(futureAmountDate.trim()) ? futureAmountDate.trim() : '';

    if (useFutureSection && !effectiveDateISO) {
      showError("Renseignez une date d'effet valide (jj-mm-aaaa) pour appliquer le nouveau montant futur.", ['futureDate']);
      return;
    }

    if (isInstanceOccurrenceEdit) {
      const [year, month] = instanceDate!.split('-').map(Number);
      const originalAmount = Number(tx.amount);
      const currentOverrideAmount = currentInstanceOverride?.override_amount;

      const amountUnchanged =
        (currentOverrideAmount != null && Math.abs(finalAmount - currentOverrideAmount) < 0.01) ||
        (currentOverrideAmount == null && Math.abs(finalAmount - originalAmount) < 0.01);
      const categoryChanged = categoryId !== (tx.category_id ?? '');
      // Le libellé est une propriété de la SÉRIE (pas d'override par occurrence) → un renommage
      // s'applique à toutes les occurrences (on met à jour le modèle récurrent).
      const noteChanged = (note || '') !== ((tx as any).note ?? '');
      // #2 — changement de date de CETTE échéance uniquement (décorrélée) → override_date.
      const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date);
      const dateChanged = dateValid && date !== initialDateRef.current;

      if (amountUnchanged && !categoryChanged && !noteChanged && !dateChanged) {
        closeEditor();
        return;
      }

      try {
        // Override de montant ET/OU de date sur la même ligne (upsert mois/transaction).
        if (!amountUnchanged || dateChanged) {
          const backToTemplateAmount = currentOverrideAmount != null && Math.abs(finalAmount - originalAmount) < 0.01;
          if (!amountUnchanged && backToTemplateAmount && !dateChanged) {
            await deleteOverride.mutateAsync({ transaction_id: id, year, month });
          } else {
            await setOverride.mutateAsync({
              transaction_id: id, year, month,
              ...(amountUnchanged ? {} : { override_amount: finalAmount }),
              ...(dateChanged ? { override_date: date } : {}),
            });
          }
        }
        if (categoryChanged || noteChanged) {
          await updateTx.mutateAsync({
            id,
            ...(categoryChanged ? { category_id: categoryId ? categoryId : null } : {}),
            ...(noteChanged ? { note: note || null } : {}),
          });
        }
        closeEditor();
      } catch (e: unknown) {
        showError(e instanceof Error ? e.message : "Impossible d'enregistrer.");
      }
      return;
    }

    const shouldUpdateFutureAmount = isRecurring && editMode === 'future' && useFutureSection;
    if (shouldUpdateFutureAmount) {
      const newRecurringAmount = isExpense ? -Math.abs(futureAmountNum!) : Math.abs(futureAmountNum!);
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
        showError(e instanceof Error ? e.message : "Impossible d'enregistrer.");
      }
      return;
    }

    try {
      await updateTx.mutateAsync({
        id,
        account_id: accountId,
        category_id: categoryId ? categoryId : null,
        amount: finalAmount,
        // « Modifier la récurrence » : on garde l'ancre d'origine SAUF si l'utilisateur a EXPLICITEMENT
        // changé la date (#2) → on déplace alors le jour/anchor de toute la série (occurrences non échues).
        // Sans changement explicite, on garde tx.date pour ne pas reculer l'ancre avancée par la matérialisation.
        date: (isInstanceEdit && editMode === 'future' && date === initialDateRef.current) ? tx.date : date,
        note: note || undefined,
        is_draft: isDraft,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
        recurrence_end_date: endDateISO,
      });
      closeEditor();
    } catch (e: unknown) {
      showError(e instanceof Error ? e.message : "Impossible d'enregistrer.");
    }
  }

  function handleDelete() {
    if (!id) return;
    if (closureLockDate && tx && tx.date <= closureLockDate) {
      showConfirm({ title: 'Période clôturée', message: 'Cette transaction appartient à un mois clôturé et ne peut plus être supprimée.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
      return;
    }
    // Transaction récurrente → proposer le périmètre de suppression.
    if (tx?.is_recurring) {
      setShowRecDelete(true);
      return;
    }
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

  // Étape 2 : confirmation finale du périmètre choisi.
  function confirmDeleteScope(scope: 'one' | 'future' | 'all') {
    setShowRecDelete(false);
    const label =
      scope === 'one' ? 'cette échéance uniquement'
      : scope === 'future' ? 'cette échéance et les suivantes'
      : 'toute la série (passées et futures)';
    showConfirm({
      title: 'Confirmer la suppression',
      message: `Vous souhaitez supprimer ${label} ?`,
      confirmLabel: 'Supprimer',
      confirmColor: '#f87171',
      onConfirm: () => { deleteRecurringScope(scope); },
    });
  }

  // ── Suppression d'une récurrence : 3 périmètres possibles ──
  async function deleteRecurringScope(scope: 'one' | 'future' | 'all') {
    if (!id || !tx) return;
    setShowRecDelete(false);
    const occDate = instanceDate ?? tx.date;
    try {
      if (scope === 'all') {
        await deleteTx.mutateAsync(id);
      } else if (scope === 'future') {
        // Celle-ci et les suivantes : on tronque la série à la veille de l'échéance.
        if (occDate <= tx.date) {
          await deleteTx.mutateAsync(id); // pas d'échéance antérieure → on supprime tout
        } else {
          const d = new Date(occDate + 'T00:00:00');
          d.setDate(d.getDate() - 1);
          await updateTx.mutateAsync({ id, recurrence_end_date: toIsoDate(d) });
        }
      } else {
        // Cette échéance uniquement : on neutralise l'occurrence du mois (montant 0).
        const [year, month] = occDate.split('-').map(Number);
        await setOverride.mutateAsync({ transaction_id: id, year, month, override_amount: 0 });
      }
      closeEditor();
    } catch (e: unknown) {
      showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de supprimer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
    }
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
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
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

        <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {formError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
              <Text style={styles.errorBannerText}>{formError}</Text>
            </View>
          )}
          {isVirement ? (
            /* ── Virement : affichage read-only type + comptes ── */
            <>
              <View style={styles.virementBadge}>
                <Ionicons name="swap-horizontal" size={16} color="#60a5fa" />
                <Text style={styles.virementBadgeText}>Virement</Text>
              </View>
              <Text style={styles.label}>Compte source → destination</Text>
              {(() => {
                // Un virement a 2 jambes : la SORTANTE (montant < 0) porte account_id = source, l'ENTRANTE
                // (montant ≥ 0) porte account_id = destination. On oriente donc selon le SIGNE pour ne pas
                // inverser source/destination quand on édite la jambe entrante (ex. alimentation d'un joint).
                const amt = Number((tx as any).amount);
                const srcId = amt < 0 ? (tx as any).account_id : (tx as any).linked_account_id;
                const dstId = amt < 0 ? (tx as any).linked_account_id : (tx as any).account_id;
                return (
                  <View style={styles.virementAccounts}>
                    <Text style={styles.virementAccountText}>{accounts.find((a) => a.id === srcId)?.name ?? '—'}</Text>
                    <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} style={{ marginHorizontal: 8 }} />
                    <Text style={styles.virementAccountText}>{accounts.find((a) => a.id === dstId)?.name ?? '—'}</Text>
                  </View>
                );
              })()}
            </>
          ) : (
            /* ── Dépense / Recette ── (type figé à la création : badge en lecture seule, comme le virement) */
            <>
              <View style={[styles.typeBadge, { backgroundColor: (isExpense ? COLORS.danger : COLORS.green) + '1F' }]}>
                <Ionicons name={isExpense ? 'arrow-down' : 'arrow-up'} size={16} color={isExpense ? COLORS.danger : COLORS.green} />
                <Text style={[styles.typeBadgeText, { color: isExpense ? COLORS.danger : COLORS.green }]}>{isExpense ? 'Dépense' : 'Recette'}</Text>
              </View>

              {isExpense && (
                <TouchableOpacity style={styles.refundToggle} onPress={() => setIsRefund((v) => !v)} activeOpacity={0.7}>
                  <Ionicons name={isRefund ? 'checkbox' : 'square-outline'} size={20} color={isRefund ? COLORS.emerald : COLORS.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refundLabel}>Remboursement (entrée d'argent)</Text>
                    <Text style={styles.refundHint}>S'impute en − sur la catégorie de dépense</Text>
                  </View>
                </TouchableOpacity>
              )}

              {/* Compte — dépense/recette : comptes courants uniquement (comme à la création) */}
              <Text style={styles.label}>Compte</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {accounts.filter((a) => a.type === 'checking').map((acc) => {
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
            onFocus={handleFocus}
            placeholder="....."
            placeholderTextColor={COLORS.textSecondary}
            returnKeyType="next"
          />

          {/* Sous-catégorie (dépense / recette uniquement, juste après le libellé) */}
          {isRegul ? (
            /* Régularisation : sous-catégorie fixe « Régularisation solde », verrouillée (non modifiable). */
            <>
              <Text style={styles.label}>Sous-catégorie</Text>
              <View style={[styles.input, styles.lockedField]}>
                <Text style={styles.lockedFieldText}>Régularisation solde</Text>
                <Ionicons name="lock-closed" size={16} color={COLORS.textSecondary} />
              </View>
            </>
          ) : !isVirement && (
            <CategoryPicker
              key={isExpense ? 'expense' : 'income'}
              groups={categoryGroups}
              selectedCategoryId={categoryId}
              onSelect={(cid) => { setCategoryId(cid); setErrorFields((p) => p.filter((f) => f !== 'category')); setFormError(null); }}
              label="Sous-catégorie *"
              parents={subcatParents}
              onCreateSubcategory={async (name, parentId, icon) => {
                const created = await addCategory.mutateAsync({ name, type: isExpense ? 'expense' : 'income', parent_id: parentId, icon });
                return (created as any)?.id ?? '';
              }}
            />
          )}

          {/* Montant */}
          <Text style={styles.label}>{isRecurring ? 'Montant actuel' : 'Montant (' + CURRENCY_SYMBOL + ')'} *</Text>
          <TextInput
            style={[styles.input, errorFields.includes('amount') && styles.inputError]}
            value={amount}
            onChangeText={(v) => { setAmount(v); setErrorFields((p) => p.filter((f) => f !== 'amount')); setFormError(null); }}
            onFocus={handleFocus}
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
              onFocus={handleFocus}
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
            {isMaterialized ? (
              /* Occurrence matérialisée : appartient déjà à une série → toggle verrouillé pour ne
                 pas créer un doublon de récurrence. On édite ici uniquement cette opération. */
              <View style={styles.recurringInfoBanner}>
                <Ionicons name="repeat" size={20} color={COLORS.emerald} />
                <Text style={styles.recurringInfoText}>
                  Cette opération fait partie d'une série récurrente. Pour modifier la récurrence (montant, période, fin), ouvrez une échéance à venir.
                </Text>
              </View>
            ) : (
            <>
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
                        onFocus={handleFocus}
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
                          onFocus={handleFocus}
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
                        onFocus={handleFocus}
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
            </>
            )}
          </View>

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
          <Pressable style={styles.calendarOverlay} onPress={() => setShowCalendar(false)}>
            <Pressable style={styles.calendarContainer} onPress={() => {}}>
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
            </Pressable>
          </Pressable>
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
                  style={[styles.confirmOk, { borderColor: confirmModal?.confirmColor ?? COLORS.green, backgroundColor: (confirmModal?.confirmColor ?? COLORS.green) + '18' }]}
                  onPress={() => { const cb = confirmModal?.onConfirm; setConfirmModal(null); cb?.(); }}
                >
                  <Text style={[styles.confirmOkText, { color: confirmModal?.confirmColor ?? COLORS.green }]}>{confirmModal?.confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Suppression d'une récurrence : choix du périmètre */}
        <Modal visible={showRecDelete} transparent animationType="fade" onRequestClose={() => setShowRecDelete(false)}>
          <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setShowRecDelete(false)}>
            <TouchableOpacity style={styles.confirmBox} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.confirmTitle}>Supprimer la transaction récurrente</Text>
              <Text style={styles.confirmMessage}>Que souhaitez-vous supprimer ?</Text>
              {instanceDate && (
                <TouchableOpacity style={styles.recScopeBtn} onPress={() => confirmDeleteScope('one')}>
                  <Ionicons name="remove-circle-outline" size={18} color={COLORS.text} />
                  <Text style={styles.recScopeText}>Cette échéance uniquement</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.recScopeBtn} onPress={() => confirmDeleteScope('future')}>
                <Ionicons name="arrow-forward-circle-outline" size={18} color={COLORS.text} />
                <Text style={styles.recScopeText}>Cette échéance et les suivantes</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.recScopeBtn, { borderColor: COLORS.danger + '66' }]} onPress={() => confirmDeleteScope('all')}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                <Text style={[styles.recScopeText, { color: COLORS.danger }]}>Toute la série (passées et futures)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.recScopeCancel} onPress={() => setShowRecDelete(false)}>
                <Text style={styles.confirmCancelText}>Annuler</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 16 },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(248,113,113,0.15)', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: c.danger },
  warningText: { flex: 1, fontSize: 13, color: c.danger },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  virementBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1e3a5f', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 20, alignSelf: 'flex-start' as const },
  virementBadgeText: { fontSize: 14, fontWeight: '700', color: '#60a5fa' },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 20, alignSelf: 'flex-start' as const },
  typeBadgeText: { fontSize: 14, fontWeight: '700' },
  virementAccounts: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 20 },
  virementAccountText: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text, textAlign: 'center' as const },
  toggle: { flexDirection: 'row', marginBottom: 20, gap: 12 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  toggleLabelActive: { color: c.bg },
  refundToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, marginBottom: 16 },
  refundLabel: { fontSize: 14, fontWeight: '600', color: c.text },
  refundHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 20 },
  inputError: { borderColor: c.danger },
  lockedField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: 0.7 },
  lockedFieldText: { fontSize: 16, color: c.textSecondary, fontWeight: '600' },
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
  hint: { color: c.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  chipScroll: { marginBottom: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  recurringSection: { marginTop: 8, marginBottom: 16 },
  recurringInfoBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '14' },
  recurringInfoText: { flex: 1, fontSize: 13, lineHeight: 18, color: c.textSecondary },
  recurringToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 12 },
  recurringToggleActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  recurringLabel: { fontSize: 15, color: c.textSecondary },
  recurringLabelActive: { color: c.bg, fontWeight: '600' },
  instanceModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  instanceModeBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, alignItems: 'center' },
  instanceModeBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  instanceModeLabel: { fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  instanceModeLabelActive: { color: c.bg, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 10 },
  futureBlock: { backgroundColor: c.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 16 },
  submitRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  submitBtn: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitBtnPrimary: { backgroundColor: c.emerald },
  submitBtnDraft: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#475569' },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  submitLabelDraft: { fontSize: 16, fontWeight: '600', color: '#94a3b8' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingVertical: 14 },
  deleteLabel: { fontSize: 15, color: c.danger, fontWeight: '600' },
  text: { color: c.text },
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
    backgroundColor: c.cardSolid,
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
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: c.cardSolid, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: c.cardBorder },
  confirmTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 10 },
  confirmMessage: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  confirmCancelText: { color: c.textSecondary, fontWeight: '600', fontSize: 15 },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmOkText: { fontWeight: '700', fontSize: 15 },
  recScopeBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, marginBottom: 10 },
  recScopeText: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
  recScopeCancel: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
});
}
