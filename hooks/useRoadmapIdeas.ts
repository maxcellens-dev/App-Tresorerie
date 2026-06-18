import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface RoadmapIdea {
  id: string;
  title: string;
  icon: string;
  sort_order: number;
  created_at: string;
  created_by: string | null;
}

const KEY = 'roadmap_ideas';

/** Lecture publique des idées en cours de développement. */
export function useRoadmapIdeas() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<RoadmapIdea[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('roadmap_ideas')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) {
        // Table absente / non migrée → pas d'idées (section masquée)
        console.warn('[useRoadmapIdeas] lecture échouée:', error);
        return [];
      }
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });
}

/** Admin — ajout d'une idée. */
export function useAddRoadmapIdea(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ title, icon }: { title: string; icon?: string }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase.from('roadmap_ideas').insert({
        title: title.trim(),
        icon: icon ?? 'construct-outline',
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}

/** Admin — suppression d'une idée. */
export function useDeleteRoadmapIdea() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Supabase indisponible');
      const { error } = await supabase.from('roadmap_ideas').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}
