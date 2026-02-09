import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
}

const KEY = 'profile';

export function useProfile(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Profile | null> => {
      if (!supabase || !profileId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_url, is_admin')
        .eq('id', profileId)
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        email: data.email ?? null,
        full_name: data.full_name ?? null,
        avatar_url: (data as { avatar_url?: string | null }).avatar_url ?? null,
        is_admin: Boolean((data as { is_admin?: boolean }).is_admin),
      };
    },
    enabled: !!profileId,
  });
}

export function useUpdateProfile(profileId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { full_name?: string | null; avatar_url?: string | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: payload.full_name ?? undefined,
          avatar_url: payload.avatar_url ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, profileId] });
    },
  });
}
