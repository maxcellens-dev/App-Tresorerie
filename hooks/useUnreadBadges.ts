/**
 * Badges « non lu » :
 * - utilisateur : demandes d'assistance avec une réponse admin non lue (1 par demande).
 * - admin : demandes d'assistance non lues + idées (suggestions) non lues — cumulées.
 * Comptages légers (count head) rafraîchis régulièrement, affichés dans l'en-tête.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Nombre de demandes d'assistance de l'utilisateur avec réponse non lue. */
export function useUserUnreadCount(profileId: string | undefined) {
  const { data } = useQuery({
    queryKey: ['unread_badges', 'user', profileId],
    queryFn: async (): Promise<number> => {
      if (!supabase || !profileId) return 0;
      const { count, error } = await supabase
        .from('support_requests')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId)
        .eq('user_unread', true);
      if (error) return 0;
      return count ?? 0;
    },
    enabled: !!profileId,
    refetchInterval: 30000,
  });
  return data ?? 0;
}

/** Cumul admin : demandes d'assistance non lues + idées non lues. */
export function useAdminUnreadCount(isAdmin: boolean) {
  const { data } = useQuery({
    queryKey: ['unread_badges', 'admin'],
    queryFn: async (): Promise<number> => {
      if (!supabase) return 0;
      const [reqs, ideas] = await Promise.all([
        supabase.from('support_requests').select('id', { count: 'exact', head: true }).eq('admin_unread', true),
        supabase.from('suggestions').select('id', { count: 'exact', head: true }).eq('admin_unread', true),
      ]);
      return (reqs.count ?? 0) + (ideas.count ?? 0);
    },
    enabled: isAdmin,
    refetchInterval: 30000,
  });
  return data ?? 0;
}

/** Marque toutes les idées comme lues (à l'ouverture de la page Suggestions admin). */
export function useMarkSuggestionsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase) return;
      await supabase.from('suggestions').update({ admin_unread: false }).eq('admin_unread', true);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['unread_badges', 'admin'] });
      qc.invalidateQueries({ queryKey: ['admin-suggestions'] });
    },
  });
}
