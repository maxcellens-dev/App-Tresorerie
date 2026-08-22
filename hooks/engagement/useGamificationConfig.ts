/**
 * Config de gamification (badges, identité, streak, boutique) stockée dans
 * app_config.gamification, éditable en admin.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { mergeGamificationConfig, type GamificationConfig } from '../../lib/engagement/gamification';

const KEY = 'gamification_config';

export function useGamificationConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<GamificationConfig> => {
      if (!supabase) return mergeGamificationConfig(undefined);
      const { data, error } = await supabase.from('app_config').select('gamification').eq('id', 'default').maybeSingle();
      /* ⚠️ Une lecture EN ÉCHEC ne doit PAS se transformer en « config par défaut ».
         Cette config porte les PRIX de la boutique : sur une simple coupure réseau, l'app affichait
         les prix du code au lieu de ceux réglés en administration — et débitait à ce prix-là. Un
         article passé à 500 relyks en admin repartait à 70. On lève : react-query garde le dernier
         cache (persisté d'un lancement à l'autre) et réessaie ; à défaut, les écrans savent qu'ils
         n'ont pas de config plutôt que d'en inventer une. */
      if (error) throw error;
      return mergeGamificationConfig((data as any)?.gamification);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveGamificationConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (config: GamificationConfig) => {
      if (!supabase) throw new Error('Supabase non configuré');
      const { error } = await supabase
        .from('app_config')
        .update({ gamification: config, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      return config;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}
