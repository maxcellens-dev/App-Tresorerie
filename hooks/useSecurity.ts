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

export type AdminNotifTemplateKind = 'support' | 'suggestion' | 'ai_ticket';
export interface AdminNotifTemplate { title: string; body: string }

/** Titre/message éditables des notifications admin événementielles (support/suggestion/tickets IA). */
export function useAdminNotifTemplates() {
  return useQuery({
    queryKey: ['admin_notif_templates'],
    queryFn: async (): Promise<Record<AdminNotifTemplateKind, AdminNotifTemplate>> => {
      const fallback: Record<AdminNotifTemplateKind, AdminNotifTemplate> = {
        support: { title: "Nouvelle demande d'assistance", body: 'Un utilisateur a envoyé une demande de support.' },
        suggestion: { title: 'Nouvelle suggestion', body: 'Un utilisateur a proposé une idée.' },
        ai_ticket: { title: 'Conseil IA en échec', body: 'Une demande de conseil a échoué et attend une relance.' },
      };
      if (!supabase) return fallback;
      const { data } = await supabase.from('app_config').select('admin_notif_templates').eq('id', 'default').maybeSingle();
      const cfg = ((data as any)?.admin_notif_templates) ?? {};
      return {
        support: { ...fallback.support, ...(cfg.support ?? {}) },
        suggestion: { ...fallback.suggestion, ...(cfg.suggestion ?? {}) },
        ai_ticket: { ...fallback.ai_ticket, ...(cfg.ai_ticket ?? {}) },
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useSaveAdminNotifTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: AdminNotifTemplateKind; title: string; body: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data } = await supabase.from('app_config').select('admin_notif_templates').eq('id', 'default').maybeSingle();
      const prev = ((data as any)?.admin_notif_templates) ?? {};
      const merged = { ...prev, [input.kind]: { title: input.title, body: input.body } };
      const { error } = await supabase.from('app_config').update({ admin_notif_templates: merged, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw new Error(error.message);
      return merged;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_notif_templates'] }),
  });
}

export interface CrashNotifyConfig { enabled: boolean; title: string; body: string; throttle_minutes: number }

/** Config de la notification admin de crash (app_config.crash_notify) — éditable dans admin/notifications. */
export function useCrashNotifyConfig() {
  return useQuery({
    queryKey: ['crash_notify_config'],
    queryFn: async (): Promise<CrashNotifyConfig> => {
      const fallback: CrashNotifyConfig = { enabled: true, title: '🚨 Erreur détectée dans l\'app', body: 'Une erreur ({kind}) est remontée depuis {platform} v{version}.', throttle_minutes: 30 };
      if (!supabase) return fallback;
      const { data } = await supabase.from('app_config').select('crash_notify').eq('id', 'default').maybeSingle();
      return { ...fallback, ...(((data as any)?.crash_notify) ?? {}) } as CrashNotifyConfig;
    },
    staleTime: 30 * 1000,
  });
}

export function useSaveCrashNotifyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<CrashNotifyConfig>) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data } = await supabase.from('app_config').select('crash_notify').eq('id', 'default').maybeSingle();
      const prev = (((data as any)?.crash_notify) ?? {}) as CrashNotifyConfig;
      const merged = { ...prev, ...patch };
      const { error } = await supabase.from('app_config').update({ crash_notify: merged, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw new Error(error.message);
      return merged;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crash_notify_config'] }),
  });
}

/** TEMPS RÉEL sur les crashs : à chaque erreur remontée (INSERT client_errors), on rafraîchit le
 *  badge admin (bouton Admin + carte Sécurité) et la liste, sans attendre le refetch périodique. */
export function useClientErrorsRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !enabled) return;
    const channel = supabase
      .channel(`client_errors_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_errors' }, () => {
        qc.invalidateQueries({ queryKey: ['client_errors'] });
        qc.invalidateQueries({ queryKey: ['unread_badges'] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [enabled, qc]);
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_errors'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] }); // badge crash (Admin + Centre de sécurité) en LIVE
    },
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

/** Purge les erreurs antérieures à N jours — RPC admin. `0` = TOUT (borne = maintenant). */
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_errors'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}

/** Marque TOUTES les erreurs ouvertes comme résolues (vide la pastille d'un coup).
 *  Les résoudre une par une était le seul moyen après une vague de crashs déjà corrigés. */
export function useResolveAllClientErrors() {
  const qc = useQueryClient();
  return useMutation<number, Error, void>({
    mutationFn: async (): Promise<number> => {
      if (!supabase) throw new Error('Backend indisponible');
      // `select('id')` : on renvoie le nombre réellement basculé, pas une estimation d'après la
      // liste affichée (elle est plafonnée à 200 lignes).
      const { data, error } = await supabase
        .from('client_errors').update({ resolved: true }).eq('resolved', false).select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_errors'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}
