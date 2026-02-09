import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions, TouchableOpacity, Platform, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTransactions } from '../hooks/useTransactions';
import { useCategories } from '../hooks/useCategories';
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

type PeriodFilter = 'n-1' | 'current' | 'n+1';

export default function TreasuryPlanScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: transactions = [], isLoading } = useTransactions(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const { data: overrides = [] } = useTransactionMonthOverrides(user?.id);
  const { width } = useWindowDimensions();
  const MONTH_COL_WIDTH = 80;
  const paddingH = 24 * 2;
  const labelWidth = Math.min(200, Math.max(140, width - paddingH - 3 * MONTH_COL_WIDTH));

  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('current');
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

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 12 mois de l'année : N-1 = année précédente, Mois en cours = année actuelle, N+1 = année suivante
  const months = useMemo(() => {
    if (periodFilter === 'n-1') return getMonthsFromOffset(-12, 12);   // 12 mois précédents
    if (periodFilter === 'n+1') return getMonthsFromOffset(12, 12);    // 12 mois à partir de +1 an
    return getMonthsFromOffset(0, 12);                                 // 12 mois année en cours
  }, [periodFilter]);

  // Mois à surligner : même mois que le mois en cours, dans l'année affichée (ex. N-1 → fév. 2025 si on est en fév. 2026)
  const highlightMonthKey = useMemo(() => {
    if (periodFilter === 'n-1') return getMonthKey(currentYear - 1, currentMonth);
    if (periodFilter === 'n+1') return getMonthKey(currentYear + 1, currentMonth);
    return getMonthKey(currentYear, currentMonth);
  }, [periodFilter, currentYear, currentMonth]);

  const colWidth = MONTH_COL_WIDTH;

  // Année affichée dans le tableau (N-1, année en cours, ou N+1)
  const displayYear = periodFilter === 'n-1' ? currentYear - 1 : periodFilter === 'n+1' ? currentYear + 1 : currentYear;

  const incomeGrouped = useMemo(() => groupCategories(categories.filter((c) => c.type === 'income')), [categories]);
  const expenseGrouped = useMemo(() => groupCategories(categories.filter((c) => c.type === 'expense')), [categories]);

  const planData = useMemo(() => {
    const overridesMap = createOverridesMap(overrides);
    const byCategoryMonth: Record<string, Record<string, number>> = {};
    const txByMonthCategory: Record<string, Record<string, TransactionWithDetails[]>> = {};
    const incomeByMonth: Record<string, number> = {};
    const expenseByMonth: Record<string, number> = {};
    months.forEach((m) => {
      incomeByMonth[m.key] = 0;
      expenseByMonth[m.key] = 0;
    });

    for (const t of transactions as TransactionWithDetails[]) {
      const amount = Number(t.amount);
      const date = t.date;
      const catId = t.category_id ?? 'none';
      if (!byCategoryMonth[catId]) byCategoryMonth[catId] = {};
      if (!txByMonthCategory[catId]) txByMonthCategory[catId] = {};
      
      months.forEach((m) => {
        if (!byCategoryMonth[catId][m.key]) {
          byCategoryMonth[catId][m.key] = 0;
          txByMonthCategory[catId][m.key] = [];
        }
      });

      if (t.is_recurring && t.recurrence_rule) {
        for (const m of months) {
          const calculatedAmt = addRecurrenceToMonth(m.year, m.month, amount, date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          const overrideKey = getOverrideKey(t.id, m.year, m.month);
          const finalAmt = overridesMap[overrideKey] !== undefined ? overridesMap[overrideKey] : calculatedAmt;
          
          if (finalAmt > 0) {
            incomeByMonth[m.key] = (incomeByMonth[m.key] ?? 0) + finalAmt;
            byCategoryMonth[catId][m.key] = (byCategoryMonth[catId][m.key] ?? 0) + finalAmt;
          } else if (finalAmt < 0) {
            expenseByMonth[m.key] = (expenseByMonth[m.key] ?? 0) + Math.abs(finalAmt);
            byCategoryMonth[catId][m.key] = (byCategoryMonth[catId][m.key] ?? 0) + finalAmt;
          }
          txByMonthCategory[catId][m.key].push(t);
        }
      } else {
        const [y, mo] = date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) {
          if (amount > 0) {
            incomeByMonth[key] = (incomeByMonth[key] ?? 0) + amount;
            byCategoryMonth[catId][key] = (byCategoryMonth[catId][key] ?? 0) + amount;
          } else {
            expenseByMonth[key] = (expenseByMonth[key] ?? 0) + Math.abs(amount);
            byCategoryMonth[catId][key] = (byCategoryMonth[catId][key] ?? 0) + amount;
          }
          txByMonthCategory[catId][key].push(t);
        }
      }
    }

    type Row = {
      label: string;
      categoryId: string | null;
      type: 'income' | 'expense' | 'balance';
      values: Record<string, number>;
      isChild?: boolean;
      isParentCategory?: boolean;
      isTotalLine?: boolean;
      isSectionHeader?: boolean;
      isBlockStart?: boolean;
    };
    const rows: Row[] = [];

    // RECETTES : en-tête puis catégories (parent = somme des sous-catégories) puis TOTAL RECETTES
    rows.push({ label: 'RECETTES', categoryId: null, type: 'income', values: {}, isSectionHeader: true });
    incomeGrouped.parents.forEach((p) => {
      const children = incomeGrouped.byParent[p.id] ?? [];
      const parentValues: Record<string, number> = {};
      months.forEach((m) => {
        parentValues[m.key] = children.reduce((sum, c) => sum + (byCategoryMonth[c.id]?.[m.key] ?? 0), 0);
      });
      rows.push({ label: p.name, categoryId: p.id, type: 'income', values: parentValues, isParentCategory: true });
      children.forEach((c) => {
        rows.push({ label: c.name, categoryId: c.id, type: 'income', values: byCategoryMonth[c.id] ?? {}, isChild: true });
      });
    });
    rows.push({ label: 'TOTAL RECETTES', categoryId: null, type: 'income', values: incomeByMonth, isTotalLine: true });

    // Soldes : entre Recettes et Dépenses
    const balanceByMonth: Record<string, number> = {};
    months.forEach((m) => {
      balanceByMonth[m.key] = (incomeByMonth[m.key] ?? 0) - (expenseByMonth[m.key] ?? 0);
    });
    rows.push({ label: 'Solde mensuel', categoryId: null, type: 'balance', values: balanceByMonth, isBlockStart: true });
    let c = 0;
    const cumulByMonth: Record<string, number> = {};
    months.forEach((m) => {
      c += balanceByMonth[m.key] ?? 0;
      cumulByMonth[m.key] = c;
    });
    rows.push({ label: 'Solde cumulé', categoryId: null, type: 'balance', values: cumulByMonth });

    // DÉPENSES : en-tête puis catégories (parent = somme des sous-catégories) puis TOTAL DÉPENSES
    rows.push({ label: 'DÉPENSES', categoryId: null, type: 'expense', values: {}, isSectionHeader: true, isBlockStart: true });
    expenseGrouped.parents.forEach((p) => {
      const children = expenseGrouped.byParent[p.id] ?? [];
      const parentValues: Record<string, number> = {};
      months.forEach((m) => {
        parentValues[m.key] = children.reduce((sum, c) => sum + Math.abs(byCategoryMonth[c.id]?.[m.key] ?? 0), 0);
      });
      rows.push({ label: p.name, categoryId: p.id, type: 'expense', values: parentValues, isParentCategory: true });
      children.forEach((c) => {
        rows.push({ label: c.name, categoryId: c.id, type: 'expense', values: byCategoryMonth[c.id] ?? {}, isChild: true });
      });
    });
    rows.push({ label: 'TOTAL DÉPENSES', categoryId: null, type: 'expense', values: expenseByMonth, isTotalLine: true });

    return { rows, months, txByMonthCategory };
  }, [transactions, months, incomeGrouped, expenseGrouped, overrides]);

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
          <View style={styles.filterRow}>
            {(['n-1', 'current', 'n+1'] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, periodFilter === f && styles.filterChipActive]}
                onPress={() => setPeriodFilter(f)}
                accessibilityRole="button"
              >
                <Text style={[styles.filterChipText, periodFilter === f && styles.filterChipTextActive]}>
                  {f === 'n-1' ? 'N-1' : f === 'current' ? 'Mois en cours' : 'N+1'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {!isLoading && (
          <Text style={styles.yearLabel}>Année {displayYear}</Text>
        )}

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
                      idx === 0 && row.type !== 'balance' && styles.tableRowHighlight,
                      row.isParentCategory && styles.tableRowParentCategory,
                      row.isParentCategory && row.type === 'income' && styles.tableRowParentCategoryIncome,
                      row.isParentCategory && row.type === 'expense' && styles.tableRowParentCategoryExpense,
                      row.isTotalLine && row.type === 'income' && styles.tableRowTotalRecettes,
                      row.isTotalLine && row.type === 'expense' && styles.tableRowTotalDepenses,
                      row.isSectionHeader && styles.tableRowSectionHeader,
                      row.isSectionHeader && row.type === 'income' && styles.tableRowSectionRecettes,
                      row.isSectionHeader && row.type === 'expense' && styles.tableRowSectionDepenses,
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
                        row.type === 'balance' && styles.cellLabelBalance,
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
                    
                    return (
                      <TouchableOpacity
                        key={m.key}
                        style={[
                          styles.cell,
                          styles.cellNum,
                          { width: colWidth },
                        ]}
                        onPress={() => {
                          // Pour les catégories (pas totaux/sections), afficher le menu
                          if (row.categoryId && !row.isTotalLine && !row.isSectionHeader) {
                            showCellMenu(m.key, row.categoryId, val);
                          } else {
                            // Pour tout le reste, voir les transactions
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
                            row.type === 'expense' && row.label !== 'Solde mensuel' && row.label !== 'Solde cumulé' && styles.cellNumNegative,
                            isBalance && (isPos ? styles.cellNumPositive : styles.cellNumNegative),
                            row.isParentCategory && styles.cellNumTextParentCategory,
                          ]}
                          numberOfLines={1}
                        >
                          {val !== 0 ? val.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '–'}
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
  controls: { marginBottom: 16 },
  yearLabel: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 12, textAlign: 'center' },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: COLORS.cardBorder },
  filterChipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  filterChipText: { fontSize: 13, color: COLORS.textSecondary },
  filterChipTextActive: { color: COLORS.bg, fontWeight: '600' },
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
    paddingHorizontal: 12,
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
  cellLabelBalance: { fontWeight: '700', color: COLORS.balance },
  cellLabelTotalRecettes: { fontSize: 12, fontWeight: '800', color: COLORS.emerald, letterSpacing: 0.8 },
  cellLabelTotalDepenses: { fontSize: 12, fontWeight: '800', color: COLORS.danger, letterSpacing: 0.8 },
  cellNumText: { fontSize: 13, color: COLORS.text },
  cellNumTextParentCategory: { fontWeight: '700' },
  cellNumPositive: { color: COLORS.emerald, fontWeight: '600' },
  cellNumNegative: { color: COLORS.danger, fontWeight: '600' },
  cellClickable: {
    backgroundColor: 'rgba(52, 211, 153, 0.08)',
    borderRadius: 4,
  },
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
