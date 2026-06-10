import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { weeklyVariableFromQ9, WEEKS_PER_MONTH } from '../lib/financialProfileEngine';
import type { Account, Transaction, Project, Objective, Profile, Category, FinancialProfile, RecurrenceRule, TransactionWithDetails } from '../types/database';

export interface TransactionWithCategory extends TransactionWithDetails {
  category?: { name: string; type: string; is_variable?: boolean };
}

export interface PilotageData {
  // Step 1: Safe to Spend
  safe_to_spend: number;
  current_checking_balance: number;
  remaining_fixed_expenses: number;
  committed_allocations: number;
  same_account_reserved: number;
  monthly_commitments: number;

  // Revenu attendu + creux + garde-fou projection (modèle « trésorerie adaptative »)
  month_income_remaining: number;        // recettes à venir d'ici la prochaine rentrée (affichage)
  expected_monthly_income: number;       // revenu mensuel détecté (explicite ou inféré)
  expected_income_source: 'explicit' | 'inferred' | 'none';
  expected_income_confidence: number;    // 0..1
  projection_min_buffer: number;         // plus bas du solde courant projeté sur N mois
  projection_in_danger: boolean;         // true → frein « Conserver »
  prudence: number;                      // 0..1 (1 = très prudent)

  // Suivi des engagements du mois en cours
  monthly_savings_planned: number;       // virements récurrents épargne + projets (total du mois, affichage)
  monthly_savings_remaining: number;     // part non encore exécutée → pour le budget libre
  monthly_invest_planned: number;        // virements récurrents invest (total du mois, affichage)
  monthly_invest_remaining: number;      // part non encore exécutée → pour le budget libre
  // Virements épargne/invest du mois (TOUS, via linked_account_id, projets inclus) — Suivi
  month_savings_total: number;           // épargne : tous virements du mois (affichage)
  month_savings_future: number;          // épargne : part future (déduite du budget)
  month_invest_total: number;            // investissement : tous virements du mois (affichage)
  month_invest_future: number;           // investissement : part future (déduite du budget)
  real_savings_excl_projects: number;    // épargne réelle ce mois HORS projets (pour budget reco)
  real_invest: number;                   // invest réel ce mois (pour budget reco)
  monthly_reserve_planned: number;       // total réservé (projets même compte + brouillons conservés)
  month_expenses_total: number;          // total dépenses du mois (passées + à venir, hors virements) — info
  month_expenses_past: number;           // dépenses validées déjà passées ce mois (déjà dans le solde) — info
  month_expenses_remaining: number;      // dépenses à venir ce mois (date > aujourd'hui) → déduites du budget
  committed_objective_monthly: number;   // engagements objectifs actifs (cible annuelle ÷ 12)
  reserved_by_project: Array<{           // détail du Réservé par projet (pour le modal)
    id: string; name: string; total: number;
    source_account_id: string | null; linked_account_id: string | null;
  }>;

  // Step 2: Variable Expense Trend
  avg_variable_expenses_3m: number;
  current_month_variable: number;
  variable_trend_percentage: number;

  // Enveloppe des dépenses variables (estimation dynamique)
  variable_envelope_initial: number;    // enveloppe estimée du mois (historique ou onboarding)
  variable_envelope_spent: number;      // dépenses variables déjà engagées ce mois
  variable_envelope_remaining: number;  // = max(0, initial − spent) : reste à déduire du « Reste du mois »
  variable_envelope_source: 'history' | 'onboarding' | 'none';
  variable_envelope_months_used: number; // nb de mois d'historique utilisés (si source = history)

  // Step 3: Surplus & Recommendation
  projected_surplus: number;
  recommendation: 'À ÉPARGNER' | 'À INVESTIR';

  // Profile and allocation preferences
  financial_profile?: FinancialProfile;
  allocation_save_percent?: number;
  allocation_invest_percent?: number;
  allocation_enjoy_percent?: number;
  allocation_keep_percent?: number;
  initial_onboarding_completed: boolean;

  // Step 4: Projects
  available_savings: number;
  projects_with_progress: Array<{
    id: string;
    name: string;
    target_amount: number;
    monthly_allocation: number;
    progress_percentage: number;
    status: string;
  }>;
  global_projects_percentage: number;

  // Step 5: Objectives
  objectives_with_progress: Array<{
    id: string;
    name: string;
    target_yearly_amount: number;
    current_year_invested: number;
    progress_percentage: number;
    account_name?: string;
    account_type?: string;
    status: string;
  }>;
  global_objectives_percentage: number;

  // Account Aggregations
  total_checking: number;
  total_savings: number;
  total_invested: number;

  // Safety Thresholds
  /** @deprecated */
  safety_margin_percent: number;
  /** Montant minimum conservé sur les comptes courants (€) — remplace safety_margin_percent */
  safety_margin_amount: number;
  safety_threshold_min: number;
  safety_threshold_optimal: number;
  safety_threshold_comfort: number;
  current_savings: number;
}

