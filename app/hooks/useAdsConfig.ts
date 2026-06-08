/**
 * Config des publicités « maison » (app_config.ads), éditable en admin.
 * Une bannière = image OU texte, optionnellement cliquable (url).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface AdBanner {
  id: string;
  label?: string;   // titre interne
  text?: string;    // texte affiché (si pas d'image)
  image?: string;   // URL image bannière
  url?: string;     // lien au clic (optionnel)
}
export interface AdsConfig { banners: AdBanner[] }

const KEY = 'ads_config';

export function useAdsConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<AdsConfig> => {
      if (!supabase) return { banners: [] };
      const { data } = await supabase.from('app_config').select('ads').eq('id', 'default').maybeSingle();
      const ads = (data as any)?.ads as AdsConfig | undefined;
      return { banners: ads?.banners ?? [] };
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
