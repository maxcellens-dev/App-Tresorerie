/**
 * Campagnes e-mail (admin) — brouillon, programmation, envoi.
 *
 * L'envoi lui-même passe par l'Edge Function `send-campaign-emails` : la clé Brevo ne doit jamais
 * transiter par le client. Ici on ne fait qu'écrire la campagne et demander son départ.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';

export type EmailAudience = 'all' | 'premium' | 'free' | 'group';
/**
 * `paused` (migration 168) : le quota d'envoi du jour est atteint, la campagne n'est PAS terminée et
 * reprendra d'elle-même à `resume_at`. C'est un état d'attente, pas un échec — une campagne à 600
 * personnes sur un compte plafonné à 300/jour passe forcément par là.
 */
export type EmailCampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';

export interface EmailCampaign {
  id: string;
  subject: string;
  body: string;
  audience: EmailAudience;
  group_id: string | null;
  scheduled_at: string | null;
  status: EmailCampaignStatus;
  sent_at: string | null;
  /** Destinataires DÉJÀ servis (et non « visés ») — c'est l'avancement réel. */
  recipients_count: number;
  /** Destinataires visés au total. 0 sur les campagnes antérieures à la migration 168. */
  total_recipients: number;
  /** Campagne en pause : instant à partir duquel le cron la reprend. */
  resume_at: string | null;
  /** Occurrence engendrée par une planification récurrente (NULL = campagne ponctuelle). */
  schedule_id: string | null;
  error: string | null;
  created_at: string;
}

const KEY = ['email_campaigns'];

export function useEmailCampaigns() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<EmailCampaign[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('email_campaigns').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return (data ?? []) as EmailCampaign[];
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Combien de personnes recevraient cette campagne ? Compté CÔTÉ SERVEUR (RPC) : un admin ne doit
 * pas avoir à lire tous les profils pour afficher un nombre.
 */
export function useEmailAudienceCount(audience: EmailAudience, groupId: string | null) {
  return useQuery({
    queryKey: ['email_audience_count', audience, groupId],
    queryFn: async (): Promise<number> => {
      if (!supabase) return 0;
      const { data, error } = await supabase.rpc('email_audience_count', {
        p_audience: audience, p_group: audience === 'group' ? groupId : null,
      });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    enabled: audience !== 'group' || !!groupId,
    staleTime: 60 * 1000,
  });
}

export function useSaveEmailCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      subject: string;
      body: string;
      audience: EmailAudience;
      group_id: string | null;
      /** ISO. Renseigné → la campagne est PROGRAMMÉE (le cron s'en charge). */
      scheduled_at: string | null;
    }): Promise<EmailCampaign> => {
      if (!supabase) throw new Error('Backend indisponible');
      const row = {
        ...(input.id ? { id: input.id } : {}),
        subject: input.subject.trim(),
        body: input.body.trim(),
        audience: input.audience,
        group_id: input.audience === 'group' ? input.group_id : null,
        scheduled_at: input.scheduled_at,
        status: input.scheduled_at ? 'scheduled' : 'draft',
      };
      const { data, error } = await supabase.from('email_campaigns').upsert(row).select().single();
      if (error) throw new Error(error.message);
      return data as EmailCampaign;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useSendEmailCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (campaignId: string): Promise<{ sent: number }> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('send-campaign-emails', {
        body: { campaign_id: campaignId },
      });
      if (error) {
        // Les erreurs d'Edge Function portent le vrai message dans le corps de la réponse : sans ça,
        // l'écran n'afficherait qu'un « Edge Function returned a non-2xx status code » inutile.
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          try { const b = await ctx.json(); throw new Error(b?.error || error.message); } catch (e) { throw e; }
        }
        throw new Error(error.message);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return { sent: Number((data as any)?.sent ?? 0) };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

export function useDeleteEmailCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('email_campaigns').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

/**
 * Vide l'historique des campagnes — pendant du bouton des notifications.
 *
 * Ne touche PAS aux campagnes encore vivantes (`scheduled`, `sending`, `paused`) : supprimer une
 * campagne en pause emporterait son registre d'envois (CASCADE, migration 168), donc la garantie
 * qu'on ne réécrira pas aux destinataires déjà servis. « Vider l'historique » veut dire effacer ce
 * qui est terminé, pas annuler ce qui est en cours.
 */
export function useClearEmailHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase
        .from('email_campaigns').delete().in('status', ['sent', 'failed', 'draft']).select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); },
  });
}

