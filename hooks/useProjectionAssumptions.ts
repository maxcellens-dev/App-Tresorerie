/**
 * Hypothèses de Projection (apports, rendement, durée…) persistées en base
 * (profiles.projection_assumptions) — remplace l'ancien stockage localStorage.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const KEY = 'projection_assumptions';

export function useProjectionAssumptions(userId: string | undefined) {
  return useQuery({
    queryKey: [KEY, userId],
    queryFn: async (): Promise<any | null> => {
      if (!supabase || !userId) return null;
      const { data } = await supabase.from('profiles').select('projection_assumptions').eq('id', userId).maybeSingle();
      return (data as any)?.projection_assumptions ?? null;
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveProjectionAssumptions(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assumptions: any) => {
      if (!supabase || !userId) return;
      await supabase.from('profiles').update({ projection_assumptions: assumptions }).eq('id', userId);
    },
    // Mise à jour optimiste du cache pour éviter tout « retour » visuel à l'ancienne valeur.
    onMutate: async (assumptions) => {
      await qc.cancelQueries({ queryKey: [KEY, userId] });
      const prev = qc.getQueryData([KEY, userId]);
      qc.setQueryData([KEY, userId], assumptions);
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev !== undefined) qc.setQueryData([KEY, userId], ctx.prev); },
  });
}
