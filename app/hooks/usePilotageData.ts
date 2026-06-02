import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
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

  // Suivi des engagements du mois en cours
  monthly_savings_planned: number;       // virements récurrents épargne + projets
  monthly_invest_planned: number;        // virements récurrents invest + objectifs
  monthly_reserve_planned: number;       // total réservé (projets même compte + brouillons conservés)
  month_expenses_total: number;          // total dépenses du mois (passées + à venir, hors virements)
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
  projects: Project[];
  objectives: Objective[];
}> {
  if (!supabase || !profileId) throw new Error('Not authenticated');

  const [profileRes, accountsRes, transactionsRes, projectsRes, objectivesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase.from('accounts').select('*').eq('profile_id', profileId),
    supabase.from('transactions').select('*, account:accounts!account_id(name), category:categories!category_id(*)').eq('profile_id', profileId),
    supabase.from('projects').select('*').eq('profile_id', profileId),
    supabase.from('objectives').select('*').eq('profile_id', profileId),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (accountsRes.error) throw accountsRes.error;
  if (transactionsRes.error) throw transactionsRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (objectivesRes.error) throw objectivesRes.error;

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

  // Sorties futures ce mois (après aujourd'hui, montants négatifs uniquement).
  // On n'inclut PAS les recettes futures : le safe_to_spend est basé sur ce qu'on a
  // maintenant, pas sur ce qu'on va recevoir.
  const remaining_future_outflows = transactions
    .filter(t => {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      return tYear === currentYear && tMonth === currentMonth && t.date > todayStr && Number(t.amount) < 0;
    })
    .reduce((sum, t) => sum + Number(t.amount), 0); // négatif

  // Dépenses futures (valeur absolue) — pour indicateurs
  const remaining_fixed_expenses = Math.abs(remaining_future_outflows);

  // Committed allocations: active projects monthly + active objectives monthly
  const committed_project_allocations = projects
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + Number(p.monthly_allocation), 0);

  const committed_objective_monthly = objectives
    .filter(o => o.status === 'active')
    .reduce((sum, o) => sum + (Number(o.target_yearly_amount) / 12), 0);

  // Les objectifs ne sont pas déduits du safe_to_spend (ils sont informatifs, pas une vraie sortie planifiée)
  const committed_allocations = committed_project_allocations;
  const monthly_commitments = committed_allocations;

  // Same-account project reservations: money is "reserved" but still sits
  // on the checking account. Only count PAST reservations (date ≤ today)
  // so the user isn't told they can spend money already earmarked.
  const same_account_reserved = projects
    .filter(p => p.status === 'active'
      && p.source_account_id && p.linked_account_id
      && p.source_account_id === p.linked_account_id)
    .reduce((sum, p) => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const pastTxns = transactions.filter(t => t.project_id === p.id && t.date <= todayStr && !(t as any).is_draft);
      return sum + pastTxns.length * monthlyAlloc;
    }, 0);

  // Base à dépenser = solde courant + sorties futures - engagements - réservations
  const base_to_spend = current_checking_balance + remaining_future_outflows - committed_allocations - same_account_reserved;

  // Safe to spend = base - marge de sécurité fixe (montant conservé quoi qu'il arrive)
  const safe_to_spend = Math.max(0, base_to_spend - safety_margin_amount);

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
  let transfer_invest = 0;    // virements vers comptes investissement (depuis courant/épargne)
  let month_expenses_total = 0;

  for (const t of transactions) {
    const amt = Number(t.amount);
    if (amt >= 0) continue; // sorties uniquement
    const [tY, tM] = t.date.split('-').map(Number);
    const isThisMonth = tY === currentYear && tM === currentMonth;
    const isRecurring = Boolean((t as any).is_recurring) && Boolean((t as any).recurrence_rule);

    // Montant projeté sur le mois courant (récurrent → projection, sinon ponctuel du mois)
    const monthlyAmt = isRecurring
      ? addRecurrenceToMonth(currentYear, currentMonth, Math.abs(amt), t.date, (t as any).recurrence_rule, (t as any).recurrence_end_date ?? null, now)
      : (isThisMonth ? Math.abs(amt) : 0);
    if (monthlyAmt <= 0) continue;

    const srcType = accountTypeById[t.account_id];
    const linkedType = t.linked_account_id ? accountTypeById[t.linked_account_id] : null;
    const hasProject = Boolean((t as any).project_id);

    if (linkedType === 'investment' && (srcType === 'checking' || srcType === 'savings') && !hasProject) {
      // Virement réel vers un compte d'investissement
      transfer_invest += monthlyAmt;
    } else if (linkedType === 'savings' && srcType === 'checking' && !hasProject) {
      // Virement réel vers un compte d'épargne
      transfer_savings += monthlyAmt;
    } else if (!t.linked_account_id && !hasProject && srcType === 'checking') {
      // Vraie dépense : depuis un compte courant, catégorie dépense, hors régularisation
      const cat = (t as TransactionWithCategory).category;
      const isExpenseCat = !cat || cat.type === 'expense';
      const isRegul = !!(cat?.name && /r[ée]gularisation/i.test(cat.name));
      if (isExpenseCat && !isRegul) {
        month_expenses_total += monthlyAmt;
      }
    }
  }

  const monthly_savings_planned = transfer_savings + project_savings_monthly;
  const monthly_invest_planned = transfer_invest; // virements réels uniquement (objectifs exclus)

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
  //  Définition : dépenses NON récurrentes (depuis comptes courants, hors
  //  virements/projets) + régularisations de solde (net signé).
  //  Initiale :
  //    - ≥ 2 mois d'historique (M-1..M-6) → moyenne sur les mois disponibles
  //    - sinon → estimation onboarding (q9 hebdo × 4.33)
  //  Restant = max(0, initiale − déjà dépensé ce mois) → déduit du Reste.
  // =====================================================================
  const WEEKS_PER_MONTH = 4.33;

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
    if (amt < 0) {
      const cat = t.category;
      const isExpenseCat = !cat || cat.type === 'expense';
      return isExpenseCat ? -amt : 0; // dépense → +abs
    }
    return 0; // recette non-régul ignorée
  };

  // Historique des 6 mois précédents
  const pastMonths: Array<{ year: number; month: number; key: string }> = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    pastMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: `${d.getFullYear()}-${d.getMonth() + 1}` });
  }
  const variableByPastMonth: Record<string, number> = {};
  const monthHasData: Record<string, boolean> = {};
  pastMonths.forEach(m => { variableByPastMonth[m.key] = 0; monthHasData[m.key] = false; });

  let variable_envelope_spent = 0;
  for (const t of transactions) {
    if (!isNonRecurringTx(t)) continue;
    const [ty, tm] = t.date.split('-').map(Number);
    const key = `${ty}-${tm}`;
    if (ty === currentYear && tm === currentMonth) {
      variable_envelope_spent += variableContribution(t);
    } else if (key in variableByPastMonth) {
      monthHasData[key] = true; // toute transaction non récurrente = mois suivi
      variableByPastMonth[key] += variableContribution(t);
    }
  }
  variable_envelope_spent = Math.max(0, variable_envelope_spent);

  const monthsWithData = pastMonths.filter(m => monthHasData[m.key]);
  let variable_envelope_initial = 0;
  let variable_envelope_source: 'history' | 'onboarding' | 'none' = 'none';
  let variable_envelope_months_used = 0;

  if (monthsWithData.length >= 2) {
    const sum = monthsWithData.reduce((s, m) => s + Math.max(0, variableByPastMonth[m.key]), 0);
    variable_envelope_initial = sum / monthsWithData.length;
    variable_envelope_source = 'history';
    variable_envelope_months_used = monthsWithData.length;
  } else {
    const weekly = Number(profile?.weekly_variable_budget ?? 0);
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
    monthly_savings_planned,
    monthly_invest_planned,
    monthly_reserve_planned,
    month_expenses_total,
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
