// Réglages ADMIN de l'état des lieux (app_config.pulse) : activation, temps affichés, signaux par profil.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { resolvePulseConfig, type PulseConfig } from '../../lib/pulse/pulseEngine';

const KEY = 'pulse_config';

export function usePulseConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<PulseConfig> => {
      if (!supabase) return resolvePulseConfig(null);
      /* ⚠️ Cette lecture ALIMENTE un formulaire que l'écran d'administration réécrit ENSUITE EN
         ENTIER. Son erreur était ignorée : sur une coupure, le formulaire s'ouvrait garni des
         valeurs par défaut, et « Enregistrer » écrasait la vraie configuration avec elles. On lève
         — l'écran sait alors qu'il ne sait pas (`isError`) et refuse d'enregistrer. */
      const { data, error } = await supabase.from('app_config').select('pulse').eq('id', 'default').single();
      if (error) throw error;
      return resolvePulseConfig((data as any)?.pulse ?? null);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useSavePulseConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<PulseConfig>) => {
      if (!supabase) throw new Error('Backend indisponible');
      // Lecture ratée ≠ config vide (cf. useFeatureFlags) : on ne réécrit pas la colonne à l'aveugle.
      const { data, error: readErr } = await supabase.from('app_config').select('pulse').eq('id', 'default').single();
      if (readErr) throw readErr;
      const prev = ((data as any)?.pulse ?? {}) as Partial<PulseConfig>;
      const merged = { ...prev, ...patch };
      const { error } = await supabase
        .from('app_config')
        .update({ pulse: merged, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
