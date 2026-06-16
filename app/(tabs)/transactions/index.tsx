import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, PanResponder } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import PageIntroModal from '../../components/PageIntroModal';
import OnboardingHintBanner from '../../components/OnboardingHintBanner';
import AdSlot from '../../components/AdSlot';
import { tabRect } from '../../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../../lib/onbHighlight';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTransactions, useUpdateTransaction, useDeleteTransaction, useValidateProjectDraft } from '../../hooks/useTransactions';
import { useTransactionMonthOverrides } from '../../hooks/useTransactionMonthOverrides';
import { useCategories } from '../../hooks/useCategories';
import { useAccounts } from '../../hooks/useAccounts';
import { accountColor } from '../../theme/colors';
import type { TransactionWithDetails, RecurrenceRule } from '../../types/database';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';
import { iconForTransaction } from '../../lib/categoryIcons';


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
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const onbRecurring = useOnbHighlight('recurring_tx');
  const router = useRouter();
  const params = useLocalSearchParams<{ month?: string; focusMonth?: string; categoryId?: string; singleMonth?: string; filterType?: string }>();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // ── Guide "bulles" ──
  const guide = useScreenGuide('transactions', user?.id);
  const expenseBtnRef = useRef<any>(null);
  const incomeBtnRef = useRef<any>(null);
  const transferBtnRef = useRef<any>(null);
  const periodNavRef = useRef<any>(null);
  const actionsRef = useRef<any>(null);

  const TX_GUIDE_STEPS: BubbleStep[] = [
    {
      getRect: () => tabRect(1),
      icon: 'list',
      iconColor: '#34d399',
      title: 'Onglet Transactions',
      description: 'Touchez « Transactions » dans la barre du bas pour saisir et consulter vos opérations.',
    },
    {
      getRef: () => actionsRef,
      icon: 'swap-vertical',
      iconColor: '#34d399',
      title: 'Saisir une opération',
      description: 'Virement entre comptes, Dépense (sortie) ou Recette (revenu) — ponctuelle ou récurrente. Pensez à la catégoriser.',
    },
  ];
  // Multi-compte : ensemble des IDs sélectionnés ([] = tous)
  const [accountFilterIds, setAccountFilterIds] = useState<string[]>([]);
  const [defaultCheckingIds, setDefaultCheckingIds] = useState<string[]>([]);
  const initializedAccountsSig = useRef<string | null>(null);
  const [showAccountFilter, setShowAccountFilter] = useState(false);

  const transactionsQuery = useTransactions(user?.id);
  const overridesQuery = useTransactionMonthOverrides(user?.id);
  const updateTx = useUpdateTransaction(user?.id);
  const deleteTx = useDeleteTransaction(user?.id);
  const validateProjectDraft = useValidateProjectDraft(user?.id);
  const { data: transactions = [], isLoading } = transactionsQuery;
  const { data: overrides = [] } = overridesQuery;
  const { data: accounts = [] } = useAccounts(user?.id);

  // Par défaut, sélectionner tous les comptes courants. On RÉINITIALISE quand l'ensemble des
  // comptes change (ex. mode admin « connecté en tant que » → comptes d'un autre utilisateur),
  // sinon le filtre garderait les comptes du 1er chargement et masquerait toutes les transactions.
  const accountsSig = useMemo(() => accounts.map((a: any) => a.id).sort().join(','), [accounts]);
  useEffect(() => {
    if (accounts.length === 0) return;
    if (initializedAccountsSig.current === accountsSig) return;
    initializedAccountsSig.current = accountsSig;
    const checkingIds = accounts.filter((a: any) => a.type === 'checking').map((a: any) => a.id);
    setDefaultCheckingIds(checkingIds);
    setAccountFilterIds(checkingIds);
  }, [accountsSig, accounts]);
  
  // -2 → fenêtre [m-2, m-1, m] ; l'affichage trié décroissant montre M, m-1, m-2 de haut en bas
  const [periodOffset, setPeriodOffset] = useState(-2);

  // Swipe horizontal sur la liste → navigation de période (±1 mois). Ne capture que les
  // gestes nettement horizontaux pour laisser le défilement vertical intact.
  const periodPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -50) setPeriodOffset((o) => o + 1);
        else if (g.dx >= 50) setPeriodOffset((o) => o - 1);
      },
    })
  ).current;
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
    // Filtre par comptes sélectionnés
    if (accountFilterIds.length > 0) {
      list = list.filter((t) => accountFilterIds.includes(t.account_id));
    }
    return list;
  }, [displayedTransactions, categoryFilterId, categories, accountFilterIds, regulFilter, mouvementsFilter, recettesFilter, depensesFilter]);

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
      const aDate = new Date(Number(a.split('-')[0]), parseInt(a.split('-')[1]) - 1);
      const bDate = new Date(Number(b.split('-')[0]), parseInt(b.split('-')[1]) - 1);
      return bDate.getTime() - aDate.getTime();
    });
    return keys.map((key) => {
      const [y, m] = key.split('-').map(Number);
      return { key, year: y, month: m, items: map[key] };
    });
  }, [filtered]);

  // Le filtre est "manuel" si la sélection diffère des comptes courants par défaut
  const isManualFilter =
    accountFilterIds.length !== defaultCheckingIds.length ||
    accountFilterIds.some((id) => !defaultCheckingIds.includes(id));
  const hasFilter = !!categoryFilterId || isManualFilter || regulFilter || mouvementsFilter || recettesFilter || depensesFilter;
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

  // Conserver un brouillon de projet : le marque « Réservé » (pas de dépense validée),
  // son montant alimente la ligne Réservé du Pilotage jusqu'à utilisation/libération.
  function confirmConserveDraft(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce montant';
    const montant = Math.abs(Number(item.amount));
    showConfirm({
      title: 'Conserver pour plus tard',
      message: `Mettre ${montant.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € de "${label}" en Réservé ? Le montant n'est pas dépensé mais mis de côté et visible dans la ligne Réservé du Pilotage.`,
      confirmLabel: 'Conserver',
      confirmColor: '#60a5fa',
      onConfirm: async () => {
        try {
          await updateTx.mutateAsync({ id: item.id, is_reserved: true });
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de conserver.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  // Libérer une réservation depuis la liste : supprime le brouillon réservé.
  function confirmLiberateReserved(item: TransactionWithDetails) {
    const label = item.note || item.category?.name || 'ce montant';
    showConfirm({
      title: 'Libérer la réservation',
      message: `Libérer "${label}" ? Le brouillon réservé sera supprimé et le montant retiré du Réservé.`,
      confirmLabel: 'Libérer',
      confirmColor: '#f87171',
      onConfirm: async () => {
        try {
          await deleteTx.mutateAsync(item.id);
        } catch (e: unknown) {
          showConfirm({ title: 'Erreur', message: e instanceof Error ? e.message : 'Impossible de libérer.', confirmLabel: 'OK', confirmColor: '#94a3b8', onConfirm: () => {} });
        }
      },
    });
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <PageIntroModal pageKey="transactions" />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        {showPeriodNav && (
          <View style={styles.periodNav} ref={periodNavRef}>
            <TouchableOpacity
              style={styles.periodBtn}
              onPress={() => setPeriodOffset(periodOffset - 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.periodLabel} onPress={() => setPeriodOffset(-2)} activeOpacity={0.7}>
              <Text style={styles.periodText}>{monthRangeText}</Text>
              {periodOffset !== -2 && <Text style={styles.periodLabelHint}>Appuyer pour revenir</Text>}
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.periodBtn} 
              onPress={() => setPeriodOffset(periodOffset + 1)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-forward" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterBtn, accountFilterIds.length > 0 && styles.filterBtnActive]}
              onPress={() => setShowAccountFilter(!showAccountFilter)}
              activeOpacity={0.7}
            >
              <Ionicons name="filter" size={18} color={accountFilterIds.length > 0 ? COLORS.bg : COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        {showAccountFilter && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountFilterScroll}>
            <TouchableOpacity
              style={[styles.accountFilterChip, accountFilterIds.length === 0 && styles.accountFilterChipActive]}
              onPress={() => setAccountFilterIds([])}
            >
              <Text style={[styles.accountFilterChipText, accountFilterIds.length === 0 && styles.accountFilterChipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {accounts.map((acc) => {
              const selected = accountFilterIds.includes(acc.id);
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.accountFilterChip, selected && styles.accountFilterChipActive]}
                  onPress={() => {
                    setAccountFilterIds((prev) =>
                      prev.includes(acc.id) ? prev.filter((id) => id !== acc.id) : [...prev, acc.id]
                    );
                  }}
                >
                  <Text style={[styles.accountFilterChipText, selected && styles.accountFilterChipTextActive]}>{acc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        <View style={[styles.header, onbRecurring ? onbGlow(COLORS, true) : null]} ref={actionsRef}>
          <TouchableOpacity
            ref={transferBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=transfer')}
            accessibilityRole="button"
          >
            <Ionicons name="swap-horizontal" size={20} color={COLORS.blue} />
            <Text style={[styles.addBtnLabel, { color: COLORS.blue }]}>Virement</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={expenseBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=expense')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-down" size={20} color={COLORS.danger} />
            <Text style={[styles.addBtnLabel, { color: COLORS.danger }]}>Dépenses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            ref={incomeBtnRef}
            style={styles.addBtn}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/transactions/add?type=income')}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-up" size={20} color={COLORS.green} />
            <Text style={[styles.addBtnLabel, { color: COLORS.green }]}>Recette</Text>
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
            {isManualFilter && accountFilterIds.length > 0 && (
              <TouchableOpacity style={styles.filterChip} onPress={() => setAccountFilterIds(defaultCheckingIds)} activeOpacity={0.7}>
                <Ionicons name="wallet-outline" size={13} color={COLORS.emerald} />
                <Text style={styles.filterChipText}>
                  {accountFilterIds.length === 1
                    ? (accounts.find(a => a.id === accountFilterIds[0])?.name ?? 'Compte')
                    : `${accountFilterIds.length} comptes`}
                </Text>
                <Ionicons name="close" size={13} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={{ flex: 1 }} {...periodPan.panHandlers}>
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
                        const isReserved = !!(item as any).is_reserved;
                        // Boutons valider/supprimer visibles sur tous les brouillons (passés, courants ET futurs)
                        const isDraftQuickAction = isDraft;
                        const navigateToEdit = () => {
                          const route = item.displayDate
                            ? `/(tabs)/transactions/edit/${item.id}?instanceDate=${item.displayDate}`
                            : `/(tabs)/transactions/edit/${item.id}`;
                          router.push(route as any);
                        };
                        const accentStyle = isProject
                          ? { backgroundColor: COLORS.teal + '50' }
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
                            <View key={`${item.id}-${item.displayDate || ''}`} style={[styles.row, styles.rowDraftColumn, index === items.length - 1 && styles.rowLast, isFuture && styles.rowFuture, isDraft && (isProjectDraft ? styles.rowDraftProject : styles.rowDraft)]}>
                              <View style={[styles.rowAccent, accentStyle]} />
                              {/* Ligne 1 : libellé + montant */}
                              <View style={styles.draftTopRow}>
                                <TouchableOpacity style={styles.rowLeft} onPress={navigateToEdit} activeOpacity={0.7}>
                                  <View style={styles.rowLabelRow}>
                                    <Ionicons name={iconForTransaction(item) as any} size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />
                                    {isProject && <View style={[styles.projectDot, { backgroundColor: COLORS.teal }]} />}
                                    <Text style={[styles.rowLabel, isProjectDraft ? styles.rowLabelDraftProject : styles.rowLabelDraft]} numberOfLines={1}>
                                      {item.note || item.category?.name || 'Sans libellé'}
                                    </Text>
                                    {isReserved ? (
                                      <View style={styles.reservedBadge}>
                                        <Ionicons name="bookmark" size={9} color={COLORS.blue} />
                                        <Text style={styles.reservedBadgeText}>Réservé</Text>
                                      </View>
                                    ) : (
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
                                </TouchableOpacity>
                                <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg, { textAlign: 'right' }]}>
                                  {amt > 0 ? '+' : ''}{amt.toFixed(2)} {CURRENCY_SYMBOL}
                                </Text>
                              </View>
                              {/* Ligne 2 : actions */}
                              <View style={styles.draftActionRow}>
                                {isReserved ? (
                                  <TouchableOpacity style={styles.draftActionDelete} onPress={() => confirmLiberateReserved(item)} activeOpacity={0.7}>
                                    <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                                    <Text style={[styles.draftActionValidateText, { color: COLORS.danger }]}>Libérer</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <>
                                    <TouchableOpacity style={styles.draftActionValidate} onPress={() => confirmValidateDraft(item)} activeOpacity={0.7}>
                                      <Ionicons name="checkmark" size={14} color={COLORS.green} />
                                      <Text style={styles.draftActionValidateText}>Valider</Text>
                                    </TouchableOpacity>
                                    {isProjectDraft && (
                                      <TouchableOpacity style={styles.draftActionConserve} onPress={() => confirmConserveDraft(item)} activeOpacity={0.7}>
                                        <Ionicons name="bookmark-outline" size={14} color={COLORS.blue} />
                                        <Text style={styles.draftActionConserveText}>Conserver</Text>
                                      </TouchableOpacity>
                                    )}
                                    <TouchableOpacity style={styles.draftActionDelete} onPress={() => confirmDeleteDraft(item)} activeOpacity={0.7}>
                                      <Ionicons name="trash-outline" size={14} color={COLORS.danger} />
                                    </TouchableOpacity>
                                  </>
                                )}
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
                                <Ionicons name={iconForTransaction(item) as any} size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />
                                {isProject && <View style={[styles.projectDot, { backgroundColor: COLORS.teal }]} />}
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
                              <Text style={[styles.rowAmount, amt > 0 ? { color: COLORS.green } : styles.rowAmountNeg]}>
                                {amt > 0 ? '+' : ''}{amt.toFixed(2)} {CURRENCY_SYMBOL}
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

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <AdSlot placement="transactions" />
        </ScrollView>
        </View>
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

      <GuideOverlay
        visible={guide.visible}
        steps={TX_GUIDE_STEPS}
        currentStep={guide.step}
        onNext={() => guide.goNext(TX_GUIDE_STEPS.length)}
        onSkip={guide.skip}
        screenTitle="Transactions"
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  header: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: c.card,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 13, fontWeight: '600', color: c.text },
  clearFilter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingVertical: 8 },
  clearFilterText: { fontSize: 14, color: c.emerald, fontWeight: '600' },
  activeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.3)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  filterChipText: { fontSize: 13, color: c.emerald, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },
  monthBlock: { marginBottom: 20 },
  monthHeader: { paddingVertical: 8, paddingHorizontal: 4, marginBottom: 4 },
  monthHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  card: {
    backgroundColor: c.card,
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: c.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  rowLast: { borderBottomWidth: 0 },
  rowFuture: { opacity: 0.38 },
  rowAlignStart: { alignItems: 'flex-start' },
  rowDraft: { borderLeftWidth: 2, borderLeftColor: c.orange },
  rowDraftProject: { borderLeftWidth: 2, borderLeftColor: c.blue },
  rowLabelDraft: { fontStyle: 'italic', color: c.orange },
  rowLabelDraftProject: { fontStyle: 'italic', color: c.blue },
  draftBadge: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.orange + '22', borderWidth: 1, borderColor: c.orange },
  draftBadgeProject: { backgroundColor: c.blue + '22', borderColor: c.blue },
  draftBadgeText: { fontSize: 10, fontWeight: '700', color: c.orange },
  draftBadgeTextProject: { color: c.blue },
  rowRightDraft: { alignItems: 'flex-end' },
  rowDraftColumn: { flexDirection: 'column', alignItems: 'stretch', gap: 7 },
  draftTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  draftActionRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  draftActionValidate: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, borderRadius: 8, backgroundColor: c.green + '18', borderWidth: 1, borderColor: c.green + '44' },
  draftActionValidateText: { fontSize: 12, fontWeight: '700', color: c.green },
  draftActionConserve: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, borderRadius: 8, backgroundColor: c.blue + '18', borderWidth: 1, borderColor: c.blue + '44' },
  draftActionConserveText: { fontSize: 12, fontWeight: '700', color: c.blue },
  draftActionDelete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.danger + '18', borderWidth: 1, borderColor: c.danger + '44' },
  reservedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: c.blue + '22', borderWidth: 1, borderColor: c.blue },
  reservedBadgeText: { fontSize: 10, fontWeight: '700', color: c.blue },
  rowAccent: {
    position: 'absolute' as const,
    left: 0,
    top: 8,
    bottom: 8,
    width: 2.5,
    borderRadius: 1.5,
  },
  rowAccentIncome: { backgroundColor: c.green + '60' },
  rowAccentProject: { backgroundColor: c.teal + '60' },
  rowLeft: { flex: 1, marginRight: 10 },
  rowLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const },
  projectDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: c.teal,
    marginRight: 6,
  },
  rowLabel: { fontSize: 15, fontWeight: '600', color: c.text, flexShrink: 1 },
  rowMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: c.green },
  rowAmountNeg: { color: c.text },
  reservationBadge: {
    backgroundColor: c.teal + '18',
    borderWidth: 1,
    borderColor: c.teal + '40',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reservationText: {
    color: c.teal,
    fontSize: 12,
    fontWeight: '600',
  },
  empty: { padding: 24, color: c.textSecondary, textAlign: 'center' },
  hint: { marginTop: 16, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  periodBtn: {
    padding: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtn: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginLeft: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  filterBtnActive: {
    backgroundColor: c.emerald,
    borderColor: c.emerald,
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
    borderColor: c.cardBorder,
    marginRight: 8,
    backgroundColor: c.card,
  },
  accountFilterChipActive: {
    backgroundColor: c.emerald,
    borderColor: c.emerald,
  },
  accountFilterChipText: {
    fontSize: 13,
    color: c.text,
    fontWeight: '500',
  },
  accountFilterChipTextActive: {
    color: c.bg,
    fontWeight: '600',
  },
  periodLabel: {
    flex: 1,
    alignItems: 'center',
  },
  periodText: {
    fontSize: 14,
    fontWeight: '600',
    color: c.text,
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  periodLabelHint: {
    fontSize: 11,
    color: c.emerald,
    marginTop: 2,
  },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  confirmBox: { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, width: '100%', maxWidth: 340, padding: 20 },
  confirmTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
  confirmMessage: { fontSize: 14, color: c.textSecondary, lineHeight: 20, marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10 },
  confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  confirmOkText: { fontSize: 14, fontWeight: '700' },
});
}
