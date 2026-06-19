import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { FinancialProfile, Profile, UiPrefs } from '../types/database';

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
        .maybeSingle();
      // IMPORTANT : ne PAS confondre « échec de lecture » et « profil absent ».
      // Juste après une reconnexion, le token peut ne pas être encore propagé → le SELECT
      // échoue. En renvoyant null on enverrait à tort l'utilisateur vers /setup (questionnaire).
      // On relance donc l'erreur : react-query réessaie et expose isError (≠ data null).
      if (error) throw error;
      if (!data) return null; // aucune ligne → profil réellement inexistant (nouvel utilisateur)

      const financial_profile = (data as { financial_profile?: FinancialProfile }).financial_profile ?? 'suivi';
      const defaultAlloc = DEFAULT_ALLOCATIONS[financial_profile];
      const safetyMargin = (data as { safety_margin_percent?: number }).safety_margin_percent;
      const safetyAmount = (data as { safety_margin_amount?: number }).safety_margin_amount;
      const save = (data as { allocation_save_percent?: number }).allocation_save_percent;
      const invest = (data as { allocation_invest_percent?: number }).allocation_invest_percent;
      const enjoy = (data as { allocation_enjoy_percent?: number }).allocation_enjoy_percent;
      const keep = (data as { allocation_keep_percent?: number }).allocation_keep_percent;

      return {
        ...(data as Record<string, unknown>),
        id: data.id,
        email: data.email ?? null,
        full_name: data.full_name ?? null,
        avatar_url: (data as { avatar_url?: string | null }).avatar_url ?? null,
        is_admin: Boolean((data as { is_admin?: boolean }).is_admin),
        safety_margin_percent: safetyMargin !== undefined && safetyMargin !== null ? Number(safetyMargin) : 10,
        safety_margin_amount: safetyAmount !== undefined && safetyAmount !== null ? Number(safetyAmount) : 0,
        weekly_variable_budget: (data as { weekly_variable_budget?: number | null }).weekly_variable_budget != null
          ? Number((data as { weekly_variable_budget?: number }).weekly_variable_budget) : undefined,
        financial_profile,
        allocation_save_percent: save !== undefined && save !== null ? Number(save) : defaultAlloc.save,
        allocation_invest_percent: invest !== undefined && invest !== null ? Number(invest) : defaultAlloc.invest,
        allocation_enjoy_percent: enjoy !== undefined && enjoy !== null ? Number(enjoy) : defaultAlloc.enjoy,
        allocation_keep_percent: keep !== undefined && keep !== null ? Number(keep) : defaultAlloc.keep,
        initial_onboarding_completed: Boolean((data as { initial_onboarding_completed?: boolean }).initial_onboarding_completed),
        financial_profile_questionnaire_completed: Boolean((data as { financial_profile_questionnaire_completed?: boolean }).financial_profile_questionnaire_completed),
        theme_mode: ((data as { theme_mode?: string }).theme_mode ?? 'dark') as 'dark' | 'light',
        theme_preset: ((data as { theme_preset?: string }).theme_preset ?? 'emerald') as any,
        currency_code: (data as { currency_code?: string }).currency_code ?? 'EUR',
        notifications_enabled: (data as { notifications_enabled?: boolean }).notifications_enabled ?? true,
        equipped_cosmetics: (data as { equipped_cosmetics?: Record<string, string> }).equipped_cosmetics ?? {},
        ui_prefs: ((data as { ui_prefs?: UiPrefs }).ui_prefs ?? {}) as UiPrefs,
      } as Profile;
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
      safety_margin_amount?: number;
      weekly_variable_budget?: number | null;
      financial_profile?: FinancialProfile;
      allocation_save_percent?: number;
      allocation_invest_percent?: number;
      allocation_enjoy_percent?: number;
      allocation_keep_percent?: number;
      initial_onboarding_completed?: boolean;
      theme_mode?: 'dark' | 'light';
      theme_preset?: string;
      currency_code?: string;
      treso_simplified?: boolean;
      prudence_level?: number | null;
      notifications_enabled?: boolean;
      equipped_cosmetics?: Record<string, string>;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');

      // Construire un payload propre : uniquement les champs réellement fournis.
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.full_name !== undefined) updates.full_name = payload.full_name;
      if (payload.avatar_url !== undefined) updates.avatar_url = payload.avatar_url;
      if (payload.safety_margin_percent !== undefined) updates.safety_margin_percent = payload.safety_margin_percent;
      if (payload.financial_profile !== undefined) updates.financial_profile = payload.financial_profile;
      if (payload.allocation_save_percent !== undefined) updates.allocation_save_percent = payload.allocation_save_percent;
      if (payload.allocation_invest_percent !== undefined) updates.allocation_invest_percent = payload.allocation_invest_percent;
      if (payload.allocation_enjoy_percent !== undefined) updates.allocation_enjoy_percent = payload.allocation_enjoy_percent;
      if (payload.allocation_keep_percent !== undefined) updates.allocation_keep_percent = payload.allocation_keep_percent;
      if (payload.initial_onboarding_completed !== undefined) updates.initial_onboarding_completed = payload.initial_onboarding_completed;
      if (payload.theme_mode !== undefined) updates.theme_mode = payload.theme_mode;
      if (payload.theme_preset !== undefined) updates.theme_preset = payload.theme_preset;
      if (payload.weekly_variable_budget !== undefined) updates.weekly_variable_budget = payload.weekly_variable_budget;
      if (payload.currency_code !== undefined) updates.currency_code = payload.currency_code;
      if (payload.treso_simplified !== undefined) updates.treso_simplified = payload.treso_simplified;
      if (payload.prudence_level !== undefined) updates.prudence_level = payload.prudence_level;
      if (payload.notifications_enabled !== undefined) updates.notifications_enabled = payload.notifications_enabled;
      if (payload.equipped_cosmetics !== undefined) updates.equipped_cosmetics = payload.equipped_cosmetics;

      // Séparer safety_margin_amount pour éviter qu'un échec (colonne manquante avant
      // migration 031) ne bloque les autres mises à jour.
      const safetyAmount = payload.safety_margin_amount;
      const otherUpdates = { ...updates };

      const { error } = await supabase
        .from('profiles')
        .update(otherUpdates)
        .eq('id', profileId);
      if (error) {
        console.error('[useUpdateProfile] PATCH profiles échoué:', { error, updates: otherUpdates });
        throw error;
      }

      if (safetyAmount !== undefined) {
        // 1. Mettre à jour profiles.safety_margin_amount
        const { error: safetyErr } = await supabase
          .from('profiles')
          .update({ safety_margin_amount: safetyAmount })
          .eq('id', profileId);
        if (safetyErr) {
          console.warn('[useUpdateProfile] safety_margin_amount échoué (migration 031 requise ?):', safetyErr);
        }

        // 2. Synchroniser user_questionnaire_answers.q8 (la valeur numérique en chaîne)
        const { error: q8Err } = await supabase
          .from('user_questionnaire_answers')
          .update({ q8: String(safetyAmount), updated_at: new Date().toISOString() })
          .eq('user_id', profileId);
        if (q8Err) {
          console.warn('[useUpdateProfile] sync q8 échoué:', q8Err);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, profileId] });
      queryClient.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      queryClient.invalidateQueries({ queryKey: ['questionnaire_answers', profileId] });
    },
  });
}
