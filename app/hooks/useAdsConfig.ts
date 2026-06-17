/**
 * Config des publicités « maison » (app_config.ads), éditable en admin.
 * Une bannière = image OU texte, optionnellement cliquable (url).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Emplacements de pub, regroupés par page (`group`) pour une sélection compacte en admin.
 * `label` = description courte de la position dans la page.
 */
export const AD_PLACEMENTS = [
  { value: 'comptes',            group: 'Comptes',      label: 'Bas de page' },
  { value: 'comptes_actions',    group: 'Comptes',      label: 'À côté des actions' },
  { value: 'transactions',       group: 'Transactions', label: 'Bas de page' },
  { value: 'transactions_mois',  group: 'Transactions', label: 'Entre 2 mois' },
  { value: 'pilotage',           group: 'Pilotage',     label: 'Bas de page' },
  { value: 'pilotage_suivi',     group: 'Pilotage',     label: 'Avant « Suivi du mois »' },
  { value: 'projets',            group: 'Projets',      label: 'Bas de page' },
  { value: 'projets_perso',      group: 'Projets',      label: 'Avant « Projets personnels »' },
  { value: 'projection',         group: 'Projection',   label: 'Bas de page' },
  { value: 'projection_mois',    group: 'Projection',   label: 'Entre 2 mois' },
  { value: 'projection_invest',  group: 'Projection',   label: 'Avant « Détail année par année »' },
] as const;
export type AdPlacement = typeof AD_PLACEMENTS[number]['value'];

export interface AdBanner {
  id: string;
  label?: string;   // titre interne
  text?: string;    // texte affiché (si pas d'image)
  image?: string;   // URL image bannière
  url?: string;     // lien au clic (optionnel)
  /** Pages où afficher la bannière (une même bannière peut viser plusieurs pages). */
  placements?: AdPlacement[];
  /** @deprecated Ancien champ mono-page — conservé pour rétrocompat (lu via bannerPlacements). */
  placement?: AdPlacement;
}

/** Pages ciblées par une bannière (gère la rétrocompat mono-page → liste). */
export function bannerPlacements(b: AdBanner): AdPlacement[] {
  if (b.placements && b.placements.length > 0) return b.placements;
  return [b.placement ?? 'pilotage'];
}
export interface AdsConfig {
  banners: AdBanner[];
  /** Durée d'affichage (secondes) avant le fondu vers la bannière suivante d'un même emplacement. */
  rotation_seconds?: number;
}

const KEY = 'ads_config';

export function useAdsConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<AdsConfig> => {
      if (!supabase) return { banners: [] };
      const { data } = await supabase.from('app_config').select('ads').eq('id', 'default').maybeSingle();
      const ads = (data as any)?.ads as AdsConfig | undefined;
      return { banners: ads?.banners ?? [], rotation_seconds: ads?.rotation_seconds ?? 6 };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveAdsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: AdsConfig) => {
      if (!supabase) throw new Error('Supabase non configuré');
      const { error } = await supabase.from('app_config').update({ ads: config, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return config;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
