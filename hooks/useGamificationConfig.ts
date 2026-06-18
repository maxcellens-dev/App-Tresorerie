/**
 * Config de gamification (badges, identité, streak, boutique) stockée dans
 * app_config.gamification, éditable en admin.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { mergeGamificationConfig, type GamificationConfig } from '../lib/gamification';

const KEY = 'gamification_config';

export function useGamificationConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<GamificationConfig> => {
      if (!supabase) return mergeGamificationConfig(undefined);
      const { data } = await supabase.from('app_config').select('gamification').eq('id', 'default').maybeSingle();
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
