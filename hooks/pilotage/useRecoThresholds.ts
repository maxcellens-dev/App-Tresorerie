import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { RecommendationSettings } from '../../types/database';
import { DEFAULT_AUTO_PROFILE_MAP } from '../../lib/finance/recommendationEngine';

const KEY = 'recommendation_settings';

/** Seuils par défaut (si la table n'est pas encore disponible). */
export const DEFAULT_RECO_THRESHOLDS: RecommendationSettings = {
  id: 'default',
  seuil_reco_epargne: 50,
  seuil_reco_invest: 100,
  seuil_reco_plaisir: 50,
  seuil_reco_conserver: 50,
  consumption_orders: {
    prudent:   ['enjoy', 'invest', 'save', 'keep'],
    equilibre: ['enjoy', 'invest', 'keep', 'save'],
    dynamique: ['enjoy', 'save', 'keep', 'invest'],
  },
  // Défaut du mode « Auto » : une seule table, celle du moteur de recos (P0–P9).
  auto_profile_map: DEFAULT_AUTO_PROFILE_MAP,
};

export function useRecoThresholds() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<RecommendationSettings> => {
      if (!supabase) return DEFAULT_RECO_THRESHOLDS;
      const { data, error } = await supabase
        .from('recommendation_settings')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();
      if (error || !data) return DEFAULT_RECO_THRESHOLDS;
      return data as RecommendationSettings;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useUpdateRecoThresholds(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<RecommendationSettings, 'seuil_reco_epargne' | 'seuil_reco_invest' | 'seuil_reco_plaisir' | 'seuil_reco_conserver'>>) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('recommendation_settings')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId })
        .eq('id', 'default');
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}

/** Met à jour l'ordre de consommation des recos (cascade) et/ou le mapping Auto→profil. */
export function useUpdateRecoConsumption(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<RecommendationSettings, 'consumption_orders' | 'auto_profile_map'>>) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('recommendation_settings')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: userId })
        .eq('id', 'default');
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}
