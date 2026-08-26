/**
 * Plan utilisateur (gratuit / premium).
 * - premiumEnabled : l'offre Premium est activée globalement (admin).
 * - isPremium : l'utilisateur a le droit Premium ET l'offre est active.
 * Le droit (profiles.is_premium) sera alimenté par l'intégration de paiement (RevenueCat…).
 */
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useFeatureFlags } from './useFeatureFlags';
import { useProfile } from '../data/useProfile';

/**
 * Définit/retire le droit Premium — RÉSERVÉ AUX ADMINISTRATEURS depuis la migration 203.
 *
 * `profiles.is_premium` est verrouillé en base : un déclencheur remet la colonne à sa valeur
 * précédente pour tout appelant qui n'est ni administrateur ni le serveur. C'est volontaire —
 * l'app parle directement à la base avec le jeton de son utilisateur, donc tout ce qu'elle peut
 * écrire, l'utilisateur peut l'écrire à la main : le Premium s'offrait en une requête.
 *
 * L'activation après un ACHAT ne passe donc plus par ici : c'est le webhook RevenueCat
 * (`supabase/functions/revenuecat-webhook`) qui la pose côté serveur. Le client se contente
 * d'attendre et de relire — cf. `useAwaitPremiumFromServer`.
 */
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

/**
 * Attend que le SERVEUR ait posé (ou retiré) le droit Premium, puis rafraîchit l'écran.
 *
 * Après un achat, RevenueCat prévient notre webhook, qui écrit `is_premium`. Cela prend une à
 * quelques secondes : on relit le profil plusieurs fois plutôt que d'annoncer un état qu'on ne
 * ferait que supposer. Rend `true` dès que le serveur confirme, `false` si rien n'est venu dans le
 * délai — l'écran peut alors le dire au lieu de laisser croire à un abonnement actif.
 */
export function useAwaitPremiumFromServer(userId: string | undefined) {
  const qc = useQueryClient();
  return useCallback(async (expected: boolean, attempts = 6): Promise<boolean> => {
    if (!userId) return false;
    for (let i = 0; i < attempts; i++) {
      await qc.invalidateQueries({ queryKey: ['profile', userId] });
      const profile = qc.getQueryData<any>(['profile', userId]);
      if (!!profile?.is_premium === expected) return true;
      // Le webhook arrive vite, mais pas instantanément : on laisse le temps à l'aller-retour
      // store → RevenueCat → notre fonction → base. Pas d'attente après la DERNIÈRE tentative :
      // c'étaient deux secondes d'indicateur tournant de plus pour une réponse déjà connue.
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }, [qc, userId]);
}

export function usePlan(userId: string | undefined) {
  const flagsQuery = useFeatureFlags();
  const profileQuery = useProfile(userId);
  const flags = flagsQuery.data;
  const profile = profileQuery.data;
  const premiumEnabled = !!flags?.premium_enabled;
  const hasEntitlement = !!(profile as any)?.is_premium;
  const isPremium = premiumEnabled && hasEntitlement;
  return {
    premiumEnabled,
    isPremium,
    /**
     * Le DROIT Premium du compte, indépendamment de l'activation globale de l'offre.
     *
     * À utiliser dès qu'on RETIRE quelque chose à l'utilisateur (remettre une couleur d'accent par
     * défaut, par exemple) : `isPremium` tombe aussi quand l'administrateur désactive l'offre pour
     * tout le monde, et on effacerait alors le réglage d'abonnés parfaitement à jour. Pour
     * simplement masquer une fonctionnalité, `isPremium` reste le bon test.
     */
    hasEntitlement,
    /**
     * Le plan est-il CONNU, ou seulement supposé ?
     *
     * Tant que les drapeaux et le profil ne sont pas revenus, `isPremium` vaut `false` — la valeur
     * par défaut, pas une réponse. Un écran qui refuse l'accès sur cette base affiche le mur
     * « réservé aux abonnés Premium » à un abonné, pendant tout le premier chargement. Un écran qui
     * BLOQUE doit donc attendre `isResolved` ; un écran qui se contente d'adapter son affichage
     * (badge, publicité) peut s'en passer.
     */
    isResolved: flagsQuery.isSuccess && profileQuery.isSuccess,
    /**
     * Une des deux lectures a ÉCHOUÉ. Indispensable à qui affiche une attente sur `isResolved` :
     * un chargement qui a échoué n'est pas un chargement en cours, et un cercle qui tourne pour
     * toujours ne dit rien et n'offre aucun recours (même règle que le Reporting).
     */
    hasFailed: flagsQuery.isError || profileQuery.isError,
    /** Relance les deux lectures — à câbler sur un bouton « Réessayer ». */
    retry: () => { void flagsQuery.refetch(); void profileQuery.refetch(); },
    plan: isPremium ? ('premium' as const) : ('free' as const),
    /* Les publicités font partie de l'offre gratuite : elles s'affichent pour tout utilisateur
       non-premium. Le CONTENU (bannières maison) se gère dans l'admin « Publicités » — n'en
       publier aucune suffit à n'en montrer aucune, sans interrupteur supplémentaire. */
    showAds: !isPremium,
  };
}
