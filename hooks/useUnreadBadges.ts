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

/** Cumul admin : demandes d'assistance non lues + idées non lues + tickets IA ouverts.
 *  Respecte les préférences PAR ADMIN (admin_notification_prefs.in_app) : un type désactivé
 *  n'alimente plus le badge de CET admin. Sans ligne de préférence → in-app activé (défaut). */
export function useAdminUnreadCount(isAdmin: boolean, profileId?: string) {
  const { data } = useQuery({
    queryKey: ['unread_badges', 'admin', profileId],
    queryFn: async (): Promise<number> => {
      if (!supabase) return 0;
      // Préférences in-app de CET admin (défaut : tout activé).
      const wants: Record<string, boolean> = { support: true, suggestion: true, ai_ticket: true };
      if (profileId) {
        const { data: prefs } = await supabase
          .from('admin_notification_prefs').select('kind, in_app').eq('profile_id', profileId);
        for (const p of (prefs ?? []) as any[]) wants[p.kind] = !!p.in_app;
      }
      const [reqs, ideas, aiTickets] = await Promise.all([
        wants.support ? supabase.from('support_requests').select('id', { count: 'exact', head: true }).eq('admin_unread', true) : Promise.resolve({ count: 0 } as any),
        wants.suggestion ? supabase.from('suggestions').select('id', { count: 'exact', head: true }).eq('admin_unread', true) : Promise.resolve({ count: 0 } as any),
        wants.ai_ticket ? supabase.from('ai_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open') : Promise.resolve({ count: 0 } as any),
      ]);
      return (reqs.count ?? 0) + (ideas.count ?? 0) + (aiTickets.count ?? 0);
    },
    enabled: isAdmin,
    refetchInterval: 30000,
  });
  return data ?? 0;
}

export type AdminNotifKind = 'support' | 'suggestion' | 'ai_ticket';
export interface AdminNotifPref { profile_id: string; kind: AdminNotifKind; in_app: boolean; push: boolean }

/** Liste des admins + leurs préférences de notification (page Notifications → onglet Admin/Support). */
export function useAdminNotifPrefs(isAdmin: boolean) {
  return useQuery({
    queryKey: ['admin_notif_prefs'],
    enabled: isAdmin && !!supabase,
    queryFn: async (): Promise<{ admins: { id: string; label: string }[]; prefs: AdminNotifPref[] }> => {
      const [adminsRes, prefsRes] = await Promise.all([
        supabase!.from('profiles').select('id, full_name, email').eq('is_admin', true),
        supabase!.from('admin_notification_prefs').select('*'),
      ]);
      return {
        admins: ((adminsRes.data ?? []) as any[]).map((a) => ({ id: a.id, label: a.full_name || a.email || a.id })),
        prefs: (prefsRes.data ?? []) as AdminNotifPref[],
      };
    },
  });
}

export function useSaveAdminNotifPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profile_id: string; kind: AdminNotifKind; in_app?: boolean; push?: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      // Upsert avec les défauts pour les champs non fournis (lecture de l'existant d'abord).
      const { data: cur } = await supabase.from('admin_notification_prefs')
        .select('in_app, push').eq('profile_id', input.profile_id).eq('kind', input.kind).maybeSingle();
      const { error } = await supabase.from('admin_notification_prefs').upsert({
        profile_id: input.profile_id,
        kind: input.kind,
        in_app: input.in_app ?? (cur as any)?.in_app ?? true,
        push: input.push ?? (cur as any)?.push ?? false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'profile_id,kind' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_notif_prefs'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}

/** Nombre de tickets Conseils IA ouverts (badge sur l'entrée admin « Conseils IA »). */
export function useAiTicketsCount(isAdmin: boolean) {
  const { data } = useQuery({
    queryKey: ['unread_badges', 'ai_tickets'],
    queryFn: async (): Promise<number> => {
      if (!supabase) return 0;
      const { count } = await supabase.from('ai_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open');
      return count ?? 0;
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
