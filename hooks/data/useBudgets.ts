/**
 * BUDGETS — lecture et écriture de la table `budgets` (migrations 217 et 218).
 *
 * On charge TOUTES les lignes du profil d'un coup, et pas la période affichée : le report
 * implicite a besoin de remonter le temps (« le budget de septembre, c'est celui d'août s'il n'a
 * pas été réécrit »), et une requête par période rendrait chaque changement de mois dépendant du
 * réseau. Le volume est dérisoire — une poignée de lignes par mois budgété.
 *
 * ⚠️ FILTRE EXPLICITE `profile_id`. Les policies admin en OR font qu'un `select('*')` nu ramène
 * les lignes de TOUS les utilisateurs chez un administrateur. Le filtre n'est pas une optimisation,
 * c'est la garantie d'isolation côté client.
 *
 * ⚠️ `onConflict` vise l'index unique ORDINAIRE de la migration 218. Il ne pouvait pas viser les
 * index PARTIELS de la 217 — Postgres exige alors leur prédicat, que PostgREST ne sait pas
 * envoyer : tout enregistrement échouait. Si un jour une colonne nullable revient dans cette clé,
 * l'upsert recassera de la même façon.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { BudgetPeriod, BudgetRecord } from '../../lib/finance/budgetEngine';

export const BUDGETS_KEY = 'budgets';

/** Clé d'unicité de la table — la MÊME chaîne partout, pour ne pas la désynchroniser du schéma. */
const CONFLICT_TARGET = 'profile_id,period,period_key,category_id';

export function useBudgets(profileId: string | undefined) {
  return useQuery({
    queryKey: [BUDGETS_KEY, profileId],
    queryFn: async (): Promise<BudgetRecord[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('budgets')
        .select('id, period, period_key, category_id, amount')
        .eq('profile_id', profileId)
        .order('period_key', { ascending: false });
      // Une erreur AVALÉE ici rendrait « aucun budget » — et l'écran réécrirait par-dessus.
      if (error) throw error;
      return (data ?? []).map((b: any) => ({
        id: b.id,
        period: b.period as BudgetPeriod,
        period_key: b.period_key,
        category_id: b.category_id,
        amount: Number(b.amount) || 0,
      }));
    },
    enabled: !!profileId,
  });
}

export interface SetBudgetInput {
  period: BudgetPeriod;
  /** 'YYYY-MM' pour un mois, 'YYYY' pour une année. */
  periodKey: string;
  categoryId: string;
  /** 0 = retirer le budget (cf. plus bas : on ne supprime jamais la ligne). */
  amount: number;
}

const round2 = (n: number) => Math.max(0, Math.round((Number(n) || 0) * 100) / 100);

/**
 * Enregistre un lot de budgets — un seul aller-retour, quel qu'en soit le nombre.
 *
 * ⚠️ Un montant à 0 n'est PAS ignoré : c'est la façon de retirer un budget. Supprimer la ligne
 * ferait ressusciter celle du mois précédent au prochain chargement (report implicite), et
 * l'utilisateur verrait revenir ce qu'il vient d'effacer.
 */
export function useSetBudgets(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (inputs: SetBudgetInput[]) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      if (!inputs.length) return;
      const now = new Date().toISOString();
      const rows = inputs.map((i) => ({
        profile_id: profileId,
        period: i.period,
        period_key: i.periodKey,
        category_id: i.categoryId,
        amount: round2(i.amount),
        updated_at: now,
      }));
      const { error } = await supabase
        .from('budgets')
        .upsert(rows, { onConflict: CONFLICT_TARGET, ignoreDuplicates: false });
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [BUDGETS_KEY, profileId] }); },
  });
}

/** Un seul budget — commodité pour les écrans qui n'en modifient qu'un. */
export function useSetBudget(profileId: string | undefined) {
  const many = useSetBudgets(profileId);
  return {
    ...many,
    mutateAsync: (input: SetBudgetInput) => many.mutateAsync([input]),
  };
}
