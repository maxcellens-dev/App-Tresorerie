import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';

const PROJECTS_KEY = 'projects';

export function useProjects(profileId: string | undefined) {
  return useQuery({
    queryKey: [PROJECTS_KEY, profileId],
    queryFn: async (): Promise<Project[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        target_amount: Number(p.target_amount),
        monthly_allocation: Number(p.monthly_allocation),
      }));
    },
    enabled: !!profileId,
  });
}

export function useAddProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { 
      name: string; 
      description?: string; 
      target_amount: number; 
      monthly_allocation: number;
      target_date?: string;
      current_accumulated?: number;
      linked_account_id?: string;
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const payload = {
        profile_id: profileId,
        name: input.name,
        description: input.description || null,
        target_amount: input.target_amount,
        monthly_allocation: input.monthly_allocation,
        target_date: input.target_date || null,
        current_accumulated: input.current_accumulated || 0,
        linked_account_id: input.linked_account_id || null,
        status: 'active',
      };
      console.log('Inserting project:', payload);
      const { data, error } = await supabase
        .from('projects')
        .insert(payload)
        .select()
        .single();
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
    },
  });
}

export function useUpdateProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string; target_amount?: number; monthly_allocation?: number; target_date?: string | null; current_accumulated?: number; linked_account_id?: string | null; status?: string }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('projects')
        .update({
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.target_amount !== undefined && { target_amount: input.target_amount }),
          ...(input.monthly_allocation !== undefined && { monthly_allocation: input.monthly_allocation }),
          ...(input.target_date !== undefined && { target_date: input.target_date }),
          ...(input.current_accumulated !== undefined && { current_accumulated: input.current_accumulated }),
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
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
    },
  });
}

export function useDeleteProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
    },
  });
}
