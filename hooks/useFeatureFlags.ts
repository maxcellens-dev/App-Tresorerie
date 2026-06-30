/**
 * Drapeaux de fonctionnalités globaux (admin) — stockés dans app_config.features.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface FeatureFlags {
  monthly_closure_enabled?: boolean;
  /** Offre Premium active (sinon : tout le monde gratuit, pas d'UI premium). */
  premium_enabled?: boolean;
  /** Zone de publicités active (sinon : aucune pub affichée). */
  ads_enabled?: boolean;
  /** Page Reporting accessible aux utilisateurs (sinon : masquée du menu). */
  reporting_enabled?: boolean;
  /** Page Conseils IA accessible (gate Premium + flag ai_open_to_all dans ai_config). */
  ai_advice_enabled?: boolean;
  /** Messages contextuels sous les recommandations (projection invest, économie…). Défaut : activé. */
  reco_context_enabled?: boolean;
  /** Dernière version publiée sur le store (ex. "1.0.2"). Si > version installée → bandeau « mise à jour ». */
  latest_version?: string;
  /** Version minimale requise (ex. "1.0.1"). Si > version installée → mise à jour OBLIGATOIRE (bandeau non fermable). */
  min_version?: string;
  /** URL du store pour la mise à jour (sinon : fiche Play par défaut depuis le package Android). */
  update_url_android?: string;
  update_url_ios?: string;
  /**
   * Partage de comptes PERSO (inviter un autre user en consultation/écriture sur un compte perso).
   * Ne concerne PAS les comptes joints dédiés (toujours actifs). Global, géré en admin.
   * OFF (Soft) : on masque le bouton « Partager » et le serveur refuse les NOUVELLES invitations sur
   * un compte perso ; les partages déjà créés continuent de fonctionner. Aucune donnée touchée.
   */
  perso_account_sharing_enabled?: boolean;
  /** Bouton de saisie rapide (« + ») actif. Défaut : activé. */
  quick_add_enabled?: boolean;
  /**
   * Mode d'affichage du bouton de saisie rapide :
   * - 'tabbar' (défaut) : gros bouton surélevé dans la barre d'onglets (position réglable par user) ;
   * - 'bubble' : bulle volante sur le seul écran Pilotage, en bas à droite (l'user peut juste l'afficher/masquer).
   */
  quick_add_mode?: 'tabbar' | 'bubble';
}

const KEY = 'feature_flags';

export function useFeatureFlags() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<FeatureFlags> => {
      if (!supabase) return {};
      const { data } = await supabase.from('app_config').select('features').eq('id', 'default').single();
      return (((data as any)?.features) ?? {}) as FeatureFlags;
    },
    // Flags = visibilité de fonctionnalités : on veut une propagation quasi immédiate quand l'admin
    // active/désactive (sans attendre). Cache court + refetch au retour sur l'app.
    staleTime: 20 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

export function useSaveFeatureFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<FeatureFlags>) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data } = await supabase.from('app_config').select('features').eq('id', 'default').single();
      const prev = (((data as any)?.features) ?? {}) as FeatureFlags;
      const merged = { ...prev, ...patch };
      const { error } = await supabase.from('app_config').update({ features: merged, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
