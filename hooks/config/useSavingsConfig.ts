/**
 * Seuils d'épargne + libellés associés (Critique / À renforcer / Saine / Confortable),
 * configurables en admin (globaux). Stockés dans app_config.savings_config.
 * Montants exprimés en EUR (base) — convertis ensuite dans la devise de référence à l'affichage.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';

export interface SavingsConfig {
  min: number;
  optimal: number;
  comfort: number;
  label_critical: string;
  label_low: string;
  label_healthy: string;
  label_comfort: string;
}

export const SAVINGS_DEFAULTS: SavingsConfig = {
  min: 5000,
  optimal: 10000,
  comfort: 20000,
  label_critical: 'Critique',
  label_low: 'À renforcer',
  label_healthy: 'Saine',
  label_comfort: 'Confortable',
};

const KEY = 'savings_config';

export function useSavingsConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<SavingsConfig> => {
      if (!supabase) return SAVINGS_DEFAULTS;
      /* ⚠️ Cette lecture ALIMENTE un formulaire que l'écran d'administration réécrit ENSUITE EN
         ENTIER. Son erreur était ignorée : sur une coupure, le formulaire s'ouvrait garni des
         valeurs par défaut, et « Enregistrer » écrasait la vraie configuration avec elles. On lève
         — l'écran sait alors qu'il ne sait pas (`isError`) et refuse d'enregistrer. */
      const { data, error } = await supabase.from('app_config').select('savings_config').eq('id', 'default').single();
      if (error) throw error;
      const cfg = (data as any)?.savings_config as Partial<SavingsConfig> | undefined;
      return { ...SAVINGS_DEFAULTS, ...(cfg ?? {}) };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveSavingsConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<SavingsConfig>) => {
      if (!supabase) throw new Error('Supabase non configuré');
      // Lecture ratée ≠ config vide : sans ce test, l'écriture ci-dessous réduisait la colonne au
      // seul champ modifié (cf. useFeatureFlags pour le détail).
      const { data, error: readErr } = await supabase.from('app_config').select('savings_config').eq('id', 'default').single();
      if (readErr) throw readErr;
      const prev = { ...SAVINGS_DEFAULTS, ...(((data as any)?.savings_config) ?? {}) };
      const merged: SavingsConfig = { ...prev, ...config };
      const { error } = await supabase.from('app_config')
        .update({ savings_config: merged, updated_at: new Date().toISOString() })
        .eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [KEY] }),
  });
}
