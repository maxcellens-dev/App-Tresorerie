// Conseils IA — hooks de données (config, prompts, quota, historique). L'APPEL au modèle est dans
// l'Edge Function (useAskAi, fichier séparé) — la clé API n'est jamais côté client.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { sendPushToProfile } from '../lib/pushSend';

export interface AiModel { id: string; label: string; enabled: boolean }
export interface AiConfig {
  id: string;
  models: AiModel[];
  free_monthly_limit: number;
  premium_monthly_limit: number;
  daily_global_cap: number;
  open_to_all: boolean;
  pay_to_use_enabled: boolean;
  pay_to_use_price_cents: number;
  consent_text: string;
  predefined_questions: string[];
}
export interface AiPrompt { key: string; title: string; prompt_template: string; sort_order: number; is_active: boolean }
export interface AiMessage { id: string; profile_id: string; role: 'user' | 'assistant' | 'admin'; content: string; model: string | null; kind: string | null; analysis_key: string | null; counted: boolean; created_at: string }
export interface AiQuota { used: number; limit: number; remaining: number; is_premium: boolean }
export interface AiTicket { id: string; profile_id: string; user_message_id: string | null; request: any; error: string | null; status: 'open' | 'resolved'; created_at: string; resolved_at: string | null }

export function useAiConfig() {
  return useQuery({
    queryKey: ['ai_config'],
    queryFn: async (): Promise<AiConfig | null> => {
      if (!supabase) return null;
      const { data, error } = await supabase.from('ai_config').select('*').eq('id', 'default').maybeSingle();
      if (error) throw error;
      return data as AiConfig | null;
    },
  });
}

export function useUpdateAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AiConfig>) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('ai_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_config'] }),
  });
}

export function useAiPrompts() {
  return useQuery({
    queryKey: ['ai_prompts'],
    queryFn: async (): Promise<AiPrompt[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('ai_prompts').select('*').order('sort_order');
      if (error) throw error;
      return (data ?? []) as AiPrompt[];
    },
  });
}

export function useUpdateAiPrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; title?: string; prompt_template?: string; is_active?: boolean; sort_order?: number }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { key, ...patch } = input;
      const { error } = await supabase.from('ai_prompts').update({ ...patch, updated_at: new Date().toISOString() }).eq('key', key);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_prompts'] }),
  });
}

/** Quota du mois (used / limit / remaining). p_user pour l'admin en consultation. */
export function useAiQuota(userId: string | undefined) {
  return useQuery({
    queryKey: ['ai_quota', userId],
    enabled: !!userId && !!supabase,
    queryFn: async (): Promise<AiQuota | null> => {
      const { data, error } = await supabase!.rpc('ai_my_quota', { p_user: userId });
      if (error) throw error;
      return data as AiQuota;
    },
  });
}

/** Historique de chat de l'utilisateur (ou du user visité en admin). */
export function useAiMessages(userId: string | undefined) {
  return useQuery({
    queryKey: ['ai_messages', userId],
    enabled: !!userId && !!supabase,
    queryFn: async (): Promise<AiMessage[]> => {
      const { data, error } = await supabase!.from('ai_messages').select('*').eq('profile_id', userId!).order('created_at');
      if (error) throw error;
      return (data ?? []) as AiMessage[];
    },
  });
}

/** Purge tout l'historique de l'utilisateur (autorisé même en non-Premium). */
export function useDeleteAiHistory(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase.from('ai_messages').delete().eq('profile_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_messages', userId] }),
  });
}

export interface AskAiInput { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string; snapshot: string; model?: string }
export interface AskAiResult { ok: boolean; queued?: boolean; reply?: string; model?: string; used?: number; limit?: number; error?: string }

/**
 * Envoie une requête à l'Edge Function `ai-advice` (la clé API reste serveur). Gère les réponses
 * d'erreur applicatives (quota, premium…) en lisant le corps même sur statut non-2xx.
 */
export function useAskAi(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AskAiInput): Promise<AskAiResult> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('ai-advice', { body: input });
      if (error) {
        // FunctionsHttpError : le corps JSON (quota_exceeded, premium_required…) est dans error.context.
        const ctx = (error as any).context;
        if (ctx && typeof ctx.json === 'function') {
          try { const body = await ctx.json(); return { ok: false, ...body }; } catch { /* noop */ }
        }
        throw new Error(error.message || 'Échec de la requête IA');
      }
      return data as AskAiResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_messages', userId] });
      qc.invalidateQueries({ queryKey: ['ai_quota', userId] });
    },
  });
}

/** Tickets d'assistance IA (admin) — échecs à relancer. */
export function useAiTickets() {
  return useQuery({
    queryKey: ['ai_tickets'],
    queryFn: async (): Promise<AiTicket[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('ai_tickets').select('*').eq('status', 'open').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AiTicket[];
    },
  });
}

/** Marque un ticket résolu (sans réponse, ou après une réponse manuelle/relance). */
export function useResolveAiTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ticketId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('ai_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', ticketId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_tickets'] }),
  });
}

/** Réponse MANUELLE de l'admin, postée dans le fil du user (role='admin'), puis ticket résolu. */
export function useAdminReplyAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profileId: string; content: string; ticketId?: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('ai_messages').insert({ profile_id: input.profileId, role: 'admin', content: input.content });
      if (error) throw new Error(error.message);
      if (input.ticketId) await supabase.from('ai_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', input.ticketId);
      // Notifie le user que sa demande a reçu une réponse.
      sendPushToProfile(input.profileId, 'Conseils IA', 'Une réponse à ta demande est disponible.').catch(() => {});
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['ai_tickets'] });
      qc.invalidateQueries({ queryKey: ['ai_messages', v.profileId] });
    },
  });
}

/** Relance d'une requête échouée par l'admin via le modèle, SANS décompter le quota du user. */
export function useAdminRelaunchAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ticketId: string; profileId: string; snapshot: string; kind: 'analysis' | 'chat'; analysis_key?: string; question?: string }): Promise<AskAiResult> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('ai-advice', {
        body: { admin_relaunch: true, target_user: input.profileId, ticket_id: input.ticketId, kind: input.kind, analysis_key: input.analysis_key, question: input.question, snapshot: input.snapshot },
      });
      if (error) throw new Error(error.message || 'Échec de la relance');
      const res = data as AskAiResult;
      // Réponse postée dans le fil du user → on le notifie.
      if (res.ok) sendPushToProfile(input.profileId, 'Conseils IA', 'Ton analyse est prête, ouvre l\'app pour la consulter.').catch(() => {});
      return res;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['ai_tickets'] });
      qc.invalidateQueries({ queryKey: ['ai_messages', v.profileId] });
    },
  });
}
