/**
 * useSeo — lecture/écriture de la config SEO (app_config.seo) + application au <head> web.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolveSeoConfig, type SeoConfig } from '../lib/seo';

export function useSeoConfig() {
  return useQuery({
    queryKey: ['seo_config'],
    queryFn: async (): Promise<SeoConfig> => {
      if (!supabase) return resolveSeoConfig(null);
      const { data } = await supabase.from('app_config').select('seo').eq('id', 'default').single();
      return resolveSeoConfig((data as any)?.seo ?? null);
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useSaveSeoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: SeoConfig) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('app_config').update({ seo: next, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return next;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['seo_config'] }); },
  });
}
