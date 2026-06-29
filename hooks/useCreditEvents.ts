// Module Crédit — événements (C5) : remboursement anticipé, changement de taux, modulation, frais, pénalité.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { CreditEvent as AmortEvent } from '../lib/amortization';

export interface CreditEventRow extends AmortEvent {
  id: string;
  credit_id: string;
  note?: string | null;
}

const map = (r: any): CreditEventRow => ({
  id: r.id, credit_id: r.credit_id, date: r.date, kind: r.kind,
  amount: r.amount != null ? Number(r.amount) : null,
  new_rate: r.new_rate != null ? Number(r.new_rate) : null,
  new_payment: r.new_payment != null ? Number(r.new_payment) : null,
  note: r.note ?? null,
});

/** Événements d'UN crédit (écran détail). */
export function useCreditEvents(creditId: string | undefined) {
  return useQuery({
    queryKey: ['credit_events', creditId],
    enabled: !!creditId,
    queryFn: async (): Promise<CreditEventRow[]> => {
      if (!supabase || !creditId) return [];
      const { data, error } = await supabase.from('credit_events').select('*').eq('credit_id', creditId).order('date');
      if (error) throw error;
      return (data ?? []).map(map);
    },
  });
}

/** TOUS mes événements (pour que les flux tréso/projection reflètent les remboursements anticipés, etc.). */
export function useAllCreditEvents(profileId: string | undefined) {
  return useQuery({
    queryKey: ['credit_events_all', profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Record<string, CreditEventRow[]>> => {
      if (!supabase || !profileId) return {};
      const { data, error } = await supabase.from('credit_events').select('*').eq('profile_id', profileId).order('date');
      if (error) throw error;
      const byCredit: Record<string, CreditEventRow[]> = {};
      for (const r of (data ?? [])) (byCredit[r.credit_id] ??= []).push(map(r));
      return byCredit;
    },
  });
}

export function useAddCreditEvent(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { credit_id: string; date: string; kind: CreditEventRow['kind']; amount?: number | null; new_rate?: number | null; new_payment?: number | null; note?: string | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase.from('credit_events').insert({ profile_id: profileId, ...input });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['credit_events', v.credit_id] });
      qc.invalidateQueries({ queryKey: ['credit_events_all', profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteCreditEvent(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; credit_id: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('credit_events').delete().eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['credit_events', v.credit_id] });
      qc.invalidateQueries({ queryKey: ['credit_events_all', profileId] });
    },
  });
}
