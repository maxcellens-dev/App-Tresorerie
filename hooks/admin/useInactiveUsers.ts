/**
 * Admin — utilisateurs INACTIFS (listing par mois d'inactivité) + suppression en masse (compte + données).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';

export interface InactiveUser {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  last_active: string | null;
}

/** Liste les utilisateurs inactifs depuis ≥ `months` mois (admin, RPC list_inactive_users). */
export function useInactiveUsers(months: number, enabled: boolean) {
  return useQuery({
    queryKey: ['inactive_users', months],
    enabled: enabled && !!supabase,
    queryFn: async (): Promise<InactiveUser[]> => {
      const { data, error } = await supabase!.rpc('list_inactive_users', { p_min_months: months });
      if (error) throw new Error(error.message);
      return (data ?? []) as InactiveUser[];
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Recherche ADMIN sur tous les utilisateurs (actifs ou non), même forme que `useInactiveUsers` :
 * la purge doit pouvoir viser quelqu'un de précis, pas seulement les comptes dormants.
 * L'RPC exclut déjà l'appelant et les autres admins (migration 161) → un compte protégé n'apparaît
 * jamais dans la liste, donc ne peut pas être coché.
 */
export function useAdminUserSearch(query: string, enabled: boolean) {
  const q = query.trim();
  return useQuery({
    queryKey: ['admin_users_search', q],
    enabled: enabled && q.length >= 2 && !!supabase,
    queryFn: async (): Promise<InactiveUser[]> => {
      const { data, error } = await supabase!.rpc('search_users_admin', { p_query: q });
      if (error) throw new Error(error.message);
      return (data ?? []) as InactiveUser[];
    },
    staleTime: 30 * 1000,
  });
}

export interface AuthOrphan { id: string; email: string | null; created_at: string; confirmed_at: string | null }

/**
 * Comptes d'authentification SANS ligne dans `profiles` (RPC admin_auth_orphans, migration 176).
 *
 * Ces comptes n'apparaissent dans AUCUN écran d'admin — tous partent de `profiles`. Sans ce
 * diagnostic, une inscription restée en plan (e-mail de confirmation jamais ouvert) et un profil
 * réellement manquant (déclencheur en échec) sont indiscernables : dans les deux cas, on constate
 * seulement une absence.
 */
export function useAuthOrphans(enabled: boolean) {
  return useQuery({
    queryKey: ['admin_auth_orphans'],
    enabled: enabled && !!supabase,
    queryFn: async (): Promise<AuthOrphan[]> => {
      const { data, error } = await supabase!.rpc('admin_auth_orphans');
      if (error) throw new Error(error.message);
      return (data ?? []) as AuthOrphan[];
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Recrée les lignes `profiles` manquantes (RPC admin_repair_missing_profiles, migration 177).
 *
 * Un compte sans profil est INJOIGNABLE depuis l'admin — recherche, Premium et « Consulter »
 * partent tous de `profiles`. La réparation reconstruit la ligne depuis `auth.users`, sans jamais
 * toucher aux données de l'utilisateur : il n'a rien à supprimer ni à recréer.
 */
export function useRepairMissingProfiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.rpc('admin_repair_missing_profiles');
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_auth_orphans'] });
      qc.invalidateQueries({ queryKey: ['admin_user_search'] });
      qc.invalidateQueries({ queryKey: ['admin_users_search'] });
    },
  });
}

/** Supprime en masse des utilisateurs (compte Auth + toutes leurs données) via l'Edge Function. */
export function useDeleteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ deleted: number; skipped: number }> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('admin-delete-users', { body: { ids } });
      if (error) {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          // Corps illisible (HTML, vide) → on garde le message d'origine, et non l'erreur de parsing.
          let detail: string | undefined;
          try { detail = (await ctx.json())?.error; } catch { /* ignore */ }
          throw new Error(detail || error.message);
        }
        throw new Error(error.message || 'Échec de la suppression');
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return { deleted: Number((data as any)?.deleted ?? 0), skipped: Number((data as any)?.skipped ?? 0) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inactive_users'] });
      qc.invalidateQueries({ queryKey: ['admin_users_search'] });
      qc.invalidateQueries({ queryKey: ['admin_user_search'] }); // onglet Utilisateurs (recherche simple)
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}
