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
      const { data, error } = await supabase
        .from('profiles').select('projection_assumptions').eq('id', userId).maybeSingle();
      // ⚠️ NE JAMAIS avaler l'erreur ici. L'écran de Projection écrit ses hypothèses en base 500 ms
      // après le chargement : si une lecture ratée était rendue comme « aucune hypothèse », l'écran
      // repartait sur les valeurs par défaut PUIS les sauvegardait — la saisie de l'utilisateur
      // était donc DÉTRUITE par une simple lecture en échec. On propage : react-query réessaie et
      // l'écran sait qu'il n'a rien chargé (il s'interdit alors d'écrire).
      if (error) throw error;
      // Ligne absente ≠ « pas d'hypothèses » : c'est une lecture prématurée (RLS pas encore en
      // place juste après la connexion — cf. la même race sur l'identité au login e-mail).
      if (!data) throw new Error('Profil illisible (lecture prématurée)');
      return (data as any).projection_assumptions ?? null;
    },
    enabled: !!userId,
    retry: 3,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveProjectionAssumptions(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assumptions: any) => {
      if (!supabase || !userId) return;
      // Erreur propagée : sinon un échec d'écriture passait inaperçu (cache optimiste à jour côté
      // écran, base inchangée) → les valeurs « tenaient » jusqu'au prochain démarrage à froid.
      const { error } = await supabase
        .from('profiles').update({ projection_assumptions: assumptions }).eq('id', userId);
      if (error) throw error;
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
