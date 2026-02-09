import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Account, Transaction, Project, Objective, Profile, RecurrenceRule, TransactionWithDetails } from '../types/database';

export interface PilotageData {
  // Step 1: Safe to Spend
  safe_to_spend: number;
  current_checking_balance: number;
  remaining_fixed_expenses: number;
  committed_allocations: number;

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
  transactions: TransactionWithDetails[];
  projects: Project[];
  objectives: Objective[];
}> {
  if (!supabase || !profileId) throw new Error('Not authenticated');

  const [profileRes, accountsRes, transactionsRes, projectsRes, objectivesRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', profileId).single(),
    supabase.from('accounts').select('*').eq('profile_id', profileId),
    supabase.from('transactions').select('*, account:accounts(name), category:categories(name, type)').eq('profile_id', profileId),
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
    })) as TransactionWithDetails[],
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
  // =====================================================================
  const current_checking_balance = total_checking;

  // Calculate remaining fixed expenses (recurring transactions for current month that haven't passed)
  const remaining_fixed_expenses = transactions
    .filter(t => {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      if (tYear !== currentYear || tMonth !== currentMonth) return false;
      // Count transactions that are "fixed" (recurring or forecast)
      return (t.is_recurring || t.is_forecast) && t.amount < 0;
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  // Calculate committed allocations (projects monthly + any savings goals)
  const committed_allocations = projects
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + Number(p.monthly_allocation), 0);

  const safe_to_spend = Math.max(0, current_checking_balance - remaining_fixed_expenses - committed_allocations);

  // =====================================================================
  // STEP 2: Variable Expense Trend
  // =====================================================================
  // Get last 3 months dates
  const lastThreeMonths: Array<{ year: number; month: number }> = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - 1 - i, 1);
    lastThreeMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const variable_expenses_3m_list = transactions
    .filter(t => {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      const category = t.category?.name?.toLowerCase() || '';
      // Variable category expenses
      if (category.includes('variable') || category.includes('consumption') || category.includes('shopping')) {
        return lastThreeMonths.some(m => m.year === tYear && m.month === tMonth && t.amount < 0);
      }
      return false;
    })
    .map(t => Math.abs(Number(t.amount)));

  const avg_variable_expenses_3m = variable_expenses_3m_list.length > 0 ? variable_expenses_3m_list.reduce((a, b) => a + b) / 3 : 0;

  const current_month_variable = transactions
    .filter(t => {
      const [tYear, tMonth] = t.date.split('-').map(Number);
      const category = t.category?.name?.toLowerCase() || '';
      if (category.includes('variable') || category.includes('consumption') || category.includes('shopping')) {
        return tYear === currentYear && tMonth === currentMonth && t.amount < 0;
      }
      return false;
    })
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

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
    .map(p => ({
      id: p.id,
      name: p.name,
      target_amount: Number(p.target_amount),
      monthly_allocation: Number(p.monthly_allocation),
      progress_percentage: sum_all_project_targets > 0 ? (available_savings / Number(p.target_amount)) * 100 : 0,
      status: p.status,
    }));

  const global_projects_percentage = sum_all_project_targets > 0 ? (available_savings / sum_all_project_targets) * 100 : 0;

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
