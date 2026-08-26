/**
 * useSeo — lecture/écriture de la config SEO (app_config.seo) + application au <head> web.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { resolveSeoConfig, type SeoConfig } from '../../lib/platform/seo';

export function useSeoConfig() {
  return useQuery({
    queryKey: ['seo_config'],
    queryFn: async (): Promise<SeoConfig> => {
      if (!supabase) return resolveSeoConfig(null);
      /* ⚠️ Cette lecture ALIMENTE un formulaire que l'écran d'administration réécrit ENSUITE EN
         ENTIER. Son erreur était ignorée : sur une coupure, le formulaire s'ouvrait garni des
         valeurs par défaut, et « Enregistrer » écrasait la vraie configuration avec elles. On lève
         — l'écran sait alors qu'il ne sait pas (`isError`) et refuse d'enregistrer. */
      const { data, error } = await supabase.from('app_config').select('seo').eq('id', 'default').single();
      if (error) throw error;
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
