/**
 * Centre de sécurité — hooks de données.
 *  • useAppLockdown : état de la COUPURE GLOBALE (kill switch), propagé en temps réel.
 *  • useClientErrors / useResolveClientError / useClearClientErrors : journal d'erreurs (admin).
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useFeatureFlags } from './useFeatureFlags';

export interface ClientError {
  id: string;
  profile_id: string | null;
  platform: string | null;
  app_version: string | null;
  runtime_version: string | null;
  kind: 'error' | 'fatal' | 'unhandled_rejection';
  message: string;
  stack: string | null;
  route: string | null;
  context: any;
  resolved: boolean;
  created_at: string;
}

/**
 * Verrou global : lit `app_config.features.app_lockdown_*` (via useFeatureFlags) et s'abonne au
 * realtime `app_config` pour une bascule INSTANTANÉE sur tous les appareils. Renvoie aussi le
 * message/titre personnalisés affichés dans le voile de coupure.
 */
export function useAppLockdown() {
  const qc = useQueryClient();
  const { data: flags } = useFeatureFlags();

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`app_config_lockdown_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config' }, () => {
        qc.invalidateQueries({ queryKey: ['feature_flags'] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [qc]);

  return {
    locked: Boolean(flags?.app_lockdown_enabled),
    title: flags?.app_lockdown_title || 'Application temporairement indisponible',
    message:
      flags?.app_lockdown_message ||
      'Nous avons momentanément suspendu l’accès pour protéger tes données. Reviens dans quelques minutes.',
  };
}

/** Liste des erreurs client (admin). `onlyOpen` : masque les résolues. */
export function useClientErrors(onlyOpen = true) {
  return useQuery({
    queryKey: ['client_errors', onlyOpen],
    queryFn: async (): Promise<ClientError[]> => {
      if (!supabase) return [];
      let q = supabase.from('client_errors').select('*').order('created_at', { ascending: false }).limit(200);
      if (onlyOpen) q = q.eq('resolved', false);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClientError[];
    },
    staleTime: 15 * 1000,
    refetchOnMount: true,
  });
}

export function useResolveClientError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; resolved: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('client_errors').update({ resolved: input.resolved }).eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client_errors'] }),
  });
}

/** ADMIN — réinitialise le mot de passe d'un utilisateur (par e-mail) via l'Edge Function
 *  service-role. Repli fiable pour les comptes e-mail sans messagerie de récupération. */
export function useAdminSetPassword() {
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('admin-set-password', { body: input });
      if (error) {
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          try { const b = await ctx.json(); throw new Error(mapPwError(b?.error)); } catch (e) { throw e; }
        }
        throw new Error(error.message || 'Échec');
      }
      if ((data as any)?.error) throw new Error(mapPwError((data as any).error));
    },
  });
}

function mapPwError(code?: string): string {
  switch (code) {
    case 'user_not_found': return 'Aucun utilisateur avec cet e-mail.';
    case 'weak_password': return 'Mot de passe trop faible (≥ 12, maj, min, chiffre, spécial).';
    case 'forbidden': return 'Réservé aux administrateurs.';
    case 'email_missing': return 'E-mail requis.';
    default: return code || 'Échec de la réinitialisation.';
  }
}

/** Purge les erreurs antérieures à N jours (défaut 30) — RPC admin. */
export function usePurgeClientErrors() {
  const qc = useQueryClient();
  return useMutation<number, Error, number>({
    mutationFn: async (beforeDays: number): Promise<number> => {
      if (!supabase) throw new Error('Backend indisponible');
      const before = new Date(Date.now() - beforeDays * 86400_000).toISOString();
      const { data, error } = await supabase.rpc('client_errors_purge', { p_before: before });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client_errors'] }),
  });
}
