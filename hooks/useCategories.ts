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
        .order('sort_order', { nullsFirst: false })
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
      // Seed depuis le RÉFÉRENTIEL admin (base_categories) si disponible → les copies sont liées (base_id)
      // pour recevoir les futures propagations. Repli sur le template code si le référentiel est vide.
      const { data: baseCats } = await supabase.from('base_categories').select('*').eq('is_active', true);
      if (baseCats && baseCats.length > 0) {
        const baseParents = baseCats.filter((b: any) => !b.parent_id);
        const userIdByBase: Record<string, string> = {};
        for (const b of baseParents) {
          const { data, error } = await supabase.from('categories').insert({
            profile_id: profileId, name: b.name, type: b.type, parent_id: null,
            is_default: true, is_variable: b.is_variable, sort_order: b.sort_order, base_id: b.id, user_renamed: false,
          }).select('id').single();
          if (error) throw error;
          userIdByBase[b.id] = (data as { id: string }).id;
        }
        for (const b of baseCats.filter((x: any) => x.parent_id)) {
          const parentUserId = userIdByBase[(b as any).parent_id];
          if (!parentUserId) continue;
          const { error } = await supabase.from('categories').insert({
            profile_id: profileId, name: b.name, type: b.type, parent_id: parentUserId,
            is_default: true, is_variable: b.is_variable, sort_order: b.sort_order, base_id: b.id, user_renamed: false,
          });
          if (error) throw error;
        }
        return;
      }
      // Repli : template code.
      const flat = getDefaultCategoriesFlat();
      const parentIds: Record<string, string> = {};
      for (const item of flat) {
        if (item.parentName) continue;
        const { data, error } = await supabase.from('categories')
          .insert({ profile_id: profileId, name: item.name, type: item.type, parent_id: null, is_default: true, is_variable: item.is_variable ?? false, sort_order: item.sort_order })
          .select('id, name').single();
        if (error) throw error;
        if (data) parentIds[item.name] = (data as { id: string }).id;
      }
      for (const item of flat) {
        if (!item.parentName || !parentIds[item.parentName]) continue;
        const { error } = await supabase.from('categories').insert({ profile_id: profileId, name: item.name, type: item.type, parent_id: parentIds[item.parentName], is_default: true, is_variable: item.is_variable ?? false, sort_order: item.sort_order });
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
    mutationFn: async (input: { name: string; type: 'income' | 'expense'; parent_id?: string | null; icon?: string | null }) => {
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
          ...(input.icon != null && { icon: input.icon }),
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
    mutationFn: async (input: { id: string; name: string; type?: 'income' | 'expense'; parent_id?: string | null; is_variable?: boolean; icon?: string | null }) => {
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
          // L'utilisateur a renommé/édité SA copie → on protège son nom de la propagation du référentiel.
          user_renamed: true,
          ...(input.type != null && { type: input.type }),
          ...(input.parent_id !== undefined && { parent_id: input.parent_id }),
          ...(input.is_variable !== undefined && { is_variable: input.is_variable }),
          ...(input.icon !== undefined && { icon: input.icon }),
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

export function useReorderCategories(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { id: string; sort_order: number }[]) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      for (const u of updates) {
        const { error } = await supabase
          .from('categories')
          .update({ sort_order: u.sort_order })
          .eq('id', u.id)
          .eq('profile_id', profileId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
