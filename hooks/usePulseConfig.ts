// Réglages ADMIN de l'état des lieux (app_config.pulse) : activation, temps affichés, signaux par profil.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { resolvePulseConfig, type PulseConfig } from '../lib/pulseEngine';

const KEY = 'pulse_config';

export function usePulseConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<PulseConfig> => {
      if (!supabase) return resolvePulseConfig(null);
      const { data } = await supabase.from('app_config').select('pulse').eq('id', 'default').single();
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
      const { data } = await supabase.from('app_config').select('pulse').eq('id', 'default').single();
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
