// Construit l'instantané financier ANONYMISÉ d'un utilisateur (le même que celui envoyé à l'IA).
// Réutilisé par la page Conseils IA (utilisateur courant) ET par l'onglet Snapshot admin (user choisi,
// lecture autorisée par les policies admin — migrations 101/102/104/110/119).
import { useMemo } from 'react';
import { usePilotageData } from './usePilotageData';
import { useTransactions } from './useTransactions';
import { useCategories } from './useCategories';
import { useCredits } from './useCredits';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import { buildSnapshot } from '../lib/aiSnapshot';
import { CURRENCY_SYMBOL } from '../lib/currency';

export function useUserSnapshot(userId: string | undefined): { text: string | null; ready: boolean; build: () => string } {
  const { data: pilotage } = usePilotageData(userId);
  const { data: transactions } = useTransactions(userId);
  const { data: categories } = useCategories(userId);
  const { data: credits } = useCredits(userId);
  const { data: allAccounts } = useAllAccounts(userId);
  const { data: projects } = useProjects(userId);

  const catById = useMemo(() => {
    const m = new Map<string, { name: string; parent_id?: string | null }>();
    for (const cat of categories ?? []) m.set(cat.id, { name: cat.name, parent_id: cat.parent_id });
    return m;
  }, [categories]);
  const grandCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    return cat.parent_id ? (catById.get(cat.parent_id)?.name ?? cat.name) : cat.name;
  };

  const expensesByCategory = useMemo(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const acc: Record<string, number> = {};
    for (const t of transactions) {
      if (t.linked_account_id || t.is_draft) continue;
      if (Number(t.amount) >= 0) continue;
      if (t.date.slice(0, 7) !== curYm) continue;
      const name = grandCat(t.category_id);
      acc[name] = (acc[name] ?? 0) + Math.abs(Number(t.amount));
    }
    return Object.entries(acc).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [transactions, catById]);

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
    });
  };

  const text = useMemo(() => (pilotage ? build() : null), [pilotage, expensesByCategory, creditsSummary, projectsSummary]);
  return { text, ready: !!pilotage, build };
}
