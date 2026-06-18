import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Objective, ObjectiveWithAccount } from '../types/database';

const OBJECTIVES_KEY = 'objectives';

export function useObjectives(profileId: string | undefined) {
  return useQuery({
    queryKey: [OBJECTIVES_KEY, profileId],
    queryFn: async (): Promise<ObjectiveWithAccount[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('objectives')
        .select('*, linked_account:accounts(name, type)')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((o: any) => ({
        ...o,
        target_yearly_amount: Number(o.target_yearly_amount),
        linked_account: o.linked_account,
      }));
    },
    enabled: !!profileId,
  });
}

export function useAddObjective(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; target_yearly_amount: number; linked_account_id?: string }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('objectives')
        .insert({
          profile_id: profileId,
          name: input.name,
          description: input.description || null,
          target_yearly_amount: input.target_yearly_amount,
          linked_account_id: input.linked_account_id || null,
          status: 'active',
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [OBJECTIVES_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateObjective(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string; target_yearly_amount?: number; linked_account_id?: string; status?: string }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('objectives')
        .update({
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.target_yearly_amount !== undefined && { target_yearly_amount: input.target_yearly_amount }),
          ...(input.linked_account_id !== undefined && { linked_account_id: input.linked_account_id }),
          ...(input.status && { status: input.status }),
        })
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [OBJECTIVES_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteObjective(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (objectiveId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('objectives')
        .delete()
        .eq('id', objectiveId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [OBJECTIVES_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
