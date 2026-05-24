import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { FinancialProfile, Profile } from '../types/database';

const KEY = 'profile';

const DEFAULT_ALLOCATIONS: Record<FinancialProfile, { save: number; invest: number; enjoy: number; keep: number }> = {
  economiser: { save: 55, invest: 5, enjoy: 15, keep: 25 },
  suivi: { save: 30, invest: 15, enjoy: 25, keep: 30 },
  optimiser: { save: 25, invest: 30, enjoy: 25, keep: 20 },
  investir: { save: 15, invest: 45, enjoy: 20, keep: 20 },
};

export function useProfile(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Profile | null> => {
      if (!supabase || !profileId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      if (error || !data) return null;

      const financial_profile = (data as { financial_profile?: FinancialProfile }).financial_profile ?? 'suivi';
      const defaultAlloc = DEFAULT_ALLOCATIONS[financial_profile];
      const safetyMargin = (data as { safety_margin_percent?: number }).safety_margin_percent;
      const save = (data as { allocation_save_percent?: number }).allocation_save_percent;
      const invest = (data as { allocation_invest_percent?: number }).allocation_invest_percent;
      const enjoy = (data as { allocation_enjoy_percent?: number }).allocation_enjoy_percent;
      const keep = (data as { allocation_keep_percent?: number }).allocation_keep_percent;

      return {
        id: data.id,
        email: data.email ?? null,
        full_name: data.full_name ?? null,
        avatar_url: (data as { avatar_url?: string | null }).avatar_url ?? null,
        is_admin: Boolean((data as { is_admin?: boolean }).is_admin),
        safety_margin_percent: safetyMargin !== undefined && safetyMargin !== null ? Number(safetyMargin) : 10,
        financial_profile,
        allocation_save_percent: save !== undefined && save !== null ? Number(save) : defaultAlloc.save,
        allocation_invest_percent: invest !== undefined && invest !== null ? Number(invest) : defaultAlloc.invest,
        allocation_enjoy_percent: enjoy !== undefined && enjoy !== null ? Number(enjoy) : defaultAlloc.enjoy,
        allocation_keep_percent: keep !== undefined && keep !== null ? Number(keep) : defaultAlloc.keep,
        initial_onboarding_completed: Boolean((data as { initial_onboarding_completed?: boolean }).initial_onboarding_completed),
      };
    },
    enabled: !!profileId,
  });
}

export function useUpdateProfile(profileId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      full_name?: string | null;
      avatar_url?: string | null;
      safety_margin_percent?: number;
      financial_profile?: FinancialProfile;
      allocation_save_percent?: number;
      allocation_invest_percent?: number;
      allocation_enjoy_percent?: number;
      allocation_keep_percent?: number;
      initial_onboarding_completed?: boolean;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: payload.full_name ?? undefined,
          avatar_url: payload.avatar_url ?? undefined,
          ...(payload.safety_margin_percent !== undefined && { safety_margin_percent: payload.safety_margin_percent }),
          ...(payload.financial_profile !== undefined && { financial_profile: payload.financial_profile }),
          ...(payload.allocation_save_percent !== undefined && { allocation_save_percent: payload.allocation_save_percent }),
          ...(payload.allocation_invest_percent !== undefined && { allocation_invest_percent: payload.allocation_invest_percent }),
          ...(payload.allocation_enjoy_percent !== undefined && { allocation_enjoy_percent: payload.allocation_enjoy_percent }),
          ...(payload.allocation_keep_percent !== undefined && { allocation_keep_percent: payload.allocation_keep_percent }),
          ...(payload.initial_onboarding_completed !== undefined && { initial_onboarding_completed: payload.initial_onboarding_completed }),
          updated_at: new Date().toISOString(),
        })
        .eq('id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, profileId] });
    },
  });
}
