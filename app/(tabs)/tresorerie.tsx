import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions, TouchableOpacity, Platform, Alert, Modal, RefreshControl, TextInput } from 'react-native';
import ScreenGradient from '../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import GuideOverlay from '../components/GuideOverlay';
import { tabRect } from '../lib/tourTargets';
import type { BubbleStep } from '../components/GuideOverlay';
import { useScreenGuide } from '../hooks/useScreenGuide';
import { useTransactions, useAddTransaction } from '../hooks/useTransactions';
import { useCategories, useSeedDefaultCategories } from '../hooks/useCategories';
import { useAccounts } from '../hooks/useAccounts';
import { useTransactionMonthOverrides } from '../hooks/useTransactionMonthOverrides';
import EditTransactionMonthModal from '../components/EditTransactionMonthModal';
import type { RecurrenceRule, TransactionWithDetails } from '../types/database';
import type { Category } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { CURRENCY_SYMBOL } from '../lib/currency';


const TABLE_HEADER_HEIGHT = 52;
const TABLE_ROW_HEIGHT = 56;
const TABLE_EXTRA_HEIGHT = 44;
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
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // ── Vue simplifiée (masque les sous-catégories) — préférence persistée ──
  const { data: tresoProfile } = useProfile(user?.id);
  const updateProfileTreso = useUpdateProfile(user?.id);
  const [simplified, setSimplified] = useState(false);
  React.useEffect(() => { if (tresoProfile) setSimplified(Boolean((tresoProfile as any).treso_simplified)); }, [tresoProfile]);
  const toggleSimplified = () => { const v = !simplified; setSimplified(v); updateProfileTreso.mutate({ treso_simplified: v }); };

  // ── Guide "bulles" ──
  const guide = useScreenGuide('projection', user?.id);
  const navRowRef = React.useRef<any>(null);
  const tableRef = React.useRef<any>(null);
  const scrollOuterRef = React.useRef<ScrollView>(null);

  const TRESO_GUIDE: BubbleStep[] = [
    {
      getRect: () => tabRect(3),
      icon: 'calendar',
      iconColor: '#34d399',
      title: 'Onglet Tréso',
      description: 'Touchez « Tréso » dans la barre du bas pour votre plan de trésorerie sur 12 mois.',
    },
    {
      getRef: () => tableRef,
      icon: 'pencil',
      iconColor: '#a78bfa',
      title: 'Votre plan de trésorerie',
      description: 'Vos recettes, dépenses et soldes anticipés, mois par mois. Naviguez entre les périodes avec les flèches, et sur les mois futurs appuyez sur un montant pour le modifier.',
    },
  ];

  const transactionsQuery = useTransactions(user?.id);
  const categoriesQuery = useCategories(user?.id);
  const overridesQuery = useTransactionMonthOverrides(user?.id);
  const accountsQuery = useAccounts(user?.id);

  const { data: transactions = [], isLoading } = transactionsQuery;
  const { data: categories = [], isLoading: categoriesLoading } = categoriesQuery;
  const { data: overrides = [] } = overridesQuery;
  const { data: accounts = [] } = accountsQuery;
  const addTransaction = useAddTransaction(user?.id);

  // Filet de sécurité : créer les catégories par défaut si l'utilisateur n'en a aucune
  // (sinon le plan de trésorerie s'affiche vide).
  const seedDefaultCategories = useSeedDefaultCategories(user?.id);
  const hasSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (!user?.id || categoriesLoading || categories.length > 0 || hasSeededRef.current) return;
    hasSeededRef.current = true;
    seedDefaultCategories.mutate();
  }, [user?.id, categoriesLoading, categories.length]);

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

  const [draftModal, setDraftModal] = useState<{
    visible: boolean;
    monthKey: string;
    categoryId: string;
    categoryName: string;
    rowType: 'income' | 'expense';
  } | null>(null);
  const [draftAmount, setDraftAmount] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [draftAccountId, setDraftAccountId] = useState('');

  const [draftChoiceModal, setDraftChoiceModal] = useState<{
    visible: boolean;
    monthKey: string;
    categoryId: string;
    rowType: 'income' | 'expense';
    existingDrafts: TransactionWithDetails[];
  } | null>(null);

  const [virementDraftModal, setVirementDraftModal] = useState<{
    visible: boolean;
    monthKey: string;
    mouvementType: 'epargne' | 'invest';
  } | null>(null);
  const [virementAmount, setVirementAmount] = useState('');
  const [virementNote, setVirementNote] = useState('');
  const [virementDestAccountId, setVirementDestAccountId] = useState('');

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
    const mouvProjets: Record<string, number> = {};
    // Track regul by note (raw signed amounts) for the gray row under Frais variables
    const regulByMonth: Record<string, number> = {};
    months.forEach((m) => {
      mouvEpargne[m.key] = 0;
      mouvInvest[m.key] = 0;
      mouvProjets[m.key] = 0;
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

      const isProjectTx = !!(t as any).project_id;

      if (isExcluded) continue;
      // Validated project transfers go to Projets, not Épargne
      if (isSavingsMove && isProjectTx) { addToMouv(mouvProjets, t, amount); continue; }
      if (isSavingsMove) { addToMouv(mouvEpargne, t, amount); continue; }
      if (isInvestMove) { addToMouv(mouvInvest, t, amount); continue; }
      // Draft project transactions: route to Projets, not expense categories
      if (isProjectTx && isChecking) { addToMouv(mouvProjets, t, amount); continue; }

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

    // Tracker quels mois ont des brouillons par catégorie
    const hasDraftByCategory: Record<string, Record<string, boolean>> = {};
    const hasDraftProjets: Record<string, boolean> = {};
    const hasDraftEpargne: Record<string, boolean> = {};
    const hasDraftInvest: Record<string, boolean> = {};
    for (const t of transactions as TransactionWithDetails[]) {
      if (!(t as any).is_draft) continue;
      const isProjectTxDraft = !!(t as any).project_id;
      if (isProjectTxDraft) {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) hasDraftProjets[key] = true;
        continue;
      }
      const tIsChecking = t.account?.type === 'checking';
      const tLinkedType = t.linked_account?.type;
      if (tIsChecking && tLinkedType === 'savings') {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) hasDraftEpargne[key] = true;
        continue;
      }
      if (tIsChecking && tLinkedType === 'investment') {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) hasDraftInvest[key] = true;
        continue;
      }
      const catId = t.category_id ?? 'none';
      if (!hasDraftByCategory[catId]) hasDraftByCategory[catId] = {};
      if (t.is_recurring && t.recurrence_rule) {
        for (const m of months) {
          const calc = addRecurrenceToMonth(m.year, m.month, Number(t.amount), t.date, t.recurrence_rule as RecurrenceRule, t.recurrence_end_date ?? null, now);
          if (Math.abs(calc) > 0) hasDraftByCategory[catId][m.key] = true;
        }
      } else {
        const [y, mo] = t.date.split('-').map(Number);
        const key = getMonthKey(y, mo);
        if (months.some((m) => m.key === key)) hasDraftByCategory[catId][key] = true;
      }
    }

    type Row = {
      label: string;
      categoryId: string | null;
      type: 'income' | 'expense' | 'balance' | 'mouvement';
      values: Record<string, number>;
      hasDraft?: Record<string, boolean>;
      hasForecast?: Record<string, boolean>;
      isChild?: boolean;
      isParentCategory?: boolean;
      isTotalLine?: boolean;
      isSectionHeader?: boolean;
      isBlockStart?: boolean;
      isRegulRow?: boolean;
      isProjectRow?: boolean;
      mouvementType?: 'epargne' | 'invest';
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
      incomeParentRows.push({ label: p.name, categoryId: p.id, type: 'income', values: parentValues, isParentCategory: true, hasDraft: hasDraftByCategory[p.id] });
      children.forEach((c) => {
        incomeParentRows.push({ label: c.name, categoryId: c.id, type: 'income', values: byCategoryMonth[c.id] ?? {}, isChild: true, hasDraft: hasDraftByCategory[c.id] });
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

        const childRows: Row[] = children
          .filter((c) => c.name !== 'Projets')
          .map((c) => ({
            label: c.name, categoryId: c.id, type: 'expense' as const,
            values: byCategoryMonth[c.id] ?? {}, isChild: true, hasDraft: hasDraftByCategory[c.id],
          }));

        let regulRow: Row | undefined;
        if (isFraisVariables) {
          // Valeurs absolues pour affichage cohérent (rouge car type expense)
          const regulAbs: Record<string, number> = {};
          months.forEach((m) => { regulAbs[m.key] = Math.abs(regulByMonth[m.key] ?? 0); });
          regulRow = { label: 'Régularisation solde', categoryId: null, type: 'expense', values: regulAbs, isChild: true, isRegulRow: true };
        }

        expenseBlocks.push({
          parentRow: { label: p.name, categoryId: p.id, type: 'expense', values: parentValues, isParentCategory: true, hasDraft: hasDraftByCategory[p.id] },
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

    // Solde réel à fin de mois pour les mois PASSÉS :
    // = solde courant actuel − somme des vraies transactions courant (non-brouillon,
    //   hors modèles récurrents) datées APRÈS la fin de ce mois.
    // Cela ancre le solde sur les écritures réelles (ex. régularisation de solde),
    // au lieu de rétro-projeter les récurrences du mois entier. Cohérent avec l'écran compte.
    const lastDayOf = (y: number, mo: number): string =>
      `${y}-${String(mo).padStart(2, '0')}-${String(new Date(y, mo, 0).getDate()).padStart(2, '0')}`;
    // Date de la première activité réelle sur les comptes courant (1ère transaction non-brouillon).
    // Avant cette date, il n'y avait rien → le solde doit être 0, peu importe les écritures saisies.
    let firstCheckingActivity: string | null = null;
    for (const t of transactions as TransactionWithDetails[]) {
      if (t.account?.type !== 'checking') continue;
      if ((t as any).is_draft) continue;
      if (!firstCheckingActivity || t.date < firstCheckingActivity) firstCheckingActivity = t.date;
    }

    // Mois d'initialisation des comptes courants (YYYY-MM) — pour le calcul rétrograde avec init_date.
    const checkingInitMonths = new Set<string>();
    for (const acc of accounts) {
      if (acc.type !== 'checking') continue;
      const d = (acc as any).init_date as string | null | undefined;
      if (d) checkingInitMonths.add(d.slice(0, 7));
    }

    const realCheckingBalanceAtMonthEnd = (y: number, mo: number): number => {
      const emd = lastDayOf(y, mo);
      const myYM = `${y}-${String(mo).padStart(2, '0')}`;

      // Mois entièrement antérieur à la première activité → 0, sauf exception init_date.
      if (firstCheckingActivity && emd < firstCheckingActivity) {
        // Exception : le mois immédiatement avant le mois d'initialisation d'un compte courant
        // avec des transactions pré-init dans ce mois → afficher le solde rétrograde.
        const nextYM = mo === 12
          ? `${y + 1}-01`
          : `${y}-${String(mo + 1).padStart(2, '0')}`;
        const isBeforeInitMonth = checkingInitMonths.has(nextYM);
        const hasPreInitInNextMonth = isBeforeInitMonth && (transactions as TransactionWithDetails[]).some(
          (t) => t.account?.type === 'checking' && !(t as any).is_draft &&
                 !(t.is_recurring && t.recurrence_rule) && t.date > emd && t.date.slice(0, 7) === nextYM
        );
        // Exception : ce mois a ses propres transactions non-brouillon
        const hasOwnTransactions = (transactions as TransactionWithDetails[]).some(
          (t) => t.account?.type === 'checking' && !(t as any).is_draft &&
                 !(t.is_recurring && t.recurrence_rule) && t.date.slice(0, 7) === myYM
        );

        if (!hasPreInitInNextMonth && !hasOwnTransactions) return 0;
      }

      let after = 0;
      for (const t of transactions as TransactionWithDetails[]) {
        if (t.account?.type !== 'checking') continue;
        if ((t as any).is_draft) continue;
        if (t.is_recurring && t.recurrence_rule) continue; // modèles récurrents exclus (non matérialisés)
        if (t.date > emd) after += Number(t.amount);
      }
      return checkingBalance - after;
    };

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
      // Mois courant dans la fenêtre = solde actuel
      soldeByMonth[currentMonthKey] = checkingBalance;
      // Passés : solde réel à fin de mois ancré sur les vraies transactions
      for (let i = currentIdx - 1; i >= 0; i--) {
        soldeByMonth[months[i].key] = realCheckingBalanceAtMonthEnd(months[i].year, months[i].month);
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
      // Fenêtre 100% passée : chaque mois = solde réel à fin de mois (ancré sur les vraies transactions)
      months.forEach((m) => {
        soldeByMonth[m.key] = realCheckingBalanceAtMonthEnd(m.year, m.month);
      });
    }

    rows.push({ label: 'Solde', categoryId: null, type: 'balance', values: soldeByMonth, isBlockStart: true });

    // DÉPENSES total header
    rows.push({ label: 'DÉPENSES', categoryId: null, type: 'expense', values: expenseCatTotals, isSectionHeader: true, isBlockStart: true });

    // MOUVEMENTS — entre le total et le détail des dépenses
    const mouvTotal: Record<string, number> = {};
    months.forEach((m) => {
      mouvTotal[m.key] = (mouvProjets[m.key] ?? 0) + (mouvEpargne[m.key] ?? 0) + (mouvInvest[m.key] ?? 0);
    });
    rows.push({ label: 'MOUVEMENTS', categoryId: null, type: 'mouvement', values: mouvTotal, isSectionHeader: true });
    rows.push({ label: 'Projets', categoryId: null, type: 'mouvement', values: mouvProjets, isChild: true, isProjectRow: true, hasForecast: hasDraftProjets });
    rows.push({ label: 'Épargne', categoryId: null, type: 'mouvement', values: mouvEpargne, isChild: true, mouvementType: 'epargne', hasDraft: hasDraftEpargne });
    rows.push({ label: 'Investissements', categoryId: null, type: 'mouvement', values: mouvInvest, isChild: true, mouvementType: 'invest', hasDraft: hasDraftInvest });

    // Détail des dépenses par catégorie
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

  const openDraftModal = (monthKey: string, categoryId: string, rowType: 'income' | 'expense') => {
    const cat = categories.find((c) => c.id === categoryId);
    const defaultAccount = accounts.find((a) => a.type === 'checking');
    setDraftAmount('');
    setDraftNote('');
    setDraftAccountId(defaultAccount?.id ?? '');
    setDraftModal({ visible: true, monthKey, categoryId, categoryName: cat?.name ?? '', rowType });
  };

  const handleCreateDraft = async () => {
    if (!draftModal || !user) return;
    const num = parseFloat(draftAmount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant.');
      return;
    }
    if (!draftAccountId) {
      Alert.alert('Compte requis', 'Aucun compte courant trouvé.');
      return;
    }
    const finalAmount = draftModal.rowType === 'expense' ? -Math.abs(num) : Math.abs(num);
    const [y, mo] = draftModal.monthKey.split('-').map(Number);
    const dateISO = `${y}-${String(mo).padStart(2, '0')}-01`;
    try {
      await addTransaction.mutateAsync({
        account_id: draftAccountId,
        category_id: draftModal.categoryId,
        amount: finalAmount,
        date: dateISO,
        note: draftNote || undefined,
        is_draft: true,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
      });
      setDraftModal(null);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de créer le brouillon.');
    }
  };

  const handleCreateVirementDraft = async () => {
    if (!virementDraftModal || !user) return;
    const num = parseFloat(virementAmount.replace(',', '.'));
    if (Number.isNaN(num) || num === 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant.');
      return;
    }
    if (!virementDestAccountId) {
      Alert.alert('Compte requis', 'Sélectionnez un compte de destination.');
      return;
    }
    const checkingAccount = accounts.find((a) => a.type === 'checking');
    if (!checkingAccount) {
      Alert.alert('Compte courant introuvable', 'Aucun compte courant trouvé.');
      return;
    }
    const [y, mo] = virementDraftModal.monthKey.split('-').map(Number);
    const dateISO = `${y}-${String(mo).padStart(2, '0')}-01`;
    try {
      await addTransaction.mutateAsync({
        account_id: checkingAccount.id,
        linked_account_id: virementDestAccountId,
        category_id: null,
        amount: -Math.abs(num),
        date: dateISO,
        note: virementNote || undefined,
        is_draft: true,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
      });
      setVirementDraftModal(null);
      setVirementAmount('');
      setVirementNote('');
      setVirementDestAccountId('');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de créer le virement.');
    }
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
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.subtitleRow}>
          <Text style={[styles.subtitle, { flex: 1, marginBottom: 0 }]}>Alimenté par vos transactions et récurrences. Appuyez sur un montant pour voir le détail.</Text>
          <TouchableOpacity style={[styles.simpleToggle, simplified && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]} onPress={toggleSimplified} activeOpacity={0.7} accessibilityRole="button">
            <Ionicons name={simplified ? 'contract-outline' : 'expand-outline'} size={14} color={simplified ? COLORS.bg : COLORS.emerald} />
            <Text style={[styles.simpleToggleText, simplified && { color: COLORS.bg }]}>{simplified ? 'Simplifié' : 'Détaillé'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.controls}>
          <View style={styles.navRow} ref={navRowRef}>
            <TouchableOpacity style={styles.navArrow} onPress={() => setMonthOffset((o) => o - 1)} accessibilityRole="button">
              <Ionicons name="chevron-back" size={22} color="#94a3b8" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navLabel} onPress={() => setMonthOffset(-1)} accessibilityRole="button">
              <Text style={styles.navLabelText}>{rangeLabel}</Text>
              {monthOffset !== -1 && <Text style={styles.navLabelHint}>Appuyer pour revenir</Text>}
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
            ref={scrollOuterRef}
            style={styles.scrollOuter}
            contentContainerStyle={styles.scrollOuterContent}
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
              style={styles.scrollInner}
              contentContainerStyle={styles.scrollInnerContent}
              nestedScrollEnabled={true}
            >
            <View style={styles.tableWrap} ref={tableRef}>
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
              {(simplified ? planData.rows.filter((r: any) => !r.isChild) : planData.rows).map((row, idx) => (
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
                        row.isProjectRow && styles.cellLabelProject,
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
                    // Mois antérieurs = réalisé → recettes vertes / dépenses rouges.
                    // Mois en cours + futurs = projection → neutre (blanc), sauf brouillon (orange) / prévisionnel (gris).
                    const isPastMonth = m.key < getMonthKey(currentYear, currentMonth);

                    return (
                      <TouchableOpacity
                        key={m.key}
                        style={[
                          styles.cell,
                          styles.cellNum,
                          m.key === highlightMonthKey && styles.cellNumCurrent,
                          { width: colWidth },
                        ]}
                        onPress={() => {
                          const isFuture = m.key > getMonthKey(currentYear, currentMonth);
                          if (isFuture && row.mouvementType) {
                            const destAccounts = accounts.filter((a) => a.type === (row.mouvementType === 'epargne' ? 'savings' : 'investment'));
                            setVirementDestAccountId(destAccounts[0]?.id ?? '');
                            setVirementAmount('');
                            setVirementNote('');
                            setVirementDraftModal({ visible: true, monthKey: m.key, mouvementType: row.mouvementType });
                          } else if (row.categoryId && !row.isTotalLine && !row.isSectionHeader) {
                            if (isFuture && row.isChild && (row.type === 'expense' || row.type === 'income')) {
                              const allTx = planData.txByMonthCategory?.[row.categoryId]?.[m.key] ?? [];
                              const existingDrafts = allTx.filter((t) => !!(t as any).is_draft);
                              if (allTx.length > 0) {
                                setDraftChoiceModal({ visible: true, monthKey: m.key, categoryId: row.categoryId, rowType: row.type as 'income' | 'expense', existingDrafts });
                              } else {
                                openDraftModal(m.key, row.categoryId, row.type as 'income' | 'expense');
                              }
                            } else if (val === 0) {
                              goToTransactions(m.key, row.categoryId);
                            } else {
                              showCellMenu(m.key, row.categoryId, val);
                            }
                          } else if (row.isRegulRow) {
                            router.push(`/(tabs)/transactions?focusMonth=${m.key}&filterType=regul&singleMonth=1` as any);
                          } else if (row.isSectionHeader && row.type === 'mouvement') {
                            router.push(`/(tabs)/transactions?focusMonth=${m.key}&filterType=mouvements&singleMonth=1` as any);
                          } else if (row.isSectionHeader && row.type === 'income') {
                            router.push(`/(tabs)/transactions?focusMonth=${m.key}&filterType=recettes&singleMonth=1` as any);
                          } else if (row.isSectionHeader && row.type === 'expense') {
                            router.push(`/(tabs)/transactions?focusMonth=${m.key}&filterType=depenses&singleMonth=1` as any);
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
                            isPastMonth && row.type === 'income' && styles.cellNumPositive,
                            isPastMonth && row.type === 'expense' && styles.cellNumNegative,
                            isBalance && (isPos ? styles.cellNumPositive : styles.cellNumNegative),
                            row.type === 'mouvement' && !row.isSectionHeader && (isPos ? styles.cellNumPositive : styles.cellNumNegative),
                            row.isParentCategory && styles.cellNumTextParentCategory,
                            row.isSectionHeader && styles.cellNumTextSectionTotal,
                            row.isSectionHeader && row.type === 'mouvement' && styles.cellNumSectionMouvements,
                            row.hasForecast?.[m.key] && styles.cellNumForecast,
                            row.hasDraft?.[m.key] && styles.cellNumDraft,
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
            {/* Légende — dans le scroll, sous le tableau */}
            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.green }]} />
                <Text style={styles.legendText}>Recette / solde positif</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.danger }]} />
                <Text style={styles.legendText}>Dépense / solde négatif</Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={styles.legendSampleOrange}>123</Text>
                <Text style={styles.legendText}>Brouillon (manuel)</Text>
              </View>
              <View style={styles.legendItem}>
                <Text style={styles.legendSampleGrey}>123</Text>
                <Text style={styles.legendText}>Prévisionnel (projet)</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.balance }]} />
                <Text style={styles.legendText}>Solde courant</Text>
              </View>
            </View>
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
                openEditModal(menuModalState.monthKey || '', menuModalState.categoryId ?? null, menuModalState.value || 0);
              }}
            >
              <Ionicons name="pencil" size={20} color="#34d399" />
              <Text style={styles.menuOptionText}>Modifier montant</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                setMenuModalState({ visible: false });
                goToTransactions(menuModalState.monthKey || '', menuModalState.categoryId ?? null);
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

      {/* Draft Choice Modal */}
      <Modal
        visible={!!draftChoiceModal?.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setDraftChoiceModal(null)}
      >
        <TouchableOpacity style={styles.menuOverlay} onPress={() => setDraftChoiceModal(null)} activeOpacity={1}>
          <TouchableOpacity style={styles.menuContainer} onPress={() => {}} activeOpacity={1}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuTitle}>Transaction prévisionnelle</Text>
              <TouchableOpacity onPress={() => setDraftChoiceModal(null)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const c = draftChoiceModal;
                setDraftChoiceModal(null);
                if (c) goToTransactions(c.monthKey, c.categoryId);
              }}
            >
              <Ionicons name="eye-outline" size={20} color="#60a5fa" />
              <Text style={styles.menuOptionText}>Voir les transactions</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                const c = draftChoiceModal;
                setDraftChoiceModal(null);
                if (c) openDraftModal(c.monthKey, c.categoryId, c.rowType);
              }}
            >
              <Ionicons name="add-circle-outline" size={20} color="#34d399" />
              <Text style={styles.menuOptionText}>Créer une nouvelle</Text>
            </TouchableOpacity>
            {draftChoiceModal?.existingDrafts.map((draft) => (
              <TouchableOpacity
                key={draft.id}
                style={styles.menuOption}
                onPress={() => {
                  setDraftChoiceModal(null);
                  router.push(`/(tabs)/transactions/edit/${draft.id}` as any);
                }}
              >
                <Ionicons name="create-outline" size={20} color="#f59e0b" />
                <Text style={styles.menuOptionText} numberOfLines={1}>
                  Modifier · {draft.note || Math.abs(Number(draft.amount)).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' ' + CURRENCY_SYMBOL}
                </Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Draft Creation Modal */}
      <Modal
        visible={!!draftModal?.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDraftModal(null)}
      >
        <TouchableOpacity style={styles.menuOverlay} onPress={() => setDraftModal(null)} activeOpacity={1}>
          <TouchableOpacity style={styles.draftModalContainer} onPress={() => {}} activeOpacity={1}>
            <View style={styles.menuHeader}>
              <View>
                <Text style={styles.menuTitle}>Transaction prévisionnelle</Text>
                {draftModal && (
                  <Text style={styles.draftModalSub}>
                    {draftModal.categoryName} · {new Date(draftModal.monthKey + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setDraftModal(null)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.draftModalLabel}>Montant ({CURRENCY_SYMBOL})</Text>
            <TextInput
              style={styles.draftModalInput}
              value={draftAmount}
              onChangeText={setDraftAmount}
              placeholder="0,00"
              placeholderTextColor="#64748b"
              keyboardType="decimal-pad"
            />

            <Text style={styles.draftModalLabel}>Libellé (optionnel)</Text>
            <TextInput
              style={styles.draftModalInput}
              value={draftNote}
              onChangeText={setDraftNote}
              placeholder="Ex. Vacances, Prime..."
              placeholderTextColor="#64748b"
            />

            <Text style={styles.draftModalLabel}>Compte</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {accounts.filter(a => a.type === 'checking').map((acc) => (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.draftAccountChip, draftAccountId === acc.id && styles.draftAccountChipActive]}
                  onPress={() => setDraftAccountId(acc.id)}
                >
                  <Text style={[styles.draftAccountChipText, draftAccountId === acc.id && styles.draftAccountChipTextActive]}>
                    {acc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.draftSubmitBtn, addTransaction.isPending && { opacity: 0.6 }]}
              onPress={handleCreateDraft}
              disabled={addTransaction.isPending}
            >
              <Ionicons name="time-outline" size={18} color="#f59e0b" style={{ marginRight: 8 }} />
              <Text style={styles.draftSubmitLabel}>Enregistrer en brouillon</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Virement Draft Modal (Épargne / Investissements) */}
      <Modal
        visible={!!virementDraftModal?.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVirementDraftModal(null)}
      >
        <TouchableOpacity style={styles.menuOverlay} onPress={() => setVirementDraftModal(null)} activeOpacity={1}>
          <TouchableOpacity style={styles.draftModalContainer} onPress={() => {}} activeOpacity={1}>
            <View style={styles.menuHeader}>
              <View>
                <Text style={styles.menuTitle}>Virement prévisionnel</Text>
                {virementDraftModal && (
                  <Text style={styles.draftModalSub}>
                    {virementDraftModal.mouvementType === 'epargne' ? 'Épargne' : 'Investissements'} · {new Date(virementDraftModal.monthKey + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setVirementDraftModal(null)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.draftModalLabel}>Montant ({CURRENCY_SYMBOL})</Text>
            <TextInput
              style={styles.draftModalInput}
              value={virementAmount}
              onChangeText={setVirementAmount}
              placeholder="0,00"
              placeholderTextColor="#64748b"
              keyboardType="decimal-pad"
            />

            <Text style={styles.draftModalLabel}>Libellé (optionnel)</Text>
            <TextInput
              style={styles.draftModalInput}
              value={virementNote}
              onChangeText={setVirementNote}
              placeholder="Ex. Loyer, Épargne mensuelle..."
              placeholderTextColor="#64748b"
            />

            <Text style={styles.draftModalLabel}>Compte de destination</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {accounts
                .filter((a) => a.type === (virementDraftModal?.mouvementType === 'epargne' ? 'savings' : 'investment'))
                .map((acc) => (
                  <TouchableOpacity
                    key={acc.id}
                    style={[styles.draftAccountChip, virementDestAccountId === acc.id && styles.draftAccountChipActive]}
                    onPress={() => setVirementDestAccountId(acc.id)}
                  >
                    <Text style={[styles.draftAccountChipText, virementDestAccountId === acc.id && styles.draftAccountChipTextActive]}>
                      {acc.name}
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.draftSubmitBtn, addTransaction.isPending && { opacity: 0.6 }]}
              onPress={handleCreateVirementDraft}
              disabled={addTransaction.isPending}
            >
              <Ionicons name="swap-horizontal-outline" size={18} color="#f59e0b" style={{ marginRight: 8 }} />
              <Text style={styles.draftSubmitLabel}>Enregistrer le virement</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <GuideOverlay
        visible={guide.visible}
        steps={TRESO_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(TRESO_GUIDE.length)}
        onSkip={guide.skip}
        scrollRef={scrollOuterRef}
        screenTitle="Plan de trésorerie"
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 12 },
  subtitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  simpleToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '14' },
  simpleToggleText: { fontSize: 12, fontWeight: '700', color: c.emerald },
  controls: { marginBottom: 12 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { padding: 8 },
  navLabel: { flex: 1, alignItems: 'center' },
  navLabelText: { fontSize: 15, fontWeight: '700', color: c.text },
  navLabelHint: { fontSize: 11, color: c.emerald, marginTop: 2 },
  hint: { color: c.textSecondary },
  scrollOuter: { flex: 1 },
  scrollOuterContent: { paddingBottom: 8 },
  scrollInner: {},
  scrollInnerContent: {},
  scroll: { flex: 1 },
  tableWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: c.card,
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
  tableRowIncome: { backgroundColor: 'rgba(0, 182, 122, 0.05)' },
  tableRowExpense: { backgroundColor: 'rgba(255, 59, 48, 0.04)' },
  tableRowBalance: {
    backgroundColor: c.balance + '1A',
    borderLeftWidth: 3,
    borderLeftColor: c.balance,
    paddingVertical: 10,
  },
  tableRowHighlight: { backgroundColor: 'rgba(0, 182, 122, 0.05)' },
  tableRowBlockStart: { marginTop: 20 },
  tableRowSectionHeader: {
    paddingVertical: 12,
  },
  tableRowSectionRecettes: {
    backgroundColor: 'rgba(0, 182, 122, 0.10)',
    borderLeftWidth: 3,
    borderLeftColor: c.emerald,
  },
  tableRowSectionDepenses: {
    backgroundColor: 'rgba(255, 59, 48, 0.10)',
    borderLeftWidth: 3,
    borderLeftColor: c.danger,
  },
  tableRowSectionMouvements: {
    backgroundColor: 'rgba(142, 148, 154, 0.12)',
    borderLeftWidth: 3,
    borderLeftColor: '#8E949A',
    paddingVertical: 12,
  },
  tableRowMouvement: { backgroundColor: 'rgba(142, 148, 154, 0.05)' },
  tableRowParentCategory: {
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(148, 163, 184, 0.18)',
  },
  tableRowParentCategoryIncome: { backgroundColor: 'rgba(52, 211, 153, 0.11)' },
  tableRowParentCategoryExpense: { backgroundColor: 'rgba(248, 113, 113, 0.09)' },
  tableRowTotalRecettes: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(0, 182, 122, 0.3)',
    backgroundColor: 'rgba(0, 182, 122, 0.08)',
    paddingVertical: 12,
  },
  tableRowTotalDepenses: {
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 59, 48, 0.3)',
    backgroundColor: 'rgba(255, 59, 48, 0.08)',
    paddingVertical: 12,
  },
  cell: { paddingHorizontal: 10, justifyContent: 'center' },
  cellLabel: {},
  cellLabelIndent: { paddingLeft: 24 },
  cellNum: { alignItems: 'flex-end', paddingRight: 14 },
  cellNumCurrent: { paddingRight: 18 },
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
    backgroundColor: c.currentMonth,
    borderRadius: 10,
  },
  headerLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  headerLabelCurrent: { color: c.emerald, fontWeight: '700' },
  cellLabelText: { fontSize: 14, color: c.text, fontWeight: '500' },
  cellLabelChild: { fontSize: 13, color: c.textSecondary },
  cellLabelParentCategory: { fontWeight: '600', color: c.text },
  cellLabelSectionRecettes: { fontSize: 12, fontWeight: '800', color: c.emerald, letterSpacing: 1 },
  cellLabelSectionDepenses: { fontSize: 12, fontWeight: '800', color: c.danger, letterSpacing: 1 },
  cellLabelSectionMouvements: { fontSize: 12, fontWeight: '800', color: '#94a3b8', letterSpacing: 1 },
  cellLabelMouvement: { fontSize: 13, color: '#94a3b8' },
  cellLabelRegul: { fontSize: 13, color: '#64748b', fontStyle: 'italic' },
  cellLabelProject: { fontSize: 13, color: '#60a5fa', fontStyle: 'italic' },
  cellLabelBalance: { fontWeight: '700', color: c.balance },
  cellLabelTotalRecettes: { fontSize: 12, fontWeight: '800', color: c.emerald, letterSpacing: 0.8 },
  cellLabelTotalDepenses: { fontSize: 12, fontWeight: '800', color: c.danger, letterSpacing: 0.8 },
  cellNumText: { fontSize: 13, color: c.text },
  cellNumTextParentCategory: { fontWeight: '700' },
  cellNumTextSectionTotal: { fontSize: 15, fontWeight: '800' },
  cellNumPositive: { color: c.green, fontWeight: '600' },
  cellNumNegative: { color: c.danger, fontWeight: '600' },
  cellNumSectionMouvements: { color: '#8E949A' },
  cellNumDraft: { color: '#FF9500', fontStyle: 'italic' },
  cellNumForecast: { color: '#8E949A', fontStyle: 'italic' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: c.cardBorder },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: c.textSecondary },
  legendSampleOrange: { fontSize: 11, fontStyle: 'italic', color: '#f97316', fontWeight: '600' },
  legendSampleGrey: { fontSize: 11, fontStyle: 'italic', color: '#64748b', fontWeight: '500' },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    backgroundColor: c.cardSolid,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    borderBottomColor: c.cardBorder,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: c.text,
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
    color: c.text,
  },
  draftModalContainer: {
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.orange + '44',
    width: '90%',
    maxWidth: 400,
    padding: 20,
  },
  draftModalSub: { fontSize: 12, color: '#f59e0b', marginTop: 2 },
  draftCategoryBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f59e0b18', borderWidth: 1, borderColor: '#f59e0b44', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  draftCategoryBadgeText: { fontSize: 14, fontWeight: '600', color: '#f59e0b' },
  draftModalLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  draftModalInput: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.text,
    marginBottom: 16,
  },
  draftAccountChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginRight: 8,
  },
  draftAccountChipActive: { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' },
  draftAccountChipText: { fontSize: 13, color: c.text },
  draftAccountChipTextActive: { color: '#f59e0b', fontWeight: '600' },
  draftSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#f59e0b11',
  },
  draftSubmitLabel: { fontSize: 15, fontWeight: '700', color: '#f59e0b' },
});
}