// Fetch multiple data types
async function fetchPilotageData(profileId: string): Promise<{
  profile: Profile | null;
  accounts: Account[];
  transactions: TransactionWithCategory[];
  questionnaireAnswers: any | null;
  projects: Project[];
  objectives: Objective[];
}> {
  if (!supabase || !profileId) throw new Error('Not authenticated');

  const [profileRes, accountsRes, transactionsRes, projectsRes, objectivesRes, qaRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase.from('accounts').select('*').eq('profile_id', profileId),
    supabase.from('transactions').select('*, account:accounts!account_id(name), category:categories!category_id(*)').eq('profile_id', profileId),
    supabase.from('projects').select('*').eq('profile_id', profileId),
    supabase.from('objectives').select('*').eq('profile_id', profileId),
    supabase.from('user_questionnaire_answers').select('*').eq('user_id', profileId).maybeSingle(),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (accountsRes.error) throw accountsRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (objectivesRes.error) throw objectivesRes.error;
  if (qaRes.error) throw qaRes.error;

  return {
    profile: (profileRes.data as Profile) || null,
    accounts: (accountsRes.data ?? []) as Account[],
    transactions: (transactionsRes.data ?? []).map((t: any) => ({
      ...t,
      amount: Number(t.amount),
      account: t.account,
      category: t.category,
    })) as TransactionWithCategory[],
    projects: (projectsRes.data ?? []).map((p: any) => ({
      ...p,
      target_amount: Number(p.target_amount),
      monthly_allocation: Number(p.monthly_allocation),
    })) as Project[],
    objectives: (objectivesRes.data ?? []).map((o: any) => ({
      ...o,
      target_yearly_amount: Number(o.target_yearly_amount),
    })) as Objective[],
    questionnaireAnswers: qaRes.data ?? null,
  };
}

// Helper: Check if a recurring transaction applies to this month
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
    return (thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth ? amount : 0;
  }
  if (rule === 'yearly') return start.getMonth() === month - 1 && year >= start.getFullYear() ? amount : 0;
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

/** Montant récurrent déjà passé dans le mois courant (date ≤ todayStr). */
function recurrencePastInMonth(
  year: number, month: number, amount: number, startDate: string,
  rule: RecurrenceRule, endDate: string | null, todayStr: string, currentDate: Date,
): number {
  const total = addRecurrenceToMonth(year, month, amount, startDate, rule, endDate, currentDate);
  const start = new Date(startDate);
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  if (start > thisMonthEnd || end < thisMonthStart) return 0;

  if (rule === 'monthly') {
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (occ < startDate.slice(0, 10)) return 0;
    return occ <= todayStr ? total : 0;
  }
  if (rule === 'weekly') {
    let past = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) {
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (ds <= todayStr) past += amount;
      }
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return past;
  }
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 !== 0 || thisMonth < startMonth) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() !== month - 1 || year < start.getFullYear()) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  return 0;
}

// ── Horizon glissant / creux de trésorerie ──────────────────────────────────
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return isoDay(d);
}
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Occurrences (ISO) d'un modèle récurrent, strictement après `afterStr` et ≤ `untilStr`. */
function recurrenceOccurrencesBetween(startDate: string, rule: RecurrenceRule, endDate: string | null, afterStr: string, untilStr: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate.slice(0, 10) + 'T00:00:00');
  const until = new Date(untilStr + 'T00:00:00');
  const end = endDate ? new Date(endDate.slice(0, 10) + 'T00:00:00') : null;
  if (rule === 'weekly') {
    const d = new Date(start);
    while (isoDay(d) <= afterStr) d.setDate(d.getDate() + 7);
    let guard = 0;
    while (d <= until && (!end || d <= end) && guard++ < 200) { out.push(isoDay(d)); d.setDate(d.getDate() + 7); }
    return out;
  }
  const step = rule === 'monthly' ? 1 : rule === 'quarterly' ? 3 : rule === 'yearly' ? 12 : 0;
  if (step === 0) return out;
  const baseDay = start.getDate();
  const startTotal = start.getFullYear() * 12 + start.getMonth();
  for (let i = 0; i < 240; i++) {
    const total = startTotal + i * step;
    const yy = Math.floor(total / 12), mm = total % 12;
    const dim = new Date(yy, mm + 1, 0).getDate();
    const occ = new Date(yy, mm, Math.min(baseDay, dim));
    if (end && occ > end) break;
    const occStr = isoDay(occ);
    if (occStr > untilStr) break;
    if (occStr > afterStr) out.push(occStr);
  }
  return out;
}

export interface ExpectedIncome { monthlyAmount: number; nextDate: string | null; day: number; confidence: number; source: 'explicit' | 'inferred' | 'none' }

