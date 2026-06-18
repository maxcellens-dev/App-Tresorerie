import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Transaction } from '../types/database';

const KEY = 'accountTransactionsByYear';

export function useAccountTransactionsByYear(
  accountId: string | undefined,
  year: number = new Date().getFullYear()
) {
  return useQuery({
    queryKey: [KEY, accountId, year],
    queryFn: async (): Promise<Transaction[]> => {
      if (!supabase || !accountId) return [];
      
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('account_id', accountId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        ...t,
        amount: Number(t.amount),
      }));
    },
    enabled: !!accountId,
  });
}

// Calculate total for year from transactions
export function calculateYearlyTotal(transactions: Transaction[]): number {
  return transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
}

// Calculate progression percentage
export function calculateProgressPercentage(
  currentAmount: number,
  targetAmount: number
): number {
  if (targetAmount <= 0) return 0;
  return Math.min(100, Math.round((currentAmount / targetAmount) * 100));
}
