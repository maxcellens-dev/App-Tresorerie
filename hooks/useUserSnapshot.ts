// Construit l'instantané financier ANONYMISÉ d'un utilisateur (le même que celui envoyé à l'IA).
// Réutilisé par la page Conseils IA (utilisateur courant) ET par l'onglet Snapshot admin (user choisi,
// lecture autorisée par les policies admin — migrations 101/102/104/110/119).
//
// V2 : en plus des agrégats pilotage, on dérive des transactions (500 dernières) l'HISTORIQUE des mois
// COMPLETS, les moyennes/tendances par grande catégorie, les charges & revenus RÉCURRENTS actifs et les
// grosses dépenses ponctuelles récentes — toujours anonymisé (catégories + montants, jamais de libellé).
//
// PÉRIMÈTRE du train de vie (historique, tendances, ponctuelles) : comptes COURANTS uniquement, hors
// virements internes ET hors régularisations de solde (regul_target). Sinon les mouvements des comptes
// épargne/investissement (grosses régularisations de valorisation, dépôts) gonflent les « revenus »
// et faussent totalement les soldes mensuels vus par l'IA.
import { useMemo } from 'react';
import { usePilotageData } from './usePilotageData';
import { useTransactions } from './useTransactions';
import { useTransactionMonthOverrides } from './useTransactionMonthOverrides';
import { useCategories } from './useCategories';
import { useCredits } from './useCredits';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import { buildSnapshot, type SnapshotMonth, type SnapshotCategoryTrend, type SnapshotRecurring, type SnapshotOneOff } from '../lib/aiSnapshot';
import { CURRENCY_SYMBOL } from '../lib/currency';

