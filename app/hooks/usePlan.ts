/**
 * Plan utilisateur (gratuit / premium).
 * - premiumEnabled : l'offre Premium est activée globalement (admin).
 * - isPremium : l'utilisateur a le droit Premium ET l'offre est active.
 * Le droit (profiles.is_premium) sera alimenté par l'intégration de paiement (RevenueCat…).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useFeatureFlags } from './useFeatureFlags';
import { useProfile } from './useProfile';

/** Définit/retire le droit Premium d'un utilisateur (usage admin/test ; sinon via paiement). */
export function useSetPremium(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: boolean) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase.from('profiles').update({ is_premium: value }).eq('id', userId);
      if (error) throw error;
      return value;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile', userId] }); },
  });
}

export function usePlan(userId: string | undefined) {
  const { data: flags } = useFeatureFlags();
  const { data: profile } = useProfile(userId);
  const premiumEnabled = !!flags?.premium_enabled;
  const adsEnabled = !!flags?.ads_enabled;
  const hasEntitlement = !!(profile as any)?.is_premium;
  const isPremium = premiumEnabled && hasEntitlement;
  return {
    premiumEnabled,
    adsEnabled,
    isPremium,
    plan: isPremium ? ('premium' as const) : ('free' as const),
    /** Pubs visibles : activées globalement ET utilisateur non-premium. */
    showAds: adsEnabled && !isPremium,
  };
}
