import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Category } from '../types/database';
import { getDefaultCategoriesFlat } from '../lib/defaultCategories';

const KEY = 'categories';

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function useCategories(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Category[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('profile_id', profileId)
        .order('type')
        .order('parent_id', { nullsFirst: true })
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        parent_id: (r as { parent_id?: string }).parent_id ?? null,
      }));
    },
    enabled: !!profileId,
  });

  return query;
}

export function useSeedDefaultCategories(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const flat = getDefaultCategoriesFlat();
      const parentIds: Record<string, string> = {};
      // 1) Insérer les parents (sans parentName)
      for (const item of flat) {
        if (item.parentName) continue;
        const { data, error } = await supabase
          .from('categories')
          .insert({
            profile_id: profileId,
            name: item.name,
            type: item.type,
            parent_id: null,
            is_default: true,
            is_variable: item.is_variable ?? false,
          })
          .select('id, name')
          .single();
        if (error) throw error;
        if (data) parentIds[item.name] = (data as { id: string }).id;
      }
      // 2) Insérer les sous-catégories
      for (const item of flat) {
        if (!item.parentName || !parentIds[item.parentName]) continue;
        const { error } = await supabase.from('categories').insert({
          profile_id: profileId,
          name: item.name,
          type: item.type,
          parent_id: parentIds[item.parentName],
          is_default: true,
          is_variable: item.is_variable ?? false,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useAddCategory(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: 'income' | 'expense'; parent_id?: string | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const nameNorm = normalizeName(input.name);
      if (!nameNorm) throw new Error('Le nom de la catégorie est requis.');
      const { data: existing } = await supabase
        .from('categories')
        .select('id, name, type')
        .eq('profile_id', profileId);
      const hasDuplicate = (existing ?? []).some(
        (r) =>
          (r as { type: string }).type === input.type &&
          normalizeName((r as { name?: string }).name ?? '') === nameNorm
      );
      if (hasDuplicate) throw new Error('Une catégorie avec ce nom existe déjà (même type).');
      const { data, error } = await supabase
        .from('categories')
        .insert({
          profile_id: profileId,
          name: input.name.trim(),
          type: input.type,
          parent_id: input.parent_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateCategory(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string; type?: 'income' | 'expense'; parent_id?: string | null; is_variable?: boolean }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const nameNorm = normalizeName(input.name);
      if (!nameNorm) throw new Error('Le nom de la catégorie est requis.');
      const { data: current } = await supabase
        .from('categories')
        .select('type')
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .single();
      const typeToUse = input.type ?? (current as { type: string } | null)?.type;
      const { data: existing } = await supabase
        .from('categories')
        .select('id, name, type')
        .eq('profile_id', profileId);
      const duplicate = (existing ?? []).find(
        (r) =>
          (r as { id: string }).id !== input.id &&
          (r as { type: string }).type === typeToUse &&
          normalizeName((r as { name?: string }).name ?? '') === nameNorm
      );
      if (duplicate) throw new Error('Une catégorie avec ce nom existe déjà (même type).');
      const { data, error } = await supabase
        .from('categories')
        .update({
          name: input.name.trim(),
          ...(input.type != null && { type: input.type }),
          ...(input.parent_id !== undefined && { parent_id: input.parent_id }),
          ...(input.is_variable !== undefined && { is_variable: input.is_variable }),
        })
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useBulkUpdateVariable(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ids: string[]; is_variable: boolean }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('categories')
        .update({ is_variable: input.is_variable })
        .in('id', input.ids)
        .eq('profile_id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteCategory(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase.from('categories').delete().eq('id', id).eq('profile_id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
