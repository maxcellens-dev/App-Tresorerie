import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Account, Transaction, Project, Objective, Profile, Category, RecurrenceRule, TransactionWithDetails } from '../types/database';

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

  // Step 2: Variable Expense Trend
  avg_variable_expenses_3m: number;
  current_month_variable: number;
  variable_trend_percentage: number;

  // Step 3: Surplus & Recommendation
  projected_surplus: number;
  recommendation: 'À ÉPARGNER' | 'À INVESTIR';

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
    supabase.from('transactions').select('*, account:accounts(name), category:categories(*)').eq('profile_id', profileId),
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
  const safety_margin_percent = profile?.safety_margin_percent ?? 10;
  const todayStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Net of all future transactions this month (after today):
  // income (+) and expenses (–), regardless of type (fixed, variable, forecast…)
  const remaining_month_net = transactions
    .filter(t => {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      return tYear === currentYear && tMonth === currentMonth && t.date > todayStr;
    })
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // Remaining fixed expenses kept for status indicators (absolute value of outflows)
  const remaining_fixed_expenses = Math.abs(
    transactions
      .filter(t => {
        const [tYear, tMonth] = t.date.split('-').map(Number);
        return tYear === currentYear && tMonth === currentMonth && t.date > todayStr && Number(t.amount) < 0;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0)
  );

  // Committed allocations: active projects monthly + active objectives monthly
  const committed_project_allocations = projects
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + Number(p.monthly_allocation), 0);

  const committed_objective_monthly = objectives
    .filter(o => o.status === 'active')
    .reduce((sum, o) => sum + (Number(o.target_yearly_amount) / 12), 0);

  const committed_allocations = committed_project_allocations + committed_objective_monthly;

  // Same-account project reservations: money is "reserved" but still sits
  // on the checking account. Only count PAST reservations (date ≤ today)
  // so the user isn't told they can spend money already earmarked.
  const same_account_reserved = projects
    .filter(p => p.status === 'active'
      && p.source_account_id && p.linked_account_id
      && p.source_account_id === p.linked_account_id)
    .reduce((sum, p) => {
      const monthlyAlloc = Number(p.monthly_allocation) || 0;
      const pastTxns = transactions.filter(t => t.project_id === p.id && t.date <= todayStr);
      return sum + pastTxns.length * monthlyAlloc;
    }, 0);

  // Base to spend = checking balance + future net – project/objective commitments – reserved
  const base_to_spend = current_checking_balance + remaining_month_net - committed_allocations - same_account_reserved;

  // Apply safety margin on the base (not on gross balance)
  const safe_to_spend = Math.max(0, base_to_spend * (1 - safety_margin_percent / 100));

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

      // Calculer la progression basée sur les transactions PASSÉES liées au projet
      const projectTxns = transactions.filter(t => t.project_id === p.id && t.date <= todayStr);

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

  return {
    safe_to_spend,
    current_checking_balance,
    remaining_fixed_expenses,
    committed_allocations,
    same_account_reserved,
    avg_variable_expenses_3m,
    current_month_variable,
    variable_trend_percentage,
    projected_surplus,
    recommendation,
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