/* ───────────────────────── Campagnes RÉCURRENTES (migration 169) ─────────────────────────
   Une planification n'envoie jamais elle-même : à chaque échéance, le cron ENGENDRE une campagne
   neuve. C'est ce qui donne à chaque occurrence son propre registre d'envois — sans quoi, dès la
   deuxième, tout le monde passerait pour « déjà servi » et plus personne ne recevrait rien. */

export type EmailRecurrence = 'daily' | 'weekly' | 'monthly';

export interface EmailSchedule {
  id: string;
  subject: string;
  body: string;
  audience: EmailAudience;
  group_id: string | null;
  recurrence: EmailRecurrence;
  time_of_day: string;
  day_of_week: number | null;
  /** 0 = dernier jour du mois. */
  day_of_month: number | null;
  timezone: string;
  active: boolean;
  last_sent_at: string | null;
  created_at: string;
}

const SCHEDULES_KEY = ['email_schedules'];

export function useEmailSchedules() {
  return useQuery({
    queryKey: SCHEDULES_KEY,
    queryFn: async (): Promise<EmailSchedule[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('email_schedules').select('*').order('created_at', { ascending: false });
      // Migration 169 pas encore appliquée → écran utilisable sans planifications, plutôt qu'en erreur.
      if (error && !/does not exist|schema cache/i.test(error.message)) throw new Error(error.message);
      return (data ?? []) as EmailSchedule[];
    },
    staleTime: 30 * 1000,
  });
}

export function useSaveEmailSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<EmailSchedule> & { subject: string; body: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data: auth } = await supabase.auth.getUser();
      const row: Record<string, any> = {
        ...(input.id ? { id: input.id } : { created_by: auth?.user?.id ?? null }),
        subject: input.subject.trim(),
        body: input.body.trim(),
        audience: input.audience ?? 'all',
        group_id: input.audience === 'group' ? input.group_id ?? null : null,
        recurrence: input.recurrence ?? 'monthly',
        time_of_day: input.time_of_day ?? '09:00',
        day_of_week: input.recurrence === 'weekly' ? input.day_of_week ?? 1 : null,
        day_of_month: input.recurrence === 'monthly' ? input.day_of_month ?? 1 : null,
        timezone: input.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'),
        active: input.active ?? true,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('email_schedules').upsert(row);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: SCHEDULES_KEY }); },
  });
}

export function useDeleteEmailSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('email_schedules').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: SCHEDULES_KEY }); },
  });
}

export function useToggleEmailSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: EmailSchedule) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('email_schedules').update({ active: !s.active }).eq('id', s.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: SCHEDULES_KEY }); },
  });
}

/** Résumé lisible d'une récurrence (« Le 1 de chaque mois à 09:00 »). */
export function describeEmailRecurrence(s: Pick<EmailSchedule, 'recurrence' | 'time_of_day' | 'day_of_week' | 'day_of_month'>): string {
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const at = s.time_of_day ?? '09:00';
  if (s.recurrence === 'weekly') return `Chaque ${days[s.day_of_week ?? 1]} à ${at}`;
  if (s.recurrence === 'monthly') {
    return s.day_of_month === 0 ? `Le dernier jour du mois à ${at}` : `Le ${s.day_of_month ?? 1} de chaque mois à ${at}`;
  }
  return `Chaque jour à ${at}`;
}
