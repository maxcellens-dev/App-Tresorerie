/**
 * Admin — utilisateurs INACTIFS (listing par mois d'inactivité) + suppression en masse (compte + données).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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

/** Supprime en masse des utilisateurs (compte Auth + toutes leurs données) via l'Edge Function. */
export function useDeleteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<{ deleted: number; skipped: number }> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('admin-delete-users', { body: { ids } });
      if (error) {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); throw new Error(b?.error || error.message); } catch (e) { throw e; } }
        throw new Error(error.message || 'Échec de la suppression');
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return { deleted: Number((data as any)?.deleted ?? 0), skipped: Number((data as any)?.skipped ?? 0) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inactive_users'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}
