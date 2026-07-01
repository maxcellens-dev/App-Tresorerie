// Module Crédit — CRUD des crédits. Le tableau d'amortissement / CRD est calculé côté client
// (lib/amortization.ts) à partir des paramètres stockés ici.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Credit } from '../types/database';

const KEY = 'credits';

const mapCredit = (r: any): Credit => ({
  ...r,
  principal: Number(r.principal),
  duration_months: Number(r.duration_months),
  rate_annual: Number(r.rate_annual),
  insurance_monthly: r.insurance_monthly != null ? Number(r.insurance_monthly) : 0,
  fees_file: r.fees_file != null ? Number(r.fees_file) : 0,
  fees_guarantee: r.fees_guarantee != null ? Number(r.fees_guarantee) : 0,
  fees_bank: r.fees_bank != null ? Number(r.fees_bank) : 0,
  fees_notary: r.fees_notary != null ? Number(r.fees_notary) : 0,
  personal_contribution: r.personal_contribution != null ? Number(r.personal_contribution) : 0,
  interim_interest: r.interim_interest != null ? Number(r.interim_interest) : 0,
  management_fees: r.management_fees != null ? Number(r.management_fees) : 0,
  other_fees: r.other_fees != null ? Number(r.other_fees) : 0,
  interest_total_manual: r.interest_total_manual != null ? Number(r.interest_total_manual) : null,
  insurance_yearly: Array.isArray(r.insurance_yearly) ? r.insurance_yearly : null,
  payment_yearly: Array.isArray(r.payment_yearly) ? r.payment_yearly : null,
  payment_paliers: Array.isArray(r.payment_paliers) ? r.payment_paliers : null,
  insurance_paliers: Array.isArray(r.insurance_paliers) ? r.insurance_paliers : null,
  schedule_overrides: r.schedule_overrides && typeof r.schedule_overrides === 'object' ? r.schedule_overrides : null,
  early_repayment_penalty_pct: r.early_repayment_penalty_pct != null ? Number(r.early_repayment_penalty_pct) : 0,
  deferral_months: r.deferral_months != null ? Number(r.deferral_months) : 0,
});

export function useCredits(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    enabled: !!profileId,
    queryFn: async (): Promise<Credit[]> => {
      if (!supabase || !profileId) return [];
      // Mes crédits + les crédits PARTAGÉS reçus (où je suis membre). `_role` = owner / write / read.
      const CAT_JOIN = '*, category:categories!category_id(id, name, is_variable, parent_id), insurance_category:categories!insurance_category_id(id, name, is_variable, parent_id)';
      const ownP = supabase.from('credits').select(CAT_JOIN).eq('profile_id', profileId).order('created_at', { ascending: false });
      const memP = supabase.from('credit_members').select('credit_id, role').eq('user_id', profileId);
      const [{ data: own, error: ownErr }, memRes] = await Promise.all([ownP, memP]);
      if (ownErr) throw ownErr;
      const roleById: Record<string, string> = {};
      const memberIds: string[] = [];
      for (const m of (memRes?.data ?? []) as any[]) { roleById[m.credit_id] = m.role; memberIds.push(m.credit_id); }
      let memberCredits: any[] = [];
      if (memberIds.length > 0) {
        const { data } = await supabase.from('credits').select(CAT_JOIN).in('id', memberIds);
        memberCredits = (data ?? []).filter((c: any) => c.profile_id !== profileId);
      }
      const map = (r: any): Credit => ({ ...mapCredit(r), _role: r.profile_id === profileId ? 'owner' : ((roleById[r.id] as any) ?? 'read') });
      return [...(own ?? []).map(map), ...memberCredits.map(map)];
    },
  });
}

export type CreditInput = Partial<Omit<Credit, 'id' | 'profile_id' | 'created_at' | 'updated_at'>> & {
  label: string; type: Credit['type']; principal: number; duration_months: number; start_date: string;
};

export function useAddCredit(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreditInput) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data, error } = await supabase.from('credits').insert({ profile_id: profileId, ...input }).select().single();
      if (error) throw new Error(error.message);
      return mapCredit(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateCredit(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Credit> & { id: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { id, ...patch } = input;
      const { error } = await supabase.from('credits').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteCredit(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('credits').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
