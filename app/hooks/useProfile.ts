import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  safety_margin_percent: number;
}

const KEY = 'profile';

export function useProfile(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Profile | null> => {
      if (!supabase || !profileId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        email: data.email ?? null,
        full_name: data.full_name ?? null,
        avatar_url: (data as { avatar_url?: string | null }).avatar_url ?? null,
        is_admin: Boolean((data as { is_admin?: boolean }).is_admin),
        safety_margin_percent: Number((data as { safety_margin_percent?: number }).safety_margin_percent) || 10,
      };
    },
    enabled: !!profileId,
  });
}

export function useUpdateProfile(profileId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { full_name?: string | null; avatar_url?: string | null; safety_margin_percent?: number }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: payload.full_name ?? undefined,
          avatar_url: payload.avatar_url ?? undefined,
          ...(payload.safety_margin_percent !== undefined && { safety_margin_percent: payload.safety_margin_percent }),
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