export function useUserSnapshot(userId: string | undefined): { text: string | null; ready: boolean; build: () => string } {
  const { data: pilotage } = usePilotageData(userId);
  const { data: transactions } = useTransactions(userId);
  const { data: monthOverrides } = useTransactionMonthOverrides(userId);
  const { data: categories } = useCategories(userId);
  const { data: credits } = useCredits(userId);
  const { data: allAccounts } = useAllAccounts(userId);
  const { data: projects } = useProjects(userId);

  const catById = useMemo(() => {
    const m = new Map<string, { name: string; parent_id?: string | null; is_variable?: boolean }>();
    for (const cat of categories ?? []) m.set(cat.id, { name: cat.name, parent_id: cat.parent_id, is_variable: (cat as any).is_variable });
    return m;
  }, [categories]);
  const grandCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    return cat.parent_id ? (catById.get(cat.parent_id)?.name ?? cat.name) : cat.name;
  };
  /** « Parent > Sous-catégorie » (taxonomie seule, jamais de libellé) pour les lignes récurrentes. */
  const fullCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    const parent = cat.parent_id ? catById.get(cat.parent_id)?.name : null;
    return parent && parent !== cat.name ? `${parent} > ${cat.name}` : cat.name;
  };

  // Transaction « réelle » à considérer (ni virement interne, ni brouillon, ni régularisation de solde).
  const isReal = (t: any) => !t.linked_account_id && !t.is_draft && t.regul_target == null;
  // Train de vie = flux des comptes COURANTS uniquement (les mouvements épargne/invest ne sont ni des
  // revenus ni des dépenses de vie courante).
  const isCashflow = (t: any) => isReal(t) && t.account?.type === 'checking';
  const isRecurringTpl = (t: any) => Boolean(t.is_recurring) && Boolean(t.recurrence_rule);

  // Montant EFFECTIF d'un template récurrent : l'override mensuel le plus récent (≤ mois courant, sinon
  // le dernier connu) prime sur le montant de base — sinon on annonce à l'IA des montants obsolètes.
  const effectiveAmount = useMemo(() => {
    const best = new Map<string, { ym: number; amount: number }>();
    const curYm = (() => { const t = todayISO(); return Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)); })();
    for (const o of monthOverrides ?? []) {
      if (o.override_amount == null) continue;
      const ym = Number(o.year) * 12 + Number(o.month);
      const prev = best.get(o.transaction_id);
      // Priorité aux overrides passés/courants les plus récents ; un override futur ne sert que s'il n'y a rien d'autre.
      const rank = (v: number) => (v <= curYm ? v : -v);
      if (!prev || rank(ym) > rank(prev.ym)) best.set(o.transaction_id, { ym, amount: o.override_amount });
    }
    return (t: any): number => best.get(t.id)?.amount ?? Number(t.amount);
  }, [monthOverrides]);

  const expensesByCategory = useMemo(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const acc: Record<string, number> = {};
    for (const t of transactions) {
      if (!isCashflow(t)) continue;
      if (Number(t.amount) >= 0) continue;
      if (t.date.slice(0, 7) !== curYm) continue;
      const name = grandCat(t.category_id);
      acc[name] = (acc[name] ?? 0) + Math.abs(Number(t.amount));
    }
    return Object.entries(acc).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [transactions, catById]);

  // Mois COMPLETS réellement couverts par les données chargées (500 dernières transactions) : on ignore
  // le mois le plus ancien (potentiellement tronqué par la limite) et le mois en cours (partiel).
  const completeMonths = useMemo(() => {
    if (!transactions?.length) return [] as string[];
    const curYm = todayISO().slice(0, 7);
    const oldestYm = transactions[transactions.length - 1].date.slice(0, 7);
    const months = [...new Set(transactions.map((t) => t.date.slice(0, 7)))]
      .filter((ym) => ym < curYm && ym > oldestYm)
      .sort();
    return months.slice(-6);
  }, [transactions]);

  const history = useMemo<SnapshotMonth[]>(() => {
    if (!transactions) return [];
    const by: Record<string, SnapshotMonth> = {};
    for (const ym of completeMonths) by[ym] = { ym, income: 0, expenses: 0, fixed: 0, variable: 0 };
    for (const t of transactions) {
      const ym = t.date.slice(0, 7);
      const h = by[ym];
      if (!h || !isCashflow(t)) continue;
      const amt = Number(t.amount);
      if (amt > 0) { h.income += amt; continue; }
      const abs = Math.abs(amt);
      h.expenses += abs;
      // Fixe = récurrente OU catégorie marquée non-variable ; sinon variable.
      const cat = t.category_id ? catById.get(t.category_id) : null;
      if (isRecurringTpl(t) || cat?.is_variable === false) h.fixed += abs; else h.variable += abs;
    }
    return completeMonths.map((ym) => by[ym]);
  }, [transactions, completeMonths, catById]);

  const categoryTrends = useMemo<SnapshotCategoryTrend[]>(() => {
    if (!transactions || !completeMonths.length) return [];
    const last3 = completeMonths.slice(-3);
    const lastYm = completeMonths[completeMonths.length - 1];
    const sum3: Record<string, number> = {};
    const last: Record<string, number> = {};
    for (const t of transactions) {
      if (!isCashflow(t) || Number(t.amount) >= 0) continue;
      const ym = t.date.slice(0, 7);
      if (!last3.includes(ym)) continue;
      const name = grandCat(t.category_id);
      const abs = Math.abs(Number(t.amount));
      sum3[name] = (sum3[name] ?? 0) + abs;
      if (ym === lastYm) last[name] = (last[name] ?? 0) + abs;
    }
    return Object.entries(sum3)
      .map(([name, total]) => ({ name, avg3m: total / last3.length, lastMonth: last[name] ?? 0 }))
      .filter((x) => x.avg3m >= 5)
      .sort((a, b) => b.avg3m - a.avg3m);
  }, [transactions, completeMonths, catById]);

  // Récurrentes ACTIVES (templates non terminés), dédupliquées par catégorie+montant+fréquence.
  const recurrings = useMemo(() => {
    const today = todayISO();
    const seen = new Set<string>();
    const expenses: SnapshotRecurring[] = [];
    const incomes: SnapshotRecurring[] = [];
    for (const t of transactions ?? []) {
      if (!isReal(t) || !isRecurringTpl(t)) continue;
      if (t.recurrence_end_date && t.recurrence_end_date < today) continue;
      // Montant courant réel (override mensuel s'il existe — les templates gardent souvent un vieux montant).
      const amt = effectiveAmount(t);
      const key = `${t.category_id ?? 'x'}|${Math.round(Math.abs(amt) * 100)}|${t.recurrence_rule}`;
      if (seen.has(key)) continue; // transactions triées desc → on garde l'occurrence la plus récente
      seen.add(key);
      const row = { category: fullCat(t.category_id), amount: Math.abs(amt), rule: String(t.recurrence_rule) };
      (amt < 0 ? expenses : incomes).push(row);
    }
    expenses.sort((a, b) => b.amount - a.amount);
    incomes.sort((a, b) => b.amount - a.amount);
    return { expenses, incomes };
  }, [transactions, catById, effectiveAmount]);

  // Grosses dépenses PONCTUELLES récentes (dernier mois complet + mois en cours, non récurrentes).
  const topOneOff = useMemo<SnapshotOneOff[]>(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const lastYm = completeMonths[completeMonths.length - 1];
    const out: SnapshotOneOff[] = [];
    for (const t of transactions) {
      if (!isCashflow(t) || isRecurringTpl(t) || Number(t.amount) >= 0) continue;
      const ym = t.date.slice(0, 7);
      if (ym !== curYm && ym !== lastYm) continue;
      const abs = Math.abs(Number(t.amount));
      if (abs < 50) continue;
      out.push({ date: t.date, category: grandCat(t.category_id), amount: abs });
    }
    return out.sort((a, b) => b.amount - a.amount).slice(0, 8);
  }, [transactions, completeMonths, catById]);

  const creditsSummary = useMemo(() => {
    const today = todayISO();
    const acctById: Record<string, any> = {};
    for (const a of allAccounts ?? []) acctById[a.id] = a;
    return (credits ?? []).filter((cr) => cr.is_active && !cr.is_simulation).map((cr) => {
      const a = computeAmortization({ ...cr });
      const last = a.schedule[a.schedule.length - 1];
      const acc = cr.account_id ? acctById[cr.account_id] : null;
      const impactPct = acc && acc._impact_pct != null ? acc._impact_pct : 100;
      return {
        principal: cr.principal, ratePct: cr.rate_annual, crd: a.crdAtDate(today),
        endYM: last ? last.date.slice(0, 7) : null,
        remainingMonths: a.schedule.filter((r) => r.date > today).length,
        impactPct, monthly: a.monthlyWithInsurance * (impactPct / 100),
      };
    });
  }, [credits, allAccounts]);

  const projectsSummary = useMemo(() => {
    const byId: Record<string, any> = {};
    for (const pr of projects ?? []) byId[pr.id] = pr;
    return (pilotage?.projects_with_progress ?? []).map((pr) => {
      const src = byId[pr.id];
      return {
        target: pr.target_amount, monthly: pr.monthly_allocation, progressPct: pr.progress_percentage,
        status: pr.status,
        startISO: (src?.first_payment_date || src?.created_at || '').slice(0, 10) || null,
      };
    });
  }, [pilotage, projects]);

  const build = () => {
    const now = new Date();
    return buildSnapshot({
      currencySymbol: CURRENCY_SYMBOL,
      today: todayISO(),
      dayOfMonth: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      pilotage: pilotage!,
      expensesByCategory,
      credits: creditsSummary,
      projects: projectsSummary,
      history,
      categoryTrends,
      recurringExpenses: recurrings.expenses,
      recurringIncomes: recurrings.incomes,
      topOneOff,
    });
  };

  const text = useMemo(
    () => (pilotage ? build() : null),
    [pilotage, expensesByCategory, creditsSummary, projectsSummary, history, categoryTrends, recurrings, topOneOff],
  );
  return { text, ready: !!pilotage, build };
}
