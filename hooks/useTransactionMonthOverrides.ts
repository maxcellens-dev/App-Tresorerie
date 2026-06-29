import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TransactionMonthOverride } from '../types/database';

const KEY = 'transaction_month_overrides';

export function useTransactionMonthOverrides(profileId: string | undefined, year?: number, month?: number) {
  const query = useQuery({
    queryKey: [KEY, profileId, year, month],
    queryFn: async (): Promise<TransactionMonthOverride[]> => {
      if (!supabase || !profileId) return [];
      let q = supabase.from('transaction_month_overrides').select('*').eq('profile_id', profileId);
      if (year !== undefined) q = q.eq('year', year);
      if (month !== undefined) q = q.eq('month', month);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        override_amount: r.override_amount == null ? null : Number(r.override_amount),
      }));
    },
    enabled: !!profileId,
  });
  return query;
}

export function useSetTransactionMonthOverride(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      transaction_id: string;
      year: number;
      month: number;
      override_amount?: number | null;
      /** #2 — déplace l'occurrence de CE mois à une autre date (ISO), sans toucher la série. */
      override_date?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data, error } = await supabase
        .from('transaction_month_overrides')
        .upsert({
          profile_id: profileId,
          transaction_id: input.transaction_id,
          year: input.year,
          month: input.month,
          ...(input.override_amount !== undefined ? { override_amount: input.override_amount } : {}),
          ...(input.override_date !== undefined ? { override_date: input.override_date } : {}),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY] });
      client.invalidateQueries({ queryKey: ['transactions', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteTransactionMonthOverride(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { transaction_id: string; year: number; month: number }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('transaction_month_overrides')
        .delete()
        .eq('transaction_id', input.transaction_id)
        .eq('year', input.year)
        .eq('month', input.month);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY] });
      client.invalidateQueries({ queryKey: ['transactions', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
