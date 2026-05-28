import { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTransactions, useUpdateTransaction, useDeleteTransaction, useValidateProjectDraft } from '../../hooks/useTransactions';
import { useTransactionMonthOverrides } from '../../hooks/useTransactionMonthOverrides';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { accountColor, SEMANTIC } from '../../theme/colors';
import type { TransactionWithDetails, RecurrenceRule } from '../../types/database';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatMonthHeader(year: number, month: number) {
  return new Date(year, month - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthsFromOffset(offset: number, count: number): { year: number; month: number; key: string }[] {
  const now = new Date();
  const out: { year: number; month: number; key: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: getMonthKey(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}

function addRecurrenceToMonth(year: number, month: number, amount: number, startDate: string, rule: RecurrenceRule, endDate: string | null, currentDate: Date): number {
  const start = new Date(startDate);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  if (start > thisMonthEnd || end < thisMonthStart) return 0;
  if (rule === 'monthly') return amount;
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth) return amount;
    return 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() === month - 1 && year >= start.getFullYear()) return amount;
    return 0;
  }
  if (rule === 'weekly') {
    let count = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) count++;
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return count * amount;
  }
  return 0;
}

function getEffectiveDate(item: { date: string; displayDate?: string }): string {
  if (!item.displayDate) return item.date;
  const [y, m] = item.displayDate.split('-').map(Number);
  const origDay = new Date(item.date).getDate();
  const maxDay = new Date(y, m, 0).getDate();
  const day = Math.min(origDay, maxDay);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function TransactionsListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string; focusMonth?: string; categoryId?: string; singleMonth?: string; filterType?: string }>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [accountFilterId, setAccountFilterId] = useState<string | null>(null);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [filterInitialized, setFilterInitialized] = useState(false);
  const [showAccountFilter, setShowAccountFilter] = useState(false);
  
  const transactionsQuery = useTransactions(user?.id);
  const overridesQuery = useTransactionMonthOverrides(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);
  const validateProjectDraft = useValidateProjectDraft(user?.id);
  const { data: transactions = [], isLoading } = transactionsQuery;
  const { data: overrides = [] } = overridesQuery;
  const { data: accounts = [] } = useAccounts(user?.id);

  // Par défaut, filtrer sur les comptes courants (premier compte checking trouvé)
  useEffect(() => {
    if (!filterInitialized && accounts.length > 0) {
      const firstChecking = accounts.find((a: any) => a.type === 'checking');
      if (firstChecking) {
        setAccountFilterId(firstChecking.id);
        setDefaultAccountId(firstChecking.id);
      }
      setFilterInitialized(true);
    }
  }, [accounts, filterInitialized]);
  
  const [periodOffset, setPeriodOffset] = useState(-1);
  const [categoryFilterId, setCategoryFilterId] = useState<string | null>(params.categoryId ?? null);
  const [regulFilter, setRegulFilter] = useState(params.filterType === 'regul');
  const [mouvementsFilter, setMouvementsFilter] = useState(params.filterType === 'mouvements');
  const [recettesFilter, setRecettesFilter] = useState(params.filterType === 'recettes');
  const [depensesFilter, setDepensesFilter] = useState(params.filterType === 'depenses');

  useEffect(() => {
    setCategoryFilterId(params.categoryId ?? null);
  }, [params.categoryId]);

  useEffect(() => {
    setRegulFilter(params.filterType === 'regul');
    setMouvementsFilter(params.filterType === 'mouvements');
    setRecettesFilter(params.filterType === 'recettes');
    setDepensesFilter(params.filterType === 'depenses');
  }, [params.filterType]);

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // Déterminer nombre de mois à afficher
  const displayMonthCount = params.singleMonth === '1' ? 1 : 3;
  
  // Initialiser periodOffset basé sur focusMonth s'il est fourni
  useEffect(() => {
    if (params.focusMonth) {
      const [focusYear, focusMonth] = params.focusMonth.split('-').map(Number);
      const focusDate = new Date(focusYear, focusMonth - 1, 1);
      const nowDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const diff = focusDate.getMonth() - nowDate.getMonth() + (focusDate.getFullYear() - nowDate.getFullYear()) * 12;
      setPeriodOffset(diff);
    }
  }, [params.focusMonth]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await transactionsQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  // Obtenir les mois consécutifs basé sur periodOffset (1 ou 3 selon singleMonth)
  const displayMonths = useMemo(() => getMonthsFromOffset(periodOffset, displayMonthCount), [periodOffset, displayMonthCount]);

  const overrideMap = useMemo(() => {
    const map: Record<string, number> = {};
    overrides.forEach((o) => {
      map[`${o.transaction_id}:${o.year}:${o.month}`] = o.override_amount;
    });
    return map;
  }, [overrides]);

  // Créer une liste de transactions affichées, incluant les transactions récurrentes instanciées
  const displayedTransactions = useMemo(() => {
    const result: (TransactionWithDetails & { displayDate?: string })[] = [];
    const displayMonthKeys = displayMonths.map(m => m.key);
    
    for (const t of transactions as TransactionWithDetails[]) {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      const transactionKey = getMonthKey(tYear, tMonth);
      
      if (t.project_id) {
        // Transactions de projet : toujours traiter comme ponctuelles (une par mois)
        if (displayMonthKeys.includes(transactionKey)) {
          result.push(t);
        }
      } else if (t.is_recurring && t.recurrence_rule) {
        // Pour chaque mois affiché, calculer si cette récurrence s'applique
        for (const m of displayMonths) {
          const appliedAmount = addRecurrenceToMonth(m.year, m.month, Number(t.amount), t.date, t.recurrence_rule, t.recurrence_end_date ?? null, now);
          const overrideKey = `${t.id}:${m.year}:${m.month}`;
          const finalAmount = overrideMap[overrideKey] !== undefined ? overrideMap[overrideKey] : appliedAmount;
          if (Math.abs(finalAmount) > 0) {
            // Créer une instance de la transaction pour ce mois
            result.push({
              ...t,
              displayDate: getMonthKey(m.year, m.month),
              amount: finalAmount,
            });
          }
        }
      } else {
        // Transaction ponctuelle : ajoute seulement si elle tombe dans les 3 mois affichés
        if (displayMonthKeys.includes(transactionKey)) {
          result.push(t);
        }
      }
    }
    
    return result;
  }, [transactions, displayMonths, now]);

  // Récupérer les categories pour filtrer par parent/enfant
  const { data: categories = [] } = useCategories(user?.id);
  
  // Filtrer par catégorie si nécessaire (inclure enfants si parent est sélectionné)
  const filtered = useMemo(() => {
    let list = displayedTransactions;
    if (categoryFilterId) {
      const selectedCategory = categories.find(c => c.id === categoryFilterId);
      if (selectedCategory) {
        if (!selectedCategory.parent_id) {
          const childIds = categories.filter(c => c.parent_id === selectedCategory.id).map(c => c.id);
          const allIdsToFilter = [selectedCategory.id, ...childIds];
          const isFraisVariables = selectedCategory.name === 'Frais variables';
          list = list.filter((t) =>
            !(t as any).project_id &&
            (
              (t.category_id && allIdsToFilter.includes(t.category_id)) ||
              (isFraisVariables && (t.note?.startsWith('Régularisation') || t.note === 'Ajustement de solde'))
            )
          );
        } else {
          list = list.filter((t) => !(t as any).project_id && t.category_id === categoryFilterId);
        }
      }
    }
    // Filtre Régularisation solde
    if (regulFilter) {
      list = list.filter((t) => t.note?.startsWith('Régularisation') || t.note === 'Ajustement de solde');
    }
    // Filtre Mouvements (virements épargne/invest + transactions projet)
    if (mouvementsFilter) {
      list = list.filter((t) => {
        const isChecking = t.account?.type === 'checking';
        const linkedType = t.linked_account?.type;
        const isProjectTx = !!(t as any).project_id;
        return isChecking && (linkedType === 'savings' || linkedType === 'investment' || isProjectTx);
      });
    }
    // Filtre Recettes
    if (recettesFilter) {
      list = list.filter((t) => t.category?.type === 'income');
    }
    // Filtre Dépenses (hors projets qui sont dans Mouvements)
    if (depensesFilter) {
      list = list.filter((t) => t.category?.type === 'expense' && !(t as any).project_id);
    }
    // Filtre par compte
    if (accountFilterId) {
      list = list.filter((t) => t.account_id === accountFilterId);
    }
    return list;
  }, [displayedTransactions, categoryFilterId, categories, accountFilterId, regulFilter, mouvementsFilter, recettesFilter, depensesFilter]);

  const byMonth = useMemo(() => {
    const map: Record<string, TransactionWithDetails[]> = {};
    for (const t of filtered) {
      // Utiliser displayDate si fourni (pour les transactions récurrentes instanciées), sinon utiliser la date réelle
      const dateToUse = t.displayDate || t.date;
      const [y, m] = dateToUse.split('-').map(Number);
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    }
    for (const arr of Object.values(map)) arr.sort((a, b) => {
      const dateA = getEffectiveDate(a);
      const dateB = getEffectiveDate(b);
      return dateB.localeCompare(dateA);
    });
    const keys = Object.keys(map).sort((a, b) => {
      // Trier les mois en ordre inverse (plus récent d'abord)
      const aDate = new Date(a.split('-')[0], parseInt(a.split('-')[1]) - 1);
      const bDate = new Date(b.split('-')[0], parseInt(b.split('-')[1]) - 1);
      return bDate.getTime() - aDate.getTime();
    });
    return keys.map((key) => {
      const [y, m] = key.split('-').map(Number);
      return { key, year: y, month: m, items: map[key] };
    });
  }, [filtered]);

  const isManualFilter = !!accountFilterId && accountFilterId !== defaultAccountId;
  const hasFilter = !!categoryFilterId || isManualFilter || regulFilter || mouvementsFilter || recettesFilter || depensesFilter;
  const selectedAccountName = accounts.find(a => a.id === accountFilterId)?.name;
  const selectedCategoryName = categoryFilterId ? categories.find(c => c.id === categoryFilterId)?.name : null;
  
  // Afficher/cacher boutons nav si singleMonth
  const showPeriodNav = params.singleMonth !== '1';
  
  // Formater la plage de mois affichés
  const firstMonth = displayMonths[0];
  const lastMonth = displayMonths[displayMonths.length - 1];
  const monthRangeText = useMemo(() => {
    if (displayMonths.length === 0) return '';
    return `${formatMonthHeader(firstMonth.year, firstMonth.month)} - ${formatMonthHeader(lastMonth.year, lastMonth.month)}`;
  }, [firstMonth, lastMonth, displayMonths]);

  const currentMonthKey = getMonthKey(currentYear, currentMonth);

  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: string;
    onConfirm: () => void;
  } | null>(null);

  function showConfirm(opts: { title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }) {
    setConfirmModal(opts);
  }

  function confirmValidateDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce brouillon';
    const isProjectDebit = !!(item as any).project_id && Number(item.amount) < 0;
    showConfirm({
      title: 'Valider la transaction',
      message: isProjectDebit
        ? `Valider le virement "${label}" vers le compte de destination ?`
        : `Valider "${label}" ?`,
      confirmLabel: 'Valider',
      confirmColor: '#34d399',
      onConfirm: async () => {
        try {
          if (isProjectDebit) {
            await validateProjectDraft.mutateAsync({
              id: item.id,
              project_id: (item as any).project_id,
              amount: Number(item.amount),
              date: item.date,
              account_id: item.account_id,
            });
          } else {
            await updateTx.mutateAsync({ id: item.id, is_draft: false });
          }
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de valider.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  function confirmDeleteDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce brouillon';
    showConfirm({
      title: 'Supprimer le brouillon',
      message: `Supprimer "${label}" ?`,
      confirmLabel: 'Supprimer',
      confirmColor: '#f87171',
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de supprimer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {showPeriodNav && (
          <View style={styles.periodNav}>
            <TouchableOpacity 
              style={styles.periodBtn} 
              onPress={() => setPeriodOffset(periodOffset - 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodLabel} onPress={() => setPeriodOffset(-1)} activeOpacity={0.7}>
              <Text style={styles.periodText}>{monthRangeText}</Text>
              {periodOffset !== -1 && <Text style={styles.periodLabelHint}>Appuyer pour revenir</Text>}
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.periodBtn} 
              onPress={() => setPeriodOffset(periodOffset + 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterBtn, accountFilterId && styles.filterBtnActive]}
              onPress={() => setShowAccountFilter(!showAccountFilter)}
              activeOpacity={0.7}
            >
              <Ionicons name="filter" size={18} color={accountFilterId ? COLORS.bg : COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        {showAccountFilter && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountFilterScroll}>
            <TouchableOpacity
              style={[styles.accountFilterChip, !accountFilterId && styles.accountFilterChipActive]}
              onPress={() => { setAccountFilterId(null); setShowAccountFilter(false); }}
            >
              <Text style={[styles.accountFilterChipText, !accountFilterId && styles.accountFilterChipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {accounts.map((acc) => (
              <TouchableOpacity
                key={acc.id}
                style={[styles.accountFilterChip, accountFilterId === acc.id && styles.accountFilterChipActive]}
                onPress={() => { setAccountFilterId(acc.id); setShowAccountFilter(false); }}
              >
                <Text style={[styles.accountFilterChipText, accountFilterId === acc.id && styles.accountFilterChipTextActive]}>{acc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=transfer')}
            accessibilityRole="button"
          >
            <Ionicons name="swap-horizontal" size={20} color={COLORS.text} />
            <Text style={styles.addBtnLabel}>Virement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=expense')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-down" size={20} color={COLORS.text} />
            <Text style={styles.addBtnLabel}>Dépenses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=income')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-up" size={20} color={COLORS.text} />
            <Text style={styles.addBtnLabel}>Recette</Text>
          </TouchableOpacity>
        </View>
        {hasFilter && (
          <View style={styles.activeFilters}>
            {selectedCategoryName && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setCategoryFilterId(null)} activeOpacity={0.7}>
                <Ionicons name="pricetag-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>{selectedCategoryName}</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {regulFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setRegulFilter(false)} activeOpacity={0.7}>
                <Ionicons name="swap-vertical-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Régularisation solde</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {mouvementsFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setMouvementsFilter(false)} activeOpacity={0.7}>
                <Ionicons name="swap-horizontal-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Mouvements</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {recettesFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setRecettesFilter(false)} activeOpacity={0.7}>
                <Ionicons name="arrow-up-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Recettes</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {depensesFilter && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setDepensesFilter(false)} activeOpacity={0.7}>
                <Ionicons name="arrow-down-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>Dépenses</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {isManualFilter && selectedAccountName && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setAccountFilterId(defaultAccountId)} activeOpacity={0.7}>
                <Ionicons name="wallet-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>{selectedAccountName}</Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.emerald}
              progressBackgroundColor={COLORS.card}
            />
          }
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
          ) : (
            <>
              {byMonth.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.empty}>Aucune transaction{hasFilter ? ' pour ce filtre' : ''}.</Text>
                </View>
              ) : (
                byMonth.map(({ key, year, month, items }) => (
                  <View key={key} style={styles.monthBlock}>
                    <View style={styles.monthHeader}>
                      <Text style={styles.monthHeaderText}>{formatMonthHeader(year, month)}</Text>
                    </View>
                    <View style={styles.card}>
                      {items.map((item, index) => {
                        const effectiveDate = getEffectiveDate(item);
                        const isFuture = effectiveDate > todayStr;
                        const isProject = !!item.project_id;
                        const isRecurring = item.is_recurring && !isProject;
                        const isReservation = isProject && Number(item.amount) === 0;
                        const amt = Number(item.amount);
                        const acctType = item.account?.type ?? 'checking';
                        const acctCol = accountColor(acctType);

                        const isDraft = !!(item as any).is_draft;
                        const isProjectDraft = isDraft && isProject;
                        const isDraftQuickAction = isDraft && key <= currentMonthKey;
                        const navigateToEdit = () => {
                          const route = item.displayDate
                            ? `/(tabs)/transactions/edit/${item.id}?instanceDate=${item.displayDate}`
                            : `/(tabs)/transactions/edit/${item.id}`;
                          router.push(route as any);
                        };
                        const accentStyle = isProject
                          ? { backgroundColor: SEMANTIC.project + '50' }
                          : amt > 0
                            ? { backgroundColor: acctCol + '50' }
                            : { backgroundColor: acctCol + '25' };
                        const rowBaseStyle = [
                          styles.row,
                          isDraftQuickAction && styles.rowAlignStart,
                          index === items.length - 1 && styles.rowLast,
                          isFuture && styles.rowFuture,
                          isDraft && (isProjectDraft ? styles.rowDraftProject : styles.rowDraft),
                        ];

                        if (isDraftQuickAction) {
                          return (
                            <View key={`${item.id}-${item.displayDate || ''}`} style={rowBaseStyle}>
                              <View style={[styles.rowAccent, accentStyle]} />
                              <TouchableOpacity style={styles.rowLeft} onPress={navigateToEdit} activeOpacity={0.7}>
                                <View style={styles.rowLabelRow}>
                                  {isProject && <View style={[styles.projectDot, { backgroundColor: SEMANTIC.project }]} />}
                                  <Text style={[styles.rowLabel, isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft]} numberOfLines={1}>
                                    {item.note || item.category?.name || 'Sans libellé'}
                                  </Text>
                                  <View style={[styles.draftBadge, isProjectDraft && styles.draftBadgeProject]}>
                                    <Text style={[styles.draftBadgeText, isProjectDraft && styles.draftBadgeTextProject]}>Brouillon</Text>
                                  </View>
                                  {isRecurring && (
                                    <Ionicons name="repeat" size={11} color={COLORS.textSecondary} style={{ marginLeft: 6, opacity: 0.6 }} />
                                  )}
                                </View>
                                <Text style={styles.rowMeta}>
                                  {item.account?.name ?? ''} · {formatDate(effectiveDate)}
                                </Text>
                              </TouchableOpacity>
                              <View style={styles.rowRightDraft}>
                                <View style={styles.draftActionRow}>
                                  <TouchableOpacity
                                    style={styles.draftActionValidate}
                                    onPress={() => confirmValidateDraft(item)}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons name="checkmark" size={13} color="#34d399" />
                                    <Text style={styles.draftActionValidateText}>Valider</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity
                                    style={styles.draftActionDelete}
                                    onPress={() => confirmDeleteDraft(item)}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons name="trash-outline" size={13} color="#f87171" />
                                  </TouchableOpacity>
                                </View>
                                <Text style={[styles.rowAmount, amt > 0 ? { color: SEMANTIC.income } : styles.rowAmountNeg, { textAlign: 'right', marginTop: 4 }]}>
                                  {amt > 0 ? '+' : ''}{amt.toFixed(2)} €
                                </Text>
                              </View>
                            </View>
                          );
                        }

                        return (
                          <TouchableOpacity
                            key={`${item.id}-${item.displayDate || ''}`}
                            style={rowBaseStyle}
                            onPress={navigateToEdit}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                          >
                            <View style={[styles.rowAccent, accentStyle]} />
                            <View style={styles.rowLeft}>
                              <View style={styles.rowLabelRow}>
                                {isProject && <View style={[styles.projectDot, { backgroundColor: SEMANTIC.project }]} />}
                                <Text style={[styles.rowLabel, isDraft && (isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft)]} numberOfLines={1}>
                                  {item.note || item.category?.name || 'Sans libellé'}
                                </Text>
                                {isDraft && (
                                  <View style={[styles.draftBadge, isProjectDraft && styles.draftBadgeProject]}>
                                    <Text style={[styles.draftBadgeText, isProjectDraft && styles.draftBadgeTextProject]}>Brouillon</Text>
                                  </View>
                                )}
                                {isRecurring && (
                                  <Ionicons name="repeat" size={11} color={COLORS.textSecondary} style={{ marginLeft: 6, opacity: 0.6 }} />
                                )}
                              </View>
                              <Text style={styles.rowMeta}>
                                {item.account?.name ?? ''} · {formatDate(effectiveDate)}
                              </Text>
                            </View>
                            {isReservation ? (
                              <View style={styles.reservationBadge}>
                                <Text style={styles.reservationText}>Réservé</Text>
                              </View>
                            ) : (
                              <Text style={[styles.rowAmount, amt > 0 ? { color: SEMANTIC.income } : styles.rowAmountNeg]}>
                                {amt > 0 ? '+' : ''}{amt.toFixed(2)} €
                              </Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))
              )}
              <Text style={styles.hint}>Appuyez sur une ligne pour modifier ou supprimer.</Text>
            </>
          )}
        </ScrollView>
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
                  onPress={() => {
                    const cb = confirmModal?.onConfirm;
                    setConfirmModal(null);
                    cb?.();
                  }}
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
  header: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  clearFilter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingVertical: 8 },
  clearFilterText: { fontSize: 14, color: COLORS.emerald, fontWeight: '600' },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  filterChipText: { fontSize: 13, color: COLORS.emerald, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },
  monthBlock: { marginBottom: 24 },
  monthHeader: { paddingVertical: 10, paddingHorizontal: 4, marginBottom: 8 },
  monthHeaderText: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'capitalize' },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  rowLast: { borderBottomWidth: 0 },
  rowFuture: { opacity: 0.4 },
  rowAlignStart: { alignItems: 'flex-start' },
  rowDraft: { borderLeftWidth: 3, borderLeftColor: '#f59e0b', borderStyle: 'dashed' as any },
  rowDraftProject: { borderLeftWidth: 3, borderLeftColor: '#60a5fa', borderStyle: 'dashed' as any },
  rowLabelDraft: { fontStyle: 'italic', color: '#f59e0b' },
  rowLabelDraftProject: { fontStyle: 'italic', color: '#60a5fa' },
  draftBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#f59e0b22', borderWidth: 1, borderColor: '#f59e0b' },
  draftBadgeProject: { backgroundColor: '#60a5fa22', borderColor: '#60a5fa' },
  draftBadgeText: { fontSize: 10, fontWeight: '700', color: '#f59e0b' },
  draftBadgeTextProject: { color: '#60a5fa' },
  rowRightDraft: { alignItems: 'flex-end' },
  draftActionRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  draftActionValidate: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#34d39918', borderWidth: 1, borderColor: '#34d39944' },
  draftActionValidateText: { fontSize: 11, fontWeight: '700', color: '#34d399' },
  draftActionDelete: { padding: 4, borderRadius: 8, backgroundColor: '#f8717118', borderWidth: 1, borderColor: '#f8717144' },
  rowAccent: {
    position: 'absolute' as const,
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 1.5,
  },
  rowAccentIncome: { backgroundColor: '#34d39950' },
  rowAccentProject: { backgroundColor: '#22d3ee50' },
  rowLeft: { flex: 1, marginRight: 8 },
  rowLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  projectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a78bfa',
    marginRight: 6,
  },
  rowLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text, flexShrink: 1 },
  rowMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: COLORS.emerald },
  rowAmountNeg: { color: COLORS.textSecondary },
  reservationBadge: {
    backgroundColor: '#22d3ee18',
    borderWidth: 1,
    borderColor: '#22d3ee40',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reservationText: {
    color: '#22d3ee',
    fontSize: 12,
    fontWeight: '600',
  },
  empty: { padding: 24, color: COLORS.textSecondary, textAlign: 'center' },
  hint: { marginTop: 16, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
  periodNav: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    marginBottom: 16,
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  periodBtn: { 
    padding: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginLeft: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtnActive: {
    backgroundColor: COLORS.emerald,
    borderColor: COLORS.emerald,
  },
  accountFilterScroll: {
    marginBottom: 12,
    maxHeight: 44,
  },
  accountFilterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginRight: 8,
    backgroundColor: COLORS.card,
  },
  accountFilterChipActive: {
    backgroundColor: COLORS.emerald,
    borderColor: COLORS.emerald,
  },
  accountFilterChipText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
  },
  accountFilterChipTextActive: {
    color: COLORS.bg,
    fontWeight: '600',
  },
  periodLabel: {
    flex: 1,
    alignItems: 'center',
  },
  periodText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  periodLabelHint: {
    fontSize: 11,
    color: COLORS.emerald,
    marginTop: 2,
  },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder, width: '100%', maxWidth: 340, padding: 20 },
  confirmTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  confirmMessage: { fontSize: 14, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmOkText: { fontSize: 14, fontWeight: '700' },
});
