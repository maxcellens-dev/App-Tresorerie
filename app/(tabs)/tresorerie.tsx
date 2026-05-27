import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions, TouchableOpacity, Platform, Alert, Modal, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useCategories } from '../hooks/useCategories';
import { useAccounts } from '../hooks/useAccounts';
import { useTransactionMonthOverrides } from '../hooks/useTransactionMonthOverrides';
import EditTransactionMonthModal from '../components/EditTransactionMonthModal';
import type { RecurrenceRule, TransactionWithDetails } from '../types/database';
import type { Category } from '../types/database';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
  balance: '#60a5fa',
  currentMonth: 'rgba(52, 211, 153, 0.15)',
};

const TABLE_HEADER_HEIGHT = 52;
const TABLE_ROW_HEIGHT = 56;
const TABLE_EXTRA_HEIGHT = 60;
const SCROLL_BOTTOM_PADDING = 24;

function getMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthsFromOffset(monthOffset: number, count: number): { year: number; month: number; key: string }[] {
  const now = new Date();
  const out: { year: number; month: number; key: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + monthOffset + i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: getMonthKey(d.getFullYear(), d.getMonth() + 1) });
  }
  return out;
}

function addRecurrenceToMonth(year: number, month: number, amount: number, startDate: string, rule: RecurrenceRule, endDate: string | null, currentDate: Date): number {
  const start = new Date(startDate);
  // Limite à 24 mois maximum à partir de maintenant
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

function groupCategories(categories: Category[]) {
  const parents = categories.filter((c) => !c.parent_id);
  const byParent: Record<string, Category[]> = {};
  for (const c of categories) {
    if (c.parent_id) {
      byParent[c.parent_id] = byParent[c.parent_id] ?? [];
      byParent[c.parent_id].push(c);
    }
  }
  return { parents, byParent };
}

// Créer un map des overrides pour accès rapide
function createOverridesMap(overrides: Array<{ transaction_id: string; year: number; month: number; override_amount: number }>) {
  const map: Record<string, number> = {};
  overrides.forEach((o) => {
    const key = `${o.transaction_id}:${o.year}:${o.month}`;
    map[key] = o.override_amount;
  });
  return map;
}

const getOverrideKey = (transactionId: string, year: number, month: number): string => {
  return `${transactionId}:${year}:${month}`;
};


export default function TreasuryPlanScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const transactionsQuery = useTransactions(user?.id);
  const categoriesQuery = useCategories(user?.id);
  const overridesQuery = useTransactionMonthOverrides(user?.id);
  const accountsQuery = useAccounts(user?.id);

  const { data: transactions = [], isLoading } = transactionsQuery;
  const { data: categories = [] } = categoriesQuery;
  const { data: overrides = [] } = overridesQuery;
  const { data: accounts = [] } = accountsQuery;

  // Solde réel des comptes courants = point de départ du solde cumulatif
  const checkingBalance = useMemo(
    () => accounts.filter((a) => a.type === 'checking').reduce((s, a) => s + Number(a.balance), 0),
    [accounts]
  );
  const { width } = useWindowDimensions();
  const MONTH_COL_WIDTH = 80;
  const paddingH = 24 * 2;
  const labelWidth = Math.min(200, Math.max(140, width - paddingH - 3 * MONTH_COL_WIDTH));

  const [monthOffset, setMonthOffset] = useState(-1);
  const [editModalState, setEditModalState] = useState<{
    visible: boolean;
    transactionId?: string;
    transactionLabel?: string;
    categoryName?: string;
    year?: number;
    month?: number;
    originalAmount?: number;
    currentOverrideAmount?: number;
  }>({ visible: false });
  
  const [menuModalState, setMenuModalState] = useState<{
    visible: boolean;
    monthKey?: string;
    categoryId?: string;
    value?: number;
  }>({ visible: false });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        transactionsQuery.refetch?.(),
        categoriesQuery.refetch?.(),
        overridesQuery.refetch?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Fenêtre glissante de 12 mois à partir de (mois courant + offset)
  const months = useMemo(() => getMonthsFromOffset(monthOffset, 12), [monthOffset]);

  // Toujours surligner le vrai mois courant
  const highlightMonthKey = getMonthKey(currentYear, currentMonth);

  const colWidth = MONTH_COL_WIDTH;

  // Label de la plage affichée, ex. "Mai 2026 – Avr. 2027"
  const rangeLabel = useMemo(() => {
    if (months.length === 0) return '';
    const fmt = (y: number, m: number) =>
      new Date(y, m - 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
    const first = months[0];
    const last = months[months.length - 1];
    return `${fmt(first.year, first.month)} – ${fmt(last.year, last.month)}`;
  }, [months]);

  const incomeGrouped = useMemo(() => groupCategories(categories.filter((c) => c.type === 'income')), [categories]);
  const expenseGrouped = useMemo(() => groupCategories(categories.filter((c) => c.type === 'expense')), [categories]);

  const planData = useMemo(() => {
    const overridesMap = createOverridesMap(overrides);
    const byCategoryMonth: Record<string, Record<string, number>> = {};
    const txByMonthCategory: Record<string, Record<string, TransactionWithDetails[]>> = {};
    const mouvEpargne: Record<string, number> = {};
    const mouvInvest: Record<string, number> = {};
    // Track regul by note (raw signed amounts) for the gray row under Frais variables
    const regulByMonth: Record<string, number> = {};
    months.forEach((m) => {
      mouvEpargne[m.key] = 0;
      mouvInvest[m.key] = 0;
      regulByMonth[m.key] = 0;
    });

    // Helper: accumulate a signed amount into a Mouvements bucket (handles recurring)
    const addToMouv = (bucket: Record<string, number>, t: TransactionWithDetails, rawAmt: number) => {
      if (t.is_recurring && t.recurrence_rule) {
        for (const m of months) {
          const calc = addRecurrenceToMonth(m.year, m.month, rawAmt, t.date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          const key = getOverrideKey(t.id, m.year, m.month);
          const final = overridesMap[key] !== undefined ? overridesMap[key] : calc;
          bucket[m.key] = (bucket[m.key] ?? 0) + final;
        }
      } else {
        const [y, mo] = t.date.split('-').map(Number);
        const mKey = getMonthKey(y, mo);
        if (months.some((m) => m.key === mKey)) {
          bucket[mKey] = (bucket[mKey] ?? 0) + rawAmt;
        }
      }
    };

    for (const t of transactions as TransactionWithDetails[]) {
      const amount = Number(t.amount);
      const isChecking = t.account?.type === 'checking';
      const linkedType = t.linked_account?.type;

      // Identifier les Mouvements
      const isSavingsMove = isChecking && linkedType === 'savings';
      const isInvestMove = isChecking && linkedType === 'investment';
      const isRegulMove = isChecking && !t.linked_account_id &&
        (t.note?.startsWith('Régularisation') || t.note === 'Ajustement de solde');
      // Exclure l'autre côté d'un virement (compte non-courant avec linked_account_id)
      const isExcluded = !!t.linked_account_id && !isChecking;

      if (isExcluded) continue;
      if (isSavingsMove) { addToMouv(mouvEpargne, t, amount); continue; }
      if (isInvestMove) { addToMouv(mouvInvest, t, amount); continue; }

      // Régularisation dépense (montant négatif): row grise sous Frais variables
      // Régularisation recette (montant positif): tombe dans byCategoryMonth → section RECETTES
      if (isRegulMove && amount < 0) {
        addToMouv(regulByMonth, t, amount);
        // Pas de continue → tombe aussi dans le traitement classique ci-dessous
      }

      // Traitement classique recettes/dépenses
      const catId = t.category_id ?? 'none';
      if (!byCategoryMonth[catId]) byCategoryMonth[catId] = {};
      if (!txByMonthCategory[catId]) txByMonthCategory[catId] = {};
      months.forEach((m) => {
        if (!byCategoryMonth[catId][m.key]) { byCategoryMonth[catId][m.key] = 0; txByMonthCategory[catId][m.key] = []; }
      });

      if (t.is_recurring && t.recurrence_rule) {
        for (const m of months) {
          const calculatedAmt = addRecurrenceToMonth(m.year, m.month, amount, t.date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          const overrideKey = getOverrideKey(t.id, m.year, m.month);
          const finalAmt = overridesMap[overrideKey] !== undefined ? overridesMap[overrideKey] : calculatedAmt;
          byCategoryMonth[catId][m.key] = (byCategoryMonth[catId][m.key] ?? 0) + finalAmt;
          txByMonthCategory[catId][m.key].push(t);
        }
      } else {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) {
          byCategoryMonth[catId][key] = (byCategoryMonth[catId][key] ?? 0) + amount;
          txByMonthCategory[catId][key].push(t);
        }
      }
    }

    type Row = {
      label: string;
      categoryId: string | null;
      type: 'income' | 'expense' | 'balance' | 'mouvement';
      values: Record<string, number>;
      isChild?: boolean;
      isParentCategory?: boolean;
      isTotalLine?: boolean;
      isSectionHeader?: boolean;
      isBlockStart?: boolean;
      isRegulRow?: boolean;
    };
    const rows: Row[] = [];

    // RECETTES — pré-calcul des totaux (header affiche le total directement)
    const incomeCatTotals: Record<string, number> = {};
    months.forEach((m) => { incomeCatTotals[m.key] = 0; });
    const incomeParentRows: Row[] = [];

    incomeGrouped.parents.forEach((p) => {
      const children = incomeGrouped.byParent[p.id] ?? [];
      const parentValues: Record<string, number> = {};
      months.forEach((m) => {
        parentValues[m.key] = (byCategoryMonth[p.id]?.[m.key] ?? 0) +
          children.reduce((sum, c) => sum + (byCategoryMonth[c.id]?.[m.key] ?? 0), 0);
        incomeCatTotals[m.key] += parentValues[m.key];
      });
      incomeParentRows.push({ label: p.name, categoryId: p.id, type: 'income', values: parentValues, isParentCategory: true });
      children.forEach((c) => {
        incomeParentRows.push({ label: c.name, categoryId: c.id, type: 'income', values: byCategoryMonth[c.id] ?? {}, isChild: true });
      });
    });

    // Header RECETTES avec le total intégré
    rows.push({ label: 'RECETTES', categoryId: null, type: 'income', values: incomeCatTotals, isSectionHeader: true });
    incomeParentRows.forEach((r) => rows.push(r));

    // DÉPENSES — pré-calcul (avant SOLDES car Solde mensuel dépend des deux totaux)
    const expenseCatTotals: Record<string, number> = {};
    months.forEach((m) => { expenseCatTotals[m.key] = 0; });

    type ExpenseBlock = { parentRow: Row; childRows: Row[]; regulRow?: Row };
    const expenseBlocks: ExpenseBlock[] = [];

    expenseGrouped.parents
      .filter((p) => p.name !== 'Mouvements')
      .forEach((p) => {
        const children = expenseGrouped.byParent[p.id] ?? [];
        const isFraisVariables = p.name === 'Frais variables';
        const parentValues: Record<string, number> = {};
        months.forEach((m) => {
          // Frais variables: inclure les régularisations détectées par libellé
          const regulAbs = isFraisVariables ? Math.abs(regulByMonth[m.key] ?? 0) : 0;
          parentValues[m.key] = Math.abs(byCategoryMonth[p.id]?.[m.key] ?? 0) +
            children.reduce((sum, c) => sum + Math.abs(byCategoryMonth[c.id]?.[m.key] ?? 0), 0) +
            regulAbs;
          expenseCatTotals[m.key] += parentValues[m.key];
        });

        const childRows: Row[] = children.map((c) => ({
          label: c.name, categoryId: c.id, type: 'expense' as const,
          values: byCategoryMonth[c.id] ?? {}, isChild: true,
        }));

        let regulRow: Row | undefined;
        if (isFraisVariables) {
          // Valeurs absolues pour affichage cohérent (rouge car type expense)
          const regulAbs: Record<string, number> = {};
          months.forEach((m) => { regulAbs[m.key] = Math.abs(regulByMonth[m.key] ?? 0); });
          regulRow = { label: 'Régularisation solde', categoryId: null, type: 'expense', values: regulAbs, isChild: true, isRegulRow: true };
        }

        expenseBlocks.push({
          parentRow: { label: p.name, categoryId: p.id, type: 'expense', values: parentValues, isParentCategory: true },
          childRows,
          regulRow,
        });
      });

    // Solde réel du compte courant par mois affiché (toutes transactions courant, incl. mouvements)
    const checkingNetByMonth: Record<string, number> = {};
    months.forEach((m) => { checkingNetByMonth[m.key] = 0; });
    for (const t of transactions as TransactionWithDetails[]) {
      if (t.account?.type !== 'checking') continue;
      const amt = Number(t.amount);
      if (t.is_recurring && t.recurrence_rule) {
        for (const m of months) {
          const calc = addRecurrenceToMonth(m.year, m.month, amt, t.date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          const overrideKey = getOverrideKey(t.id, m.year, m.month);
          const final = overridesMap[overrideKey] !== undefined ? overridesMap[overrideKey] : calc;
          checkingNetByMonth[m.key] = (checkingNetByMonth[m.key] ?? 0) + final;
        }
      } else {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) {
          checkingNetByMonth[key] = (checkingNetByMonth[key] ?? 0) + amt;
        }
      }
    }

    // SOLDE :
    // - Mois passés  : solde réel à fin de mois (rétro depuis checkingBalance)
    // - Mois courant : checkingBalance (solde actuel)
    // - Mois futurs  : projection cumulative via checkingNetByMonth (toutes transactions courant récurrentes)
    //   → même formule que le cas "fenêtre 100% future" pour garantir la cohérence lors de la navigation
    const currentMonthKey = getMonthKey(currentYear, currentMonth);
    const currentIdx = months.findIndex((m) => m.key === currentMonthKey);
    const soldeByMonth: Record<string, number> = {};

    // Helper : net d'un mois quelconque (hors fenêtre) pour les mois intermédiaires
    const computeMonthNet = (y: number, mo: number): number => {
      let net = 0;
      for (const t of transactions as TransactionWithDetails[]) {
        if (t.account?.type !== 'checking') continue;
        const amt = Number(t.amount);
        if (t.is_recurring && t.recurrence_rule) {
          const calc = addRecurrenceToMonth(y, mo, amt, t.date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          const overrideKey = getOverrideKey(t.id, y, mo);
          net += overridesMap[overrideKey] !== undefined ? overridesMap[overrideKey] : calc;
        } else {
          const [ty, tm] = t.date.split('-').map(Number);
          if (ty === y && tm === mo) net += amt;
        }
      }
      return net;
    };

    if (currentIdx >= 0) {
      // Mois courant dans la fenêtre
      soldeByMonth[currentMonthKey] = checkingBalance;
      // Passés : remonter en soustrayant le net réel du mois suivant
      for (let i = currentIdx - 1; i >= 0; i--) {
        const nextKey = months[i + 1].key;
        soldeByMonth[months[i].key] = soldeByMonth[nextKey] - checkingNetByMonth[nextKey];
      }
      // Futurs : avancer avec checkingNetByMonth (cohérent avec le cas all-future)
      for (let i = currentIdx + 1; i < months.length; i++) {
        soldeByMonth[months[i].key] = soldeByMonth[months[i - 1].key] + checkingNetByMonth[months[i].key];
      }
    } else if (months.length > 0 && months[0].key > currentMonthKey) {
      // Fenêtre 100% future : projeter depuis mois courant+1 jusqu'au début de la fenêtre
      // puis continuer sur les mois affichés — le solde est ainsi indépendant du monthOffset
      let prev = checkingBalance;
      let d = new Date(currentYear, currentMonth, 1); // premier mois APRÈS le mois courant
      const firstDate = new Date(months[0].year, months[0].month - 1, 1);
      while (d < firstDate) {
        prev += computeMonthNet(d.getFullYear(), d.getMonth() + 1);
        d.setMonth(d.getMonth() + 1);
      }
      months.forEach((m) => {
        prev += checkingNetByMonth[m.key];
        soldeByMonth[m.key] = prev;
      });
    } else {
      // Fenêtre 100% passée : ancrage sur le dernier mois, remonter
      soldeByMonth[months[months.length - 1].key] = checkingBalance;
      for (let i = months.length - 2; i >= 0; i--) {
        const nextKey = months[i + 1].key;
        soldeByMonth[months[i].key] = soldeByMonth[nextKey] - checkingNetByMonth[nextKey];
      }
    }

    rows.push({ label: 'Solde', categoryId: null, type: 'balance', values: soldeByMonth, isBlockStart: true });

    // MOUVEMENTS — toujours visible (virements épargne/invest uniquement)
    rows.push({ label: 'MOUVEMENTS', categoryId: null, type: 'mouvement', values: {}, isSectionHeader: true, isBlockStart: true });
    rows.push({ label: 'Épargne', categoryId: null, type: 'mouvement', values: mouvEpargne, isChild: true });
    rows.push({ label: 'Investissements', categoryId: null, type: 'mouvement', values: mouvInvest, isChild: true });

    // DÉPENSES — header avec le total intégré
    rows.push({ label: 'DÉPENSES', categoryId: null, type: 'expense', values: expenseCatTotals, isSectionHeader: true, isBlockStart: true });
    expenseBlocks.forEach(({ parentRow, childRows, regulRow }) => {
      rows.push(parentRow);
      childRows.forEach((r) => rows.push(r));
      if (regulRow) rows.push(regulRow);
    });

    return { rows, months, txByMonthCategory };
  }, [transactions, months, incomeGrouped, expenseGrouped, overrides, checkingBalance]);

  const goToTransactions = (monthKey: string, categoryId: string | null) => {
    const url = categoryId
      ? `/(tabs)/transactions?focusMonth=${monthKey}&categoryId=${categoryId}&singleMonth=1`
      : `/(tabs)/transactions?focusMonth=${monthKey}&singleMonth=1`;
    router.push(url as any);
  };

  const openEditModal = (monthKey: string, categoryId: string | null, value: number) => {
    if (!categoryId) return;
    const [year, month] = monthKey.split('-').map(Number);
    
    const txList = planData?.txByMonthCategory?.[categoryId]?.[monthKey] ?? [];
    const recurring = txList.filter((t) => t.is_recurring && t.recurrence_rule);
    
    if (recurring.length === 0) return;
    
    const tx = recurring[0];
    const category = categories.find((c) => c.id === categoryId);
    setEditModalState({
      visible: true,
      transactionId: tx.id,
      transactionLabel: tx.note || 'Transaction',
      categoryName: category?.name,
      year,
      month,
      originalAmount: Math.abs(Number(tx.amount)),
      currentOverrideAmount: overrides.find(
        (o) => o.transaction_id === tx.id && o.year === year && o.month === month
      )?.override_amount,
    });
  };

  const showCellMenu = (monthKey: string, categoryId: string | null, value: number) => {
    if (!categoryId) return;
    setMenuModalState({ visible: true, monthKey, categoryId, value });
  };

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Text style={styles.hint}>Connectez-vous pour voir votre plan de trésorerie.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Text style={styles.subtitle}>Alimenté par vos transactions et récurrences. Appuyez sur un montant pour voir le détail.</Text>

        <View style={styles.controls}>
          <View style={styles.navRow}>
            <TouchableOpacity style={styles.navArrow} onPress={() => setMonthOffset((o) => o - 1)} accessibilityRole="button">
              <Ionicons name="chevron-back" size={22} color="#94a3b8" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navLabel} onPress={() => setMonthOffset(0)} accessibilityRole="button">
              <Text style={styles.navLabelText}>{rangeLabel}</Text>
              {monthOffset !== 0 && <Text style={styles.navLabelHint}>Appuyer pour revenir</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.navArrow} onPress={() => setMonthOffset((o) => o + 1)} accessibilityRole="button">
              <Ionicons name="chevron-forward" size={22} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>

        {isLoading ? (
          <Text style={styles.hint}>Chargement…</Text>
        ) : (
          <ScrollView
            style={styles.scrollOuter}
            contentContainerStyle={[
              styles.scrollOuterContent,
              {
                minHeight: TABLE_HEADER_HEIGHT + planData.rows.length * TABLE_ROW_HEIGHT + TABLE_EXTRA_HEIGHT,
                paddingBottom: SCROLL_BOTTOM_PADDING,
              },
            ]}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={COLORS.emerald}
                progressBackgroundColor={COLORS.card}
              />
            }
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={true}
              style={[styles.scrollInner, { height: TABLE_HEADER_HEIGHT + planData.rows.length * TABLE_ROW_HEIGHT + TABLE_EXTRA_HEIGHT }]}
              contentContainerStyle={[styles.scrollInnerContent, { paddingBottom: SCROLL_BOTTOM_PADDING }]}
              nestedScrollEnabled={true}
            >
            <View style={styles.tableWrap}>
            <View style={styles.table}>
              {(() => {
                const idx = planData.months.findIndex((m) => m.key === highlightMonthKey);
                if (idx === -1) return null;
                const inset = 4;
                return (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.currentMonthColumnOverlay,
                      {
                        left: labelWidth + idx * colWidth + inset,
                        width: colWidth - inset * 2,
                      },
                    ]}
                  />
                );
              })()}
              <View style={styles.tableHeader}>
                <View style={[styles.cell, styles.cellLabel, { width: labelWidth }]}>
                  <Text style={styles.headerLabel} numberOfLines={1}>Poste</Text>
                </View>
                {planData.months.map((m) => (
                  <View
                    key={m.key}
                    style={[
                      styles.cell,
                      styles.cellNum,
                      styles.cellNumHeaderMonth,
                      { width: colWidth },
                    ]}
                  >
                    <Text style={[styles.headerLabel, styles.headerLabelMonth, m.key === highlightMonthKey && styles.headerLabelCurrent]} numberOfLines={1}>
                      {new Date(m.year, m.month - 1).toLocaleDateString('fr-FR', { month: 'short' })}
                    </Text>
                  </View>
                ))}
              </View>
              {planData.rows.map((row, idx) => (
                <React.Fragment key={row.label + String(row.categoryId) + idx}>
                  <View
                    style={[
                      styles.tableRow,
                      row.type === 'income' && styles.tableRowIncome,
                      row.type === 'expense' && styles.tableRowExpense,
                      row.type === 'balance' && styles.tableRowBalance,
                      row.type === 'mouvement' && !row.isSectionHeader && styles.tableRowMouvement,
                      idx === 0 && row.type !== 'balance' && styles.tableRowHighlight,
                      row.isParentCategory && styles.tableRowParentCategory,
                      row.isParentCategory && row.type === 'income' && styles.tableRowParentCategoryIncome,
                      row.isParentCategory && row.type === 'expense' && styles.tableRowParentCategoryExpense,
                      row.isTotalLine && row.type === 'income' && styles.tableRowTotalRecettes,
                      row.isTotalLine && row.type === 'expense' && styles.tableRowTotalDepenses,
                      row.isSectionHeader && styles.tableRowSectionHeader,
                      row.isSectionHeader && row.type === 'income' && styles.tableRowSectionRecettes,
                      row.isSectionHeader && row.type === 'expense' && styles.tableRowSectionDepenses,
                      row.isSectionHeader && row.type === 'mouvement' && styles.tableRowSectionMouvements,
                      row.isBlockStart && styles.tableRowBlockStart,
                    ]}
                  >
                  <View style={[styles.cell, styles.cellLabel, { width: labelWidth }, row.isChild && styles.cellLabelIndent]}>
                    <Text
                      style={[
                        styles.cellLabelText,
                        row.isChild && styles.cellLabelChild,
                        row.isParentCategory && styles.cellLabelParentCategory,
                        row.isTotalLine && row.type === 'income' && styles.cellLabelTotalRecettes,
                        row.isTotalLine && row.type === 'expense' && styles.cellLabelTotalDepenses,
                        row.isSectionHeader && row.type === 'income' && styles.cellLabelSectionRecettes,
                        row.isSectionHeader && row.type === 'expense' && styles.cellLabelSectionDepenses,
                        row.isSectionHeader && row.type === 'mouvement' && styles.cellLabelSectionMouvements,
                        row.type === 'balance' && styles.cellLabelBalance,
                        row.type === 'mouvement' && !row.isSectionHeader && styles.cellLabelMouvement,
                        row.isRegulRow && styles.cellLabelRegul,
                      ]}
                      numberOfLines={2}
                    >
                      {row.label}
                    </Text>
                  </View>
                  {planData.months.map((m) => {
                    const val = row.values[m.key] ?? 0;
                    const isPos = val >= 0;
                    const isBalance = row.type === 'balance';
                    // Dépenses toujours affichées en positif (sauf soldes et mouvements qui gardent le signe)
                    const displayVal = row.type === 'expense' ? Math.abs(val) : val;

                    return (
                      <TouchableOpacity
                        key={m.key}
                        style={[
                          styles.cell,
                          styles.cellNum,
                          { width: colWidth },
                        ]}
                        onPress={() => {
                          if (row.categoryId && !row.isTotalLine && !row.isSectionHeader) {
                            showCellMenu(m.key, row.categoryId, val);
                          } else {
                            goToTransactions(m.key, row.categoryId);
                          }
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                      >
                        <Text
                          style={[
                            styles.cellNumText,
                            row.type === 'income' && styles.cellNumPositive,
                            row.type === 'expense' && styles.cellNumNegative,
                            isBalance && (isPos ? styles.cellNumPositive : styles.cellNumNegative),
                            row.type === 'mouvement' && !row.isSectionHeader && (isPos ? styles.cellNumPositive : styles.cellNumNegative),
                            row.isParentCategory && styles.cellNumTextParentCategory,
                            row.isSectionHeader && styles.cellNumTextSectionTotal,
                          ]}
                          numberOfLines={1}
                        >
                          {displayVal !== 0 ? displayVal.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '–'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                </React.Fragment>
              ))}
            </View>
            </View>
            </ScrollView>
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Menu Modal */}
      <Modal
        visible={menuModalState.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuModalState({ visible: false })}
      >
        <TouchableOpacity 
          style={styles.menuOverlay}
          onPress={() => setMenuModalState({ visible: false })}
          activeOpacity={1}
        >
          <TouchableOpacity 
            style={styles.menuContainer}
            onPress={() => {}} 
            activeOpacity={1}
          >
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Que voulez-vous faire?</Text>
              <TouchableOpacity onPress={() => setMenuModalState({ visible: false })}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                setMenuModalState({ visible: false });
                openEditModal(menuModalState.monthKey || '', menuModalState.categoryId, menuModalState.value || 0);
              }}
            >
              <Ionicons name="pencil" size={20} color="#34d399" />
              <Text style={styles.menuOptionText}>Modifier montant</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                setMenuModalState({ visible: false });
                goToTransactions(menuModalState.monthKey || '', menuModalState.categoryId);
              }}
            >
              <Ionicons name="eye" size={20} color="#60a5fa" />
              <Text style={styles.menuOptionText}>Voir transaction</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Edit Transaction Month Modal */}
      <EditTransactionMonthModal
        visible={editModalState.visible}
        onClose={() => setEditModalState({ visible: false })}
        transactionId={editModalState.transactionId || ''}
        transactionLabel={editModalState.transactionLabel || ''}
        categoryName={editModalState.categoryName}
        year={editModalState.year || 0}
        month={editModalState.month || 0}
        originalAmount={editModalState.originalAmount || 0}
        currentOverrideAmount={editModalState.currentOverrideAmount}
        profileId={user?.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 12 },
  controls: { marginBottom: 12 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { padding: 8 },
  navLabel: { flex: 1, alignItems: 'center' },
  navLabelText: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  navLabelHint: { fontSize: 11, color: COLORS.emerald, marginTop: 2 },
  hint: { color: COLORS.textSecondary },
  scrollOuter: { flex: 1 },
  scrollOuterContent: {},
  scrollInner: {},
  scrollInnerContent: { paddingBottom: 24 },
  scroll: { flex: 1 },
  tableWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.card,
    marginBottom: 24,
  },
  table: { position: 'relative' },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.12)',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 48,
    alignItems: 'center',
  },
  tableRowIncome: { backgroundColor: 'rgba(52, 211, 153, 0.05)' },
  tableRowExpense: { backgroundColor: 'rgba(248, 113, 113, 0.04)' },
  tableRowBalance: {
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.balance,
    paddingVertical: 10,
  },
  tableRowHighlight: { backgroundColor: 'rgba(52, 211, 153, 0.05)' },
  tableRowBlockStart: { marginTop: 20 },
  tableRowSectionHeader: {
    paddingVertical: 12,
  },
  tableRowSectionRecettes: {
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.emerald,
  },
  tableRowSectionDepenses: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
  },
  tableRowSectionMouvements: {
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#64748b',
    paddingVertical: 12,
  },
  tableRowMouvement: { backgroundColor: 'rgba(100, 116, 139, 0.06)' },
  tableRowParentCategory: {
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(148, 163, 184, 0.18)',
  },
  tableRowParentCategoryIncome: { backgroundColor: 'rgba(52, 211, 153, 0.11)' },
  tableRowParentCategoryExpense: { backgroundColor: 'rgba(248, 113, 113, 0.09)' },
  tableRowTotalRecettes: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(52, 211, 153, 0.25)',
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    paddingVertical: 12,
  },
  tableRowTotalDepenses: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(248, 113, 113, 0.25)',
    backgroundColor: 'rgba(248, 113, 113, 0.1)',
    paddingVertical: 12,
  },
  cell: { paddingHorizontal: 10, justifyContent: 'center' },
  cellLabel: {},
  cellLabelIndent: { paddingLeft: 24 },
  cellNum: { alignItems: 'flex-end' },
  cellClickable: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderRadius: 4,
  },
  cellNumHeaderMonth: { alignItems: 'center' },
  headerLabelMonth: { textAlign: 'center' },
  currentMonthColumnOverlay: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    backgroundColor: COLORS.currentMonth,
    borderRadius: 10,
  },
  headerLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  headerLabelCurrent: { color: COLORS.emerald, fontWeight: '700' },
  cellLabelText: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  cellLabelChild: { fontSize: 13, color: COLORS.textSecondary },
  cellLabelParentCategory: { fontWeight: '600', color: COLORS.text },
  cellLabelSectionRecettes: { fontSize: 12, fontWeight: '800', color: COLORS.emerald, letterSpacing: 1 },
  cellLabelSectionDepenses: { fontSize: 12, fontWeight: '800', color: COLORS.danger, letterSpacing: 1 },
  cellLabelSectionMouvements: { fontSize: 12, fontWeight: '800', color: '#94a3b8', letterSpacing: 1 },
  cellLabelMouvement: { fontSize: 13, color: '#94a3b8' },
  cellLabelRegul: { fontSize: 13, color: '#64748b', fontStyle: 'italic' },
  cellLabelBalance: { fontWeight: '700', color: COLORS.balance },
  cellLabelTotalRecettes: { fontSize: 12, fontWeight: '800', color: COLORS.emerald, letterSpacing: 0.8 },
  cellLabelTotalDepenses: { fontSize: 12, fontWeight: '800', color: COLORS.danger, letterSpacing: 0.8 },
  cellNumText: { fontSize: 13, color: COLORS.text },
  cellNumTextParentCategory: { fontWeight: '700' },
  cellNumTextSectionTotal: { fontSize: 15, fontWeight: '800' },
  cellNumPositive: { color: COLORS.emerald, fontWeight: '600' },
  cellNumNegative: { color: COLORS.danger, fontWeight: '600' },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    width: '80%',
    maxWidth: 320,
    overflow: 'hidden',
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.1)',
    gap: 12,
  },
  menuOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
});
