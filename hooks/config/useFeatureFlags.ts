/**
 * Drapeaux de fonctionnalités globaux (admin) — stockés dans app_config.features.
 *
 * ⚠️ UN DRAPEAU EST UN INTERRUPTEUR EN ATTENTE DE DÉCISION, pas un réglage permanent. Une fois la
 * fonctionnalité en place et gardée, il ne sert plus qu'à entretenir un chemin de code mort — et,
 * pire, à laisser dériver les valeurs par défaut : `reporting_enabled` était lu « faux par défaut »
 * dans le menu de profil et « vrai par défaut » dans la navigation web, si bien que la page
 * Reporting pouvait être visible d'un côté et masquée de l'autre pour le même utilisateur.
 *
 * Retirés parce qu'acquis : `ads_enabled`, `reporting_enabled`, `reco_context_enabled`,
 * `quick_add_enabled`, `quick_add_mode`. Également retiré : `ai_advice_enabled`, qui était DÉCLARÉ
 * ici mais lu NULLE PART (aucun écran, aucun interrupteur admin) — un drapeau fantôme laisse croire
 * qu'on peut couper la page Conseils IA, alors que son accès dépend uniquement de Premium et de
 * `ai_config.open_to_all`. Les clés correspondantes peuvent rester dans `app_config.features` :
 * plus personne ne les lit.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';

export interface FeatureFlags {
  monthly_closure_enabled?: boolean;
  /** Offre Premium active (sinon : tout le monde gratuit, pas d'UI premium). */
  premium_enabled?: boolean;
  /** Dernière version publiée sur le store (ex. "1.0.2"). Si > version installée → bandeau « mise à jour ». */
  latest_version?: string;
  /** Version minimale requise (ex. "1.0.1"). Si > version installée → mise à jour OBLIGATOIRE (bandeau non fermable). */
  min_version?: string;
  /** URL du store pour la mise à jour (sinon : fiche Play par défaut depuis le package Android). */
  update_url_android?: string;
  update_url_ios?: string;
  /**
   * Section « À propos » de la page Support. Réglages PERMANENTS (pas des interrupteurs) : ils
   * vivent ici parce que les liens store de la mise à jour y sont déjà, et qu'une colonne dédiée
   * dans `app_config` imposerait une migration pour trois URL. Édités dans Admin › Mise à jour.
   *
   * « Noter l'application » : lien volontairement SÉPARÉ de `update_url_*` — on peut vouloir
   * envoyer vers la page d'avis (`?action=write-review` sur iOS) plutôt que vers la fiche.
   * Vide sur Android/web → repli sur la fiche Play. Vide sur iOS → la ligne est masquée.
   */
  about_rate_url_android?: string;
  about_rate_url_ios?: string;
  /** « Nous suivre sur Instagram ». Vide → la ligne n'apparaît pas. */
  about_instagram_url?: string;
  /**
   * Partage de comptes PERSO (inviter un autre user en consultation/écriture sur un compte perso).
   * Ne concerne PAS les comptes joints dédiés (toujours actifs). Global, géré en admin.
   * OFF (Soft) : on masque le bouton « Partager » et le serveur refuse les NOUVELLES invitations sur
   * un compte perso ; les partages déjà créés continuent de fonctionner. Aucune donnée touchée.
   */
  perso_account_sharing_enabled?: boolean;
  /** Vitesse de défilement du bandeau « Conseils » sur le Pilotage (secondes entre 2 conseils). Défaut 8. */
  conseils_rotation_seconds?: number;
  /**
   * COUPURE GLOBALE (kill switch, Centre de sécurité). Quand `true`, l'app est verrouillée pour TOUS
   * les utilisateurs (sauf admins) : voile plein écran, aucune interaction. À activer en cas
   * d'attaque/piratage en cours, à désactiver pour rouvrir. Propagé en temps réel (useAppLockdown).
   */
  app_lockdown_enabled?: boolean;
  /** Titre affiché sur le voile de coupure (optionnel). */
  app_lockdown_title?: string;
  /** Message affiché sur le voile de coupure (optionnel). */
  app_lockdown_message?: string;
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
