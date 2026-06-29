// Catégories de BASE (référentiel admin). CRUD + propagation « Appliquer à tous » (RPC).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface BaseCategory {
  id: string;
  name: string;
  type: 'income' | 'expense';
  parent_id: string | null;
  sort_order: number;
  is_variable: boolean;
  icon: string | null;
  is_active: boolean;
}

const KEY = 'base_categories';

export function useBaseCategories() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<BaseCategory[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('base_categories').select('*').order('type').order('sort_order').order('name');
      if (error) throw error;
      return (data ?? []) as BaseCategory[];
    },
  });
}

export function useAddBaseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: 'income' | 'expense'; parent_id?: string | null; is_variable?: boolean; sort_order?: number }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('base_categories').insert({
        name: input.name.trim(), type: input.type, parent_id: input.parent_id ?? null,
        is_variable: input.is_variable ?? false, sort_order: input.sort_order ?? 0,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateBaseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<Omit<BaseCategory, 'id'>>) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { id, ...patch } = input;
      const { error } = await supabase.from('base_categories').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Propage le référentiel à TOUS les utilisateurs (ajoute, replace le placement, renomme si non renommé). */
export function useApplyBaseCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('apply_base_categories');
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: [KEY] }); },
  });
}
