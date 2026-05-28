import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { TIER_ALLOCATIONS } from '../lib/recommendationEngine';
import type { RecoType, SavingsTier } from '../lib/recommendationEngine';

export type TierAllocations = Record<SavingsTier, Record<RecoType, number>>;

const QUERY_KEY = ['recommendation_tier_allocations'];

export function useRecommendationTiers() {
  return useQuery<TierAllocations>({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<TierAllocations> => {
      if (!supabase) return TIER_ALLOCATIONS;
      const { data, error } = await supabase
        .from('recommendation_tier_allocations')
        .select('tier, type, value');
      if (error || !data || data.length === 0) return TIER_ALLOCATIONS;

      // Build from DB rows, falling back to hardcoded defaults for any missing cell
      const result: TierAllocations = JSON.parse(JSON.stringify(TIER_ALLOCATIONS));
      for (const row of data) {
        const tier = row.tier as SavingsTier;
        const type = row.type as RecoType;
        if (result[tier] && type in result[tier]) {
          result[tier][type] = row.value;
        }
      }
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateRecommendationTiers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (allocations: TierAllocations) => {
      if (!supabase) throw new Error('Non connecté');
      const rows = Object.entries(allocations).flatMap(([tier, types]) =>
        Object.entries(types).map(([type, value]) => ({ tier, type, value })),
      );
      const { error } = await supabase
        .from('recommendation_tier_allocations')
        .upsert(rows, { onConflict: 'tier,type' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
