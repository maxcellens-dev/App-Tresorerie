import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';

const PROJECTS_KEY = 'projects';
const TRANSACTIONS_KEY = 'transactions';

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
      source_account_id?: string;
      linked_account_id?: string;
      transaction_day?: number;
      first_payment_date?: string;
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
        source_account_id: input.source_account_id || null,
        linked_account_id: input.linked_account_id || null,
        transaction_day: input.transaction_day || null,
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

      // Créer automatiquement les transactions récurrentes (virement interne)
      if (data && input.monthly_allocation > 0) {
        const txDate = input.first_payment_date || (() => {
          const now = new Date();
          const day = input.transaction_day || now.getDate();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        })();

        // Transaction de débit sur le compte source
        if (input.source_account_id) {
          const { error: txErr1 } = await supabase
            .from('transactions')
            .insert({
              profile_id: profileId,
              account_id: input.source_account_id,
              category_id: null,
              amount: -input.monthly_allocation,
              date: txDate,
              note: input.name,
              is_forecast: false,
              is_recurring: true,
              recurrence_rule: 'monthly',
              recurrence_end_date: input.target_date || null,
              project_id: data.id,
            });
          if (txErr1) console.warn('Transaction source non créée:', txErr1);
        }

        // Transaction de crédit sur le compte destination
        if (input.linked_account_id) {
          const { error: txErr2 } = await supabase
            .from('transactions')
            .insert({
              profile_id: profileId,
              account_id: input.linked_account_id,
              category_id: null,
              amount: input.monthly_allocation,
              date: txDate,
              note: input.name,
              is_forecast: false,
              is_recurring: true,
              recurrence_rule: 'monthly',
              recurrence_end_date: input.target_date || null,
              project_id: data.id,
            });
          if (txErr2) console.warn('Transaction destination non créée:', txErr2);
        }
      }

      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
    },
  });
}

export function useUpdateProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string; target_amount?: number; monthly_allocation?: number; target_date?: string | null; current_accumulated?: number; source_account_id?: string | null; linked_account_id?: string | null; transaction_day?: number | null; status?: string }) => {
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
          ...(input.source_account_id !== undefined && { source_account_id: input.source_account_id }),
          ...(input.linked_account_id !== undefined && { linked_account_id: input.linked_account_id }),
          ...(input.transaction_day !== undefined && { transaction_day: input.transaction_day }),
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

export function useCheckProjectTransactions(profileId: string | undefined) {
  return {
    check: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = new Date().toISOString().split('T')[0];
      const { data: pastTxns, error: e1 } = await supabase
        .from('transactions')
        .select('id, date')
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .lte('date', today);
      if (e1) throw e1;
      const { data: futureTxns, error: e2 } = await supabase
        .from('transactions')
        .select('id, date')
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', today);
      if (e2) throw e2;
      return { past: pastTxns ?? [], future: futureTxns ?? [] };
    },
  };
}

export function useDeleteProjectFull(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      // Delete all linked transactions first
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
      if (txErr) throw txErr;
      // Delete the project
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
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
    },
  });
}

export function useArchiveProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = new Date().toISOString().split('T')[0];
      // Delete future transactions only
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', today);
      if (txErr) throw txErr;
      // Archive the project with end date = today
      const { error } = await supabase
        .from('projects')
        .update({ status: 'archived', target_date: today })
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
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
