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
      /* Exceptions « cette échéance uniquement » (migration 163). `undefined` = on ne touche pas au
         champ ; `null` = on RETIRE l'exception (retour à la valeur de la série). */
      override_note?: string | null;
      override_category_id?: string | null;
      override_account_id?: string | null;
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
          ...(input.override_note !== undefined ? { override_note: input.override_note } : {}),
          ...(input.override_category_id !== undefined ? { override_category_id: input.override_category_id } : {}),
          ...(input.override_account_id !== undefined ? { override_account_id: input.override_account_id } : {}),
        }, {
          // La table est unique sur (transaction_id, year, month) — sans onConflict, l'upsert résout
          // sur la PK id et toute RE-modification d'une échéance déjà overridée partait en violation
          // d'unicité (« Impossible d'enregistrer »).
          onConflict: 'transaction_id,year,month',
        })
        .select()
        .single();
      // PostgrestError n'est pas une instance d'Error → on wrappe pour que l'UI affiche le vrai message.
      if (error) throw new Error(error.message || "Impossible d'enregistrer l'échéance.");
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
      if (error) throw new Error(error.message || "Impossible de retirer l'échéance modifiée.");
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY] });
      client.invalidateQueries({ queryKey: ['transactions', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