/** Détecte le revenu attendu : récurrent explicite, sinon inféré de l'historique (4 mois). */
function detectExpectedIncome(transactions: any[], checkingIds: Set<string>, todayStr: string): ExpectedIncome {
  const none: ExpectedIncome = { monthlyAmount: 0, nextDate: null, day: 1, confidence: 0, source: 'none' };
  // 1) Explicite : virement/recette récurrent(e) mensuel(le) entrant(e) sur un compte courant.
  const explicit = transactions.filter((t) =>
    checkingIds.has(t.account_id) && t.is_recurring && t.recurrence_rule === 'monthly'
    && Number(t.amount) > 0 && !t.is_draft && !t.linked_account_id);
  if (explicit.length > 0) {
    const top = explicit.slice().sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    const occ = recurrenceOccurrencesBetween(top.date, 'monthly', top.recurrence_end_date ?? null, todayStr, addDaysIso(todayStr, 40))[0] ?? null;
    return { monthlyAmount: Number(top.amount), nextDate: occ, day: new Date(top.date).getDate(), confidence: 1, source: 'explicit' };
  }
  // 2) Inféré : recettes ponctuelles régulières (même libellé, ≥ 2 mois distincts) sur 4 mois.
  const now = new Date(todayStr + 'T00:00:00');
  const fourMonthsAgo = isoDay(new Date(now.getFullYear(), now.getMonth() - 4, 1));
  const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const groups: Record<string, { amounts: number[]; days: number[]; months: Set<string> }> = {};
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || t.is_draft || t.is_reserved || t.linked_account_id) continue;
    if (Number(t.amount) <= 0 || t.date < fourMonthsAgo || t.date > todayStr) continue;
    const key = norm(t.note ?? '') || 'revenu';
    (groups[key] ??= { amounts: [], days: [], months: new Set() });
    groups[key].amounts.push(Number(t.amount));
    groups[key].days.push(new Date(t.date).getDate());
    groups[key].months.add(t.date.slice(0, 7));
  }
  let best: ExpectedIncome = none;
  for (const g of Object.values(groups)) {
    if (g.months.size < 2) continue;
    const amounts = g.amounts.slice().sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    if (median <= best.monthlyAmount) continue;
    const day = Math.round(g.days.reduce((s, d) => s + d, 0) / g.days.length);
    const confidence = Math.min(1, g.months.size / 3);
    let occ = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`;
    if (occ <= todayStr) occ = isoDay(new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28)));
    best = { monthlyAmount: median, nextDate: occ, day, confidence, source: 'inferred' };
  }
  return best;
}

/** Prudence (0..1, 1 = très prudent). Override profiles.prudence_level (0..100), sinon dérivée des allocations. */
function profilePrudence(profile: any): number {
  if (typeof profile?.prudence_level === 'number') return clamp01(profile.prudence_level / 100);
  const invest = Number(profile?.allocation_invest_percent ?? 25);
  return clamp01(0.7 - invest / 100); // plus on investit, moins on est prudent
}

// Compute Pilotage Dashboard Data
function computePilotageData(data: Awaited<ReturnType<typeof fetchPilotageData>>): PilotageData {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const { profile, accounts, transactions, projects, objectives } = data;

  // =====================================================================
  // AGGREGATIONS: Accounts by Type
  // =====================================================================
  const total_checking = accounts.filter(a => a.type === 'checking').reduce((sum, a) => sum + Number(a.balance), 0);
  const total_savings = accounts.filter(a => a.type === 'savings').reduce((sum, a) => sum + Number(a.balance), 0);
  const total_invested = accounts.filter(a => a.type === 'investment').reduce((sum, a) => sum + Number(a.balance), 0);

  const safety_threshold_min = profile?.safety_threshold_min ?? 5000;
  const safety_threshold_optimal = profile?.safety_threshold_optimal ?? 10000;
  const safety_threshold_comfort = profile?.safety_threshold_comfort ?? 20000;
  const current_savings = total_savings;

  // =====================================================================
  // STEP 1: Safe to Spend
  // ─────────────────────────────────────────────────────────────────────
  // Formula:
  //   remaining_month_net = Σ transactions this month AFTER today (income – expenses)
  //   committed_projects  = Σ active projects monthly_allocation
  //   committed_objectives = Σ active objectives target_yearly / 12
  //   base_to_spend = checking_balance + remaining_month_net
  //                   - committed_projects - committed_objectives
  //   safe_to_spend = base_to_spend × (1 - safety_margin_percent / 100)
  // ─────────────────────────────────────────────────────────────────────
  const current_checking_balance = total_checking;
  const safety_margin_percent = profile?.safety_margin_percent ?? 10; // conservé pour rétrocompatibilité
  const safety_margin_amount = profile?.safety_margin_amount ?? 0;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const checkingIds = new Set(accounts.filter(a => a.type === 'checking').map(a => a.id));
  const prudence = profilePrudence(profile);

  // Engagements (projets actifs) + objectifs (info, non déduits du budget)
  const committed_project_allocations = projects
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + Number(p.monthly_allocation), 0);
  const committed_objective_monthly = objectives
    .filter(o => o.status === 'active')
    .reduce((sum, o) => sum + (Number(o.target_yearly_amount) / 12), 0);
  const committed_allocations = committed_project_allocations;
  const monthly_commitments = committed_allocations;

  // Réservations même compte : l'argent est « réservé » mais reste sur le courant (passées uniquement).
  const same_account_reserved = projects
    .filter(p => p.status === 'active' && p.source_account_id && p.linked_account_id && p.source_account_id === p.linked_account_id)
    .reduce((sum, p) => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const pastTxns = transactions.filter(t => t.project_id === p.id && t.date <= todayStr && !(t as any).is_draft);
      return sum + pastTxns.length * monthlyAlloc;
    }, 0);

  // ── Revenu attendu + CREUX de trésorerie (horizon glissant jusqu'à la prochaine rentrée) ──
  // Le budget libre = point le plus bas du solde courant simulé d'ici la prochaine rentrée d'argent
  // (revenus ET dépenses comptés dans l'ordre). On ne libère jamais plus que ce creux → robuste
  // au décalage de date de paie (le montant du creux ne bouge presque pas). Le revenu non saisi
  // est INFÉRÉ de l'historique et pondéré par la prudence (profil).
  const expectedIncome = detectExpectedIncome(transactions, checkingIds, todayStr);

  let nextIncomeDate: string | null = null;
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || t.linked_account_id || (t as any).project_id) continue;
    if (Number(t.amount) <= 0) continue;
    if (t.is_recurring && t.recurrence_rule) {
      const occ = recurrenceOccurrencesBetween(t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null, todayStr, addDaysIso(todayStr, 40))[0];
      if (occ && (!nextIncomeDate || occ < nextIncomeDate)) nextIncomeDate = occ;
    } else if (t.date > todayStr && (!nextIncomeDate || t.date < nextIncomeDate)) {
      nextIncomeDate = t.date;
    }
  }
  if (expectedIncome.source === 'inferred' && expectedIncome.nextDate && (!nextIncomeDate || expectedIncome.nextDate < nextIncomeDate)) {
    nextIncomeDate = expectedIncome.nextDate;
  }

  // Horizon : jusqu'à la prochaine rentrée (+2 j), borné à [7 j, 45 j] ; 30 j si aucune rentrée.
  let horizonEnd = nextIncomeDate ? addDaysIso(nextIncomeDate, 2) : addDaysIso(todayStr, 30);
  if (horizonEnd < addDaysIso(todayStr, 7)) horizonEnd = addDaysIso(todayStr, 7);
  if (horizonEnd > addDaysIso(todayStr, 45)) horizonEnd = addDaysIso(todayStr, 45);

  // Événements futurs sur comptes courants (hors projets/réservés/brouillons), revenus ET dépenses.
  const events: { date: string; amount: number }[] = [];
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || (t as any).project_id) continue;
    const amt = Number(t.amount);
    if (t.is_recurring && t.recurrence_rule) {
      for (const occ of recurrenceOccurrencesBetween(t.date, t.recurrence_rule as RecurrenceRule, (t as any).recurrence_end_date ?? null, todayStr, horizonEnd)) events.push({ date: occ, amount: amt });
    } else if (t.date > todayStr && t.date <= horizonEnd) {
      events.push({ date: t.date, amount: amt });
    }
  }
  // Revenu INFÉRÉ (non saisi) : ajouté à sa date, pondéré par confiance × (1 − prudence).
  const inferredTrust = clamp01(1 - prudence) * expectedIncome.confidence;
  if (expectedIncome.source === 'inferred' && expectedIncome.nextDate && expectedIncome.nextDate <= horizonEnd && inferredTrust > 0) {
    events.push({ date: expectedIncome.nextDate, amount: expectedIncome.monthlyAmount * inferredTrust });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  let running = current_checking_balance;
  let trough = current_checking_balance;
  let month_income_remaining = 0;   // recettes à venir (info / affichage)
  let outflow_remaining = 0;
  for (const e of events) {
    running += e.amount;
    if (e.amount > 0) month_income_remaining += e.amount; else outflow_remaining += -e.amount;
    if (running < trough) trough = running;
  }
  const remaining_fixed_expenses = outflow_remaining;

  // Base à dépenser = creux − engagements − réservations.
  const base_to_spend = trough - committed_allocations - same_account_reserved;
  const safe_to_spend = Math.max(0, base_to_spend - safety_margin_amount);

  // ── Garde-fou PROJECTION (moyen terme) : le solde courant projeté tient-il N mois ? ──
  // N dépend de la prudence (3 → 12 mois). Net mensuel = moyenne 3 mois passés (courant, hors virements/régul).
  const projHorizonMonths = Math.round(3 + prudence * 9);
  const past3Keys = [1, 2, 3].map((k) => { const d = new Date(currentYear, currentMonth - 1 - k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const netByMonth: Record<string, number> = {};
  for (const t of transactions) {
    if (!checkingIds.has(t.account_id) || (t as any).is_draft || (t as any).is_reserved || t.linked_account_id) continue;
    if (/r[ée]gul/i.test((t as any).note ?? '')) continue;
    const mk = t.date.slice(0, 7);
    if (past3Keys.includes(mk)) netByMonth[mk] = (netByMonth[mk] ?? 0) + Number(t.amount);
  }
  const netVals = Object.values(netByMonth);
  const monthly_net_3m = netVals.length ? netVals.reduce((s, v) => s + v, 0) / netVals.length : 0;
  const projection_min_buffer = current_checking_balance + projHorizonMonths * Math.min(0, monthly_net_3m);
  const projection_in_danger = projection_min_buffer < Math.max(0, safety_margin_amount);

  // =====================================================================
  // STEP 2: Variable Expense Trend (using is_variable flag)
  // =====================================================================
  const lastThreeMonths: Array<{ year: number; month: number }> = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    lastThreeMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // Variable expenses per month for last 3 months (using is_variable category flag)
  const variableByMonth: Record<string, number> = {};
  for (const m of lastThreeMonths) {
    variableByMonth[`${m.year}-${m.month}`] = 0;
  }

  for (const t of transactions) {
    if (t.amount >= 0) continue;
    const cat = (t as TransactionWithCategory).category;
    if (!cat?.is_variable) continue;
    const [tYear, tMonth] = t.date.split('-').map(Number);
    const key = `${tYear}-${tMonth}`;
    if (key in variableByMonth) {
      variableByMonth[key] += Math.abs(Number(t.amount));
    }
  }

  const monthlyTotals = Object.values(variableByMonth);
  const nonZeroMonths = monthlyTotals.filter(v => v > 0);
  const avg_variable_expenses_3m = nonZeroMonths.length > 0
    ? nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length
    : 0;

  const currentMonthKey = `${currentYear}-${currentMonth}`;
  const current_month_variable = variableByMonth[currentMonthKey] ?? 0;

  const variable_trend_percentage = avg_variable_expenses_3m > 0 ? (current_month_variable / avg_variable_expenses_3m) * 100 : 0;

  // =====================================================================
  // STEP 3: Surplus & Recommendation
  // =====================================================================
  const projected_surplus = Math.max(0, safe_to_spend - Math.max(0, avg_variable_expenses_3m - current_month_variable));
  const recommendation: 'À ÉPARGNER' | 'À INVESTIR' = current_savings < safety_threshold_optimal ? 'À ÉPARGNER' : 'À INVESTIR';

  // =====================================================================
  // STEP 4: Projects "Good to Go"
  // =====================================================================
  const available_savings = Math.max(0, current_savings - safety_threshold_optimal);
  const sum_all_project_targets = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + Number(p.target_amount), 0);

  const projects_with_progress = projects
    .filter(p => p.status === 'active')
    .map(p => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const sameAccount = p.source_account_id && p.linked_account_id
        && p.source_account_id === p.linked_account_id;

      // Calculer la progression basée sur les transactions PASSÉES et VALIDÉES liées au projet
      const projectTxns = transactions.filter(t =>
        t.project_id === p.id && t.date <= todayStr && !(t as any).is_draft
      );

      let projectTransactionsTotal: number;
      if (sameAccount) {
        // Même compte → réservations (amount=0), on compte occurrences passées × allocation
        projectTransactionsTotal = projectTxns.length * monthlyAlloc;
      } else {
        // Comptes différents → on somme les montants absolus des débits passés
        const debits = projectTxns.filter(t => Number(t.amount) < 0);
        projectTransactionsTotal = debits.length > 0
          ? debits.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
          : projectTxns.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
      }
      
      const totalAccumulated = projectTransactionsTotal;
      const progress = Number(p.target_amount) > 0 ? (totalAccumulated / Number(p.target_amount)) * 100 : 0;

      return {
        id: p.id,
        name: p.name,
        target_amount: Number(p.target_amount),
        monthly_allocation: Number(p.monthly_allocation),
        progress_percentage: Math.min(progress, 100),
        status: p.status,
      };
    });

  const global_projects_percentage = sum_all_project_targets > 0 
    ? (projects_with_progress.reduce((sum, p) => sum + (p.progress_percentage / 100) * p.target_amount, 0) / sum_all_project_targets) * 100 
    : 0;

  // =====================================================================
  // STEP 5: Objectives Achievement
  // =====================================================================
  const objectives_with_progress = objectives
    .filter(o => o.status === 'active')
    .map(o => {
      // Sum transfers to linked_account_id in current year
      const current_year_invested = transactions
        .filter(t => {
          const [tYear] = t.date.split('-').map(Number);
          return tYear === currentYear && t.account_id === o.linked_account_id && t.amount > 0;
        })
        .reduce((sum, t) => sum + Number(t.amount), 0);

      return {
        id: o.id,
        name: o.name,
        target_yearly_amount: Number(o.target_yearly_amount),
        current_year_invested,
        progress_percentage: Number(o.target_yearly_amount) > 0 ? (current_year_invested / Number(o.target_yearly_amount)) * 100 : 0,
        account_name: data.accounts.find(a => a.id === o.linked_account_id)?.name,
        account_type: data.accounts.find(a => a.id === o.linked_account_id)?.type,
        status: o.status,
      };
    });

  const sum_all_yearly_targets = objectives.filter(o => o.status === 'active').reduce((sum, o) => sum + Number(o.target_yearly_amount), 0);
  const sum_invested_ytd = objectives_with_progress.reduce((sum, o) => sum + o.current_year_invested, 0);
  const global_objectives_percentage = sum_all_yearly_targets > 0 ? (sum_invested_ytd / sum_all_yearly_targets) * 100 : 0;

  // =====================================================================
  // SUIVI : engagements du mois en cours (épargne / invest / dépenses)
  // =====================================================================
  const accountTypeById: Record<string, string> = {};
  accounts.forEach(a => { accountTypeById[a.id] = a.type; });

  // Projets : distinguer ceux qui transfèrent vers un autre compte (épargne)
  // de ceux qui réservent sur le même compte courant (tagué « Réservé »).
  const activeProjects = projects.filter(p => p.status === 'active');
  const isSameAccountProject = (p: Project) =>
    !!(p.source_account_id && p.linked_account_id && p.source_account_id === p.linked_account_id);

  const project_savings_monthly = activeProjects
    .filter(p => !isSameAccountProject(p))
    .reduce((s, p) => s + Number(p.monthly_allocation || 0), 0);

  let transfer_savings = 0;   // virements vers comptes épargne (depuis courant)
  let transfer_savings_past = 0;
  let transfer_invest = 0;    // virements vers comptes investissement (depuis courant/épargne)
  let transfer_invest_past = 0;
  let month_expenses_total = 0;       // dépenses du mois (passées + à venir) — affichage info
  let month_expenses_past = 0;        // dépenses validées déjà passées (déjà dans le solde)
  let month_expenses_remaining = 0;   // dépenses datées après aujourd'hui (encore à sortir → budget libre)

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (amt >= 0) continue; // sorties uniquement
    const [tY, tM] = t.date.split('-').map(Number);
    const isThisMonth = tY === currentYear && tM === currentMonth;
    const isRecurring = Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule);
    const isDraft = Boolean((t as any).is_draft);

    // Montant projeté sur le mois courant (récurrent → projection, sinon ponctuel du mois)
    const monthlyAmt = isRecurring
      ? addRecurrenceToMonth(currentYear, currentMonth, Math.abs(amt), t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, now)
      : (isThisMonth ? Math.abs(amt) : 0);
    if (monthlyAmt <= 0) continue;

    const pastAmt = isDraft ? 0 : (
      isRecurring
        ? recurrencePastInMonth(currentYear, currentMonth, Math.abs(amt), t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, todayStr, now)
        : (isThisMonth && t.date <= todayStr ? Math.abs(amt) : 0)
    );

    const srcType = accountTypeById[t.account_id];
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    const hasProject = Boolean((t as any).project_id);

    if (linkedType === 'investment' && (srcType === 'checking' || srcType === 'savings') && !hasProject) {
      // Virement réel vers un compte d'investissement
      transfer_invest += monthlyAmt;
      transfer_invest_past += pastAmt;
    } else if (linkedType === 'savings' && srcType === 'checking' && !hasProject) {
      // Virement réel vers un compte d'épargne
      transfer_savings += monthlyAmt;
      transfer_savings_past += pastAmt;
    } else if (!t.linked_account_id && !hasProject && srcType === 'checking') {
      // Vraie dépense : depuis un compte courant, catégorie dépense, hors régularisation
      const cat = (t as TransactionWithCategory).category;
      const isExpenseCat = !cat || cat.type === 'expense';
      const isRegul = !!(cat?.name && /r[ée]gularisation/i.test(cat.name));
      if (isExpenseCat && !isRegul) {
        month_expenses_total += monthlyAmt;
        // Le passé est déjà reflété dans le solde courant → ne pas le redéduire du budget.
        // Seules les dépenses à venir (non-brouillon) sont déduites du budget libre.
        if (!isDraft) {
          month_expenses_past += pastAmt;
          month_expenses_remaining += Math.max(0, monthlyAmt - pastAmt);
        }
      }
    }
  }

  const monthly_savings_planned = transfer_savings + project_savings_monthly;
  const monthly_invest_planned = transfer_invest; // virements réels uniquement (objectifs exclus)

  // ── Virements épargne / investissement du mois (affichage Suivi) ──
  // TOUS les virements du mois courant (passés + futurs), y compris ceux liés à un projet,
  // détectés via linked_account_id. `_total` = affichage ; `_future` = part non encore sortie
  // du solde (date > aujourd'hui) → seule part déduite du budget libre (pas de double comptage).
  let month_savings_total = 0, month_savings_future = 0;
  let month_invest_total = 0, month_invest_future = 0;
  for (const t of transactions) {
    if ((t as any).is_draft) continue;
    const amt = Number(t.amount);
    if (amt >= 0) continue; // sortie depuis le compte source
    const srcType = accountTypeById[t.account_id];
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    if (!linkedType) continue;
    const isRecurring = Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule);
    const [tY, tM] = t.date.split('-').map(Number);
    const isThisMonth = tY === currentYear && tM === currentMonth;
    const monthlyAmt = isRecurring
      ? addRecurrenceToMonth(currentYear, currentMonth, Math.abs(amt), t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, now)
      : (isThisMonth ? Math.abs(amt) : 0);
    if (monthlyAmt <= 0) continue;
    const pastAmt = isRecurring
      ? recurrencePastInMonth(currentYear, currentMonth, Math.abs(amt), t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, todayStr, now)
      : (isThisMonth && t.date <= todayStr ? Math.abs(amt) : 0);
    const futureAmt = Math.max(0, monthlyAmt - pastAmt);
    if (linkedType === 'investment' && (srcType === 'checking' || srcType === 'savings')) {
      month_invest_total += monthlyAmt; month_invest_future += futureAmt;
    } else if (linkedType === 'savings' && srcType === 'checking') {
      month_savings_total += monthlyAmt; month_savings_future += futureAmt;
    }
  }

  // Épargne/invest déjà exécutée ce mois (solde courant déjà impacté) → ne pas redéduire du budget libre
  let project_savings_executed = 0;
  for (const p of activeProjects.filter(ap => !isSameAccountProject(ap))) {
    project_savings_executed += transactions
      .filter(t => t.project_id === p.id && !(t as any).is_draft && Number(t.amount) < 0)
      .filter(t => {
        const [tY, tM] = t.date.split('-').map(Number);
        return tY === currentYear && tM === currentMonth;
      })
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  }
  const project_savings_remaining = Math.max(0, project_savings_monthly - project_savings_executed);
  const transfer_savings_remaining = Math.max(0, transfer_savings - transfer_savings_past);
  const transfer_invest_remaining = Math.max(0, transfer_invest - transfer_invest_past);
  const monthly_savings_remaining = project_savings_remaining + transfer_savings_remaining;
  const monthly_invest_remaining = transfer_invest_remaining;
  // Pour le budget de recommandation : épargne réelle HORS projets, et invest réel.
  const real_savings_excl_projects = transfer_savings;
  const real_invest = transfer_invest;

  // =====================================================================
  // RÉSERVÉ : montants mis de côté persistants (jusqu'à utilisation/libération)
  //  - Projets « même compte » actifs : allocation mensuelle (comme avant)
  //  - Brouillons « Conservés » (is_reserved) : montant du brouillon, groupé par projet
  // =====================================================================
  const projectsById: Record<string, Project> = {};
  projects.forEach((p) => { projectsById[p.id] = p; });

  const reservedMap: Record<string, {
    id: string; name: string; total: number;
    source_account_id: string | null; linked_account_id: string | null;
  }> = {};

  const addReserved = (proj: Project, amount: number) => {
    if (amount <= 0) return;
    if (!reservedMap[proj.id]) {
      reservedMap[proj.id] = {
        id: proj.id, name: proj.name, total: 0,
        source_account_id: proj.source_account_id ?? null,
        linked_account_id: proj.linked_account_id ?? null,
      };
    }
    reservedMap[proj.id].total += amount;
  };

  // Brouillons « Conservés » (is_reserved) — inclut les projets même-compte (réservés d'office).
  // Groupés par projet (1 ligne par projet, montants cumulés).
  for (const t of transactions) {
    if (!(t as any).is_draft || !(t as any).is_reserved) continue;
    const pid = (t as any).project_id as string | null;
    if (!pid) continue;
    const proj = projectsById[pid];
    if (!proj) continue;
    addReserved(proj, Math.abs(Number(t.amount)) || Number(proj.monthly_allocation || 0));
  }

  const reserved_by_project = Object.values(reservedMap);
  const monthly_reserve_planned = reserved_by_project.reduce((s, r) => s + r.total, 0);

  // =====================================================================
  // ENVELOPPE DES DÉPENSES VARIABLES (estimation dynamique)
  //  Définition : dépenses variables NON récurrentes (catégorie is_variable)
  //  depuis comptes courants, hors virements/projets + régularisations (net signé).
  //  Initiale :
  //    - ≥ 2 mois passés avec dépenses variables (M-1..M-6) → moyenne
  //    - sinon → question 4 du questionnaire (champ q9, hebdo × 4,33 → mensuel)
  //  Restant = max(0, initiale − déjà dépensé ce mois) → déduit du Reste.
  // =====================================================================

  const isNonRecurringTx = (t: TransactionWithCategory) =>
    !(Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule));
  const isRegulTx = (t: TransactionWithCategory) => {
    const cat = t.category;
    if (cat?.name && /r[ée]gularisation/i.test(cat.name)) return true;
    const note = (t as any).note as string | null;
    return !!(note && (/r[ée]gularisation/i.test(note) || note === 'Ajustement de solde'));
  };
  // Contribution d'une transaction aux dépenses variables (€), net signé.
  const variableContribution = (t: TransactionWithCategory): number => {
    if (!isNonRecurringTx(t)) return 0;
    if (accountTypeById[t.account_id] !== 'checking') return 0;
    if ((t as any).linked_account_id || (t as any).project_id) return 0; // pas un virement / projet
    const amt = Number(t.amount);
    if (isRegulTx(t)) return -amt; // régul : dépense (−) → +, recette (+) → −
    if (t.category?.is_variable === true) {
      // Catégorie variable : dépense (−) → + de dépensé ; remboursement (+) → − (net).
      return -amt;
    }
    return 0;
  };

  // Historique des 6 mois précédents
  const pastMonths: Array<{ year: number; month: number; key: string }> = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    pastMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: `${d.getFullYear()}-${d.getMonth() + 1}` });
  }
  const variableByPastMonth: Record<string, number> = {};
  pastMonths.forEach(m => { variableByPastMonth[m.key] = 0; });

  let variable_envelope_spent = 0;
  for (const t of transactions) {
    if (!isNonRecurringTx(t)) continue;
    const [ty, tm] = t.date.split('-').map(Number);
    const key = `${ty}-${tm}`;
    if (ty === currentYear && tm === currentMonth) {
      variable_envelope_spent += variableContribution(t);
    } else if (key in variableByPastMonth) {
      variableByPastMonth[key] += variableContribution(t);
    }
  }
  variable_envelope_spent = Math.max(0, variable_envelope_spent);

  // Historique = mois passés avec de vraies dépenses variables (> 0), pas toute transaction.
  const monthsWithData = pastMonths.filter(m => variableByPastMonth[m.key] > 0);
  let variable_envelope_initial = 0;
  let variable_envelope_source: 'history' | 'onboarding' | 'none' = 'none';
  let variable_envelope_months_used = 0;

  if (monthsWithData.length >= 2) {
    const sum = monthsWithData.reduce((s, m) => s + variableByPastMonth[m.key], 0);
    variable_envelope_initial = sum / monthsWithData.length;
    variable_envelope_source = 'history';
    variable_envelope_months_used = monthsWithData.length;
  } else {
    // Sans historique variable suffisant : question 4 du questionnaire (champ q9, hebdo → mensuel)
    const weekly =
      Number(profile?.weekly_variable_budget ?? 0) ||
      weeklyVariableFromQ9(String(data.questionnaireAnswers?.q9 ?? ''));
    if (weekly > 0) {
      variable_envelope_initial = weekly * WEEKS_PER_MONTH;
      variable_envelope_source = 'onboarding';
    }
  }

  const variable_envelope_remaining = Math.max(0, variable_envelope_initial - variable_envelope_spent);

  return {
    safe_to_spend,
    current_checking_balance,
    remaining_fixed_expenses,
    committed_allocations,
    monthly_commitments,
    same_account_reserved,
    month_income_remaining,
    expected_monthly_income: expectedIncome.monthlyAmount,
    expected_income_source: expectedIncome.source,
    expected_income_confidence: expectedIncome.confidence,
    projection_min_buffer,
    projection_in_danger,
    prudence,
    monthly_savings_planned,
    monthly_savings_remaining,
    monthly_invest_planned,
    monthly_invest_remaining,
    month_savings_total,
    month_savings_future,
    month_invest_total,
    month_invest_future,
    real_savings_excl_projects,
    real_invest,
    monthly_reserve_planned,
    month_expenses_total,
    month_expenses_past,
    month_expenses_remaining,
    committed_objective_monthly,
    reserved_by_project,
    avg_variable_expenses_3m,
    current_month_variable,
    variable_trend_percentage,
    variable_envelope_initial,
    variable_envelope_spent,
    variable_envelope_remaining,
    variable_envelope_source,
    variable_envelope_months_used,
    projected_surplus,
    recommendation,
    safety_margin_percent,
    safety_margin_amount,
    financial_profile: profile?.financial_profile ?? undefined,
    allocation_save_percent: profile?.allocation_save_percent ?? undefined,
    allocation_invest_percent: profile?.allocation_invest_percent ?? undefined,
    allocation_enjoy_percent: profile?.allocation_enjoy_percent ?? undefined,
    allocation_keep_percent: profile?.allocation_keep_percent ?? undefined,
    initial_onboarding_completed: profile?.initial_onboarding_completed ?? false,
    available_savings,
    projects_with_progress,
    global_projects_percentage,
    objectives_with_progress,
    global_objectives_percentage,
    total_checking,
    total_savings,
    total_invested,
    safety_threshold_min,
    safety_threshold_optimal,
    safety_threshold_comfort,
    current_savings,
  };
}

export function usePilotageData(profileId: string | undefined) {
  return useQuery({
    queryKey: ['pilotage_data', profileId],
    queryFn: async () => {
      if (!profileId) throw new Error('No profile ID');
      const data = await fetchPilotageData(profileId);
      return computePilotageData(data);
    },
    enabled: !!profileId,
  });
}
