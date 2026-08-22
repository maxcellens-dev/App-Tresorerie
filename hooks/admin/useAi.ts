// Conseils IA — hooks de données (config, prompts, quota, historique). L'APPEL au modèle est dans
// l'Edge Function (useAskAi, fichier séparé) — la clé API n'est jamais côté client.
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { sendPushToProfile } from '../../lib/platform/pushSend';
import { purchaseGemsPack, type PurchaseResult } from '../../lib/platform/purchases';

export interface AiModel { id: string; label: string; enabled: boolean }
/** Offre de recharge (click-to-pay) : N requêtes pour un prix. product_id = identifiant Store/RevenueCat. */
export interface AiCreditPack { id: string; credits: number; price_cents: number; product_id: string }
export interface AiConfig {
  id: string;
  models: AiModel[];
  free_monthly_limit: number;
  premium_monthly_limit: number;
  daily_global_cap: number;
  open_to_all: boolean;
  pay_to_use_enabled: boolean;
  pay_to_use_price_cents: number;
  /** Quota gratuit épuisé + aucun crédit acheté → continuer sur la clé payante (coût éditeur). */
  paid_fallback_enabled?: boolean;
  /** Offres de recharge de requêtes IA (click-to-pay). */
  extra_credit_packs?: AiCreditPack[];
  consent_text: string;
  predefined_questions: string[];
  /** Couper la notification PUSH admin des tickets (badges/historique restent actifs). */
  notify_admins_push?: boolean;
}
export interface AiPrompt { key: string; title: string; prompt_template: string; sort_order: number; is_active: boolean }
export interface AiMessage { id: string; profile_id: string; role: 'user' | 'assistant' | 'admin'; content: string; model: string | null; kind: string | null; analysis_key: string | null; counted: boolean; created_at: string; conversation_id?: string | null }
export interface AiConversation { id: string; profile_id: string; title: string; created_at: string; updated_at: string }
/** Quota mensuel + solde de crédits payants (rechargés). */
export interface AiQuota { used: number; limit: number; remaining: number; is_premium: boolean; extra_credits: number }
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

/** Analyse proposée à l'utilisateur : le TITRE seul (jamais le modèle de prompt). */
export interface AiAnalysisItem { key: string; title: string; sort_order: number }

/**
 * Liste des analyses ACTIVES pour la page utilisateur. Passe par la fonction `ai_analyses()`
 * (migration 201) : le texte des prompts reste côté serveur. Repli sur la lecture directe tant que
 * la migration n'est pas appliquée — sans lui, la liste d'analyses serait vide entre l'OTA et la
 * migration. (Le repli devient inopérant une fois la migration 202 jouée, ce qui est voulu : à ce
 * moment-là, la table n'est plus lisible que par un admin.)
 */
export function useAiAnalyses() {
  return useQuery({
    queryKey: ['ai_analyses'],
    queryFn: async (): Promise<AiAnalysisItem[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.rpc('ai_analyses');
      if (!error) return (data ?? []) as AiAnalysisItem[];
      // Fonction absente (migration pas encore jouée) → ancienne lecture de la table.
      const { data: rows, error: e2 } = await supabase.from('ai_prompts').select('key, title, sort_order, is_active').order('sort_order');
      if (e2) throw e2;
      return ((rows ?? []) as any[])
        .filter((p) => p.is_active && String(p.key).startsWith('analysis_'))
        .map((p) => ({ key: p.key, title: p.title, sort_order: p.sort_order }));
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

/**
 * Achat d'un pack de requêtes IA (click-to-pay) via RevenueCat.
 *
 * Flux : on déclenche l'achat store (même mécanisme que les packs de Relyks). En cas de succès, c'est
 * le WEBHOOK RevenueCat (Edge Function `revenuecat-webhook`, service role) qui crédite le ledger
 * `ai_extra_credits` de façon SÛRE (vérifié serveur, pas de triche client). Le crédit arrive en quelques
 * secondes → on rafraîchit le quota plusieurs fois après l'achat.
 */
export function usePurchaseExtraCredits(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pack: AiCreditPack): Promise<PurchaseResult> => {
      const res = await purchaseGemsPack(pack.product_id); // achat consommable par product_id
      if (!res.ok) {
        const err = new Error(res.message ?? res.reason ?? 'purchase_failed') as Error & { reason?: string };
        err.reason = res.reason;
        throw err;
      }
      return res;
    },
    onSuccess: () => {
      // Le webhook crédite le ledger de façon asynchrone → on relit le quota plusieurs fois.
      const refetch = () => qc.invalidateQueries({ queryKey: ['ai_quota', userId] });
      refetch();
      [1500, 4000, 8000, 15000].forEach((ms) => setTimeout(refetch, ms));
    },
  });
}

/** ADMIN — offre N crédits payants à un utilisateur (test / support / geste commercial). */
export function useGrantExtraCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; qty: number; reason?: string }): Promise<number> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.rpc('ai_grant_extra_credits', {
        p_user: input.userId, p_qty: input.qty, p_reason: input.reason ?? 'admin_grant',
      });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['ai_quota', v.userId] }),
  });
}

/** Liste des conversations de l'utilisateur (les plus récentes en tête). */
export function useAiConversations(userId: string | undefined) {
  return useQuery({
    queryKey: ['ai_conversations', userId],
    enabled: !!userId && !!supabase,
    queryFn: async (): Promise<AiConversation[]> => {
      const { data, error } = await supabase!.from('ai_conversations').select('*').eq('profile_id', userId!).order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AiConversation[];
    },
  });
}

/** Crée une conversation (titre depuis le 1ᵉʳ message) → renvoie son id. */
export function useCreateConversation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (title?: string): Promise<AiConversation> => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const clean = (title ?? '').trim().slice(0, 80) || 'Nouvelle conversation';
      const { data, error } = await supabase.from('ai_conversations').insert({ profile_id: userId, title: clean }).select('*').single();
      if (error) throw new Error(error.message);
      return data as AiConversation;
    },
    /* La nouvelle conversation est écrite DANS LE CACHE tout de suite, avant l'invalidation.
       Sans ça, la page sélectionnait un fil que sa propre liste (encore périmée, le temps d'un
       aller-retour réseau) ne contenait pas : son garde-fou « la conversation courante a disparu »
       la dé-sélectionnait aussitôt, et la question posée — comme la réponse qui suit — atterrissait
       dans un fil que l'utilisateur ne regardait plus. */
    onSuccess: (conv) => {
      qc.setQueryData<AiConversation[]>(['ai_conversations', userId], (old) =>
        (old ?? []).some((c) => c.id === conv.id) ? (old ?? []) : [conv, ...(old ?? [])]);
      qc.invalidateQueries({ queryKey: ['ai_conversations', userId] });
    },
  });
}

/** Renomme une conversation. */
export function useRenameConversation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; title: string }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      // Filtre sur le profil EN PLUS de la RLS : la policy autorise aussi l'admin, un id erroné
      // renommerait alors la conversation de quelqu'un d'autre.
      const { error } = await supabase.from('ai_conversations')
        .update({ title: input.title.trim().slice(0, 80) || 'Conversation' })
        .eq('id', input.id).eq('profile_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_conversations', userId] }),
  });
}

/** Supprime une conversation (ses messages partent en cascade). */
export function useDeleteConversation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase.from('ai_conversations').delete().eq('id', id).eq('profile_id', userId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_conversations', userId] });
      qc.invalidateQueries({ queryKey: ['ai_messages', userId] });
    },
  });
}

/** Historique d'UNE conversation (ou du user visité en admin, toutes conversations si conversationId absent). */
export function useAiMessages(userId: string | undefined, conversationId?: string | null) {
  return useQuery({
    queryKey: ['ai_messages', userId, conversationId ?? 'all'],
    enabled: !!userId && !!supabase && conversationId !== null, // null = « nouvelle conversation » vide
    queryFn: async (): Promise<AiMessage[]> => {
      let q = supabase!.from('ai_messages').select('*').eq('profile_id', userId!);
      if (conversationId) q = q.eq('conversation_id', conversationId);
      const { data, error } = await q.order('created_at');
      if (error) throw error;
      return (data ?? []) as AiMessage[];
    },
  });
}

/** Rafraîchit le fil en TEMPS RÉEL (réponses admin, relances…) sans recharger la page. */
export function useAiMessagesRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`ai_messages_${userId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_messages', filter: `profile_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ['ai_messages', userId] });
        qc.invalidateQueries({ queryKey: ['ai_quota', userId] });
        qc.invalidateQueries({ queryKey: ['ai_conversations', userId] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId, qc]);
}

/** TEMPS RÉEL sur le solde de crédits payants : dès que le webhook RevenueCat insère un crédit
 *  (achat validé, parfois avec quelques secondes de latence), le compteur se met à jour tout seul. */
export function useAiExtraCreditsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`ai_extra_credits_${userId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_extra_credits', filter: `profile_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ['ai_quota', userId] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId, qc]);
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

/** Métriques top-line d'un bilan (évolution inter-bilans) — persistées dans ai_bilan_metrics. */
export interface BilanMetricsRow { patrimoine: number; checking: number; savings: number; invested: number; engaged: number; balance12: number; income: number; score: number }

/** Dernier bilan global persisté (pour la section ÉVOLUTION du snapshot). null si aucun. */
export function usePreviousBilanMetrics(userId: string | undefined) {
  return useQuery({
    queryKey: ['ai_bilan_metrics', userId],
    enabled: !!userId && !!supabase,
    queryFn: async (): Promise<{ date: string; metrics: BilanMetricsRow } | null> => {
      const { data, error } = await supabase!
        .from('ai_bilan_metrics')
        .select('metrics, created_at')
        .eq('profile_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { date: String((data as any).created_at).slice(0, 10), metrics: (data as any).metrics as BilanMetricsRow };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Persiste les métriques du bilan courant après un bilan global réussi, puis élague au-delà de 24
 *  lignes (2 ans de bilans mensuels) — l'évolution n'a besoin que du dernier point. */
export function useSaveBilanMetrics(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (metrics: BilanMetricsRow) => {
      if (!supabase || !userId) return;
      const { error } = await supabase.from('ai_bilan_metrics').insert({ profile_id: userId, metrics });
      if (error) throw error;
      // Élagage : ne garder que les 24 plus récentes.
      const { data: old } = await supabase.from('ai_bilan_metrics')
        .select('id').eq('profile_id', userId).order('created_at', { ascending: false }).range(24, 1000);
      const ids = (old ?? []).map((r: any) => r.id);
      if (ids.length) await supabase.from('ai_bilan_metrics').delete().in('id', ids);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_bilan_metrics', userId] }),
  });
}

export interface AskAiInput { kind: 'analysis' | 'chat'; analysis_key?: string; question?: string; snapshot: string; model?: string; conversation_id?: string }
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
      qc.invalidateQueries({ queryKey: ['ai_conversations', userId] });
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

export interface AiModelStatus { id: string; ok: boolean; status: number; reason: string }
/** Résultat du test : dispo par modèle sur la clé GRATUITE + (si configurée) la clé PAYANTE. */
export interface AiModelsCheck { results: AiModelStatus[]; paid: AiModelStatus[] | null; paid_configured: boolean }
/** Teste en direct la disponibilité de chaque modèle configuré (admin) — clés gratuite ET payante. */
export function useCheckAiModels() {
  return useMutation({
    mutationFn: async (): Promise<AiModelsCheck> => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data, error } = await supabase.functions.invoke('ai-advice', { body: { admin_check_models: true } });
      if (error) throw new Error(error.message || 'Échec du test');
      return {
        results: (data?.results ?? []) as AiModelStatus[],
        paid: (data?.paid ?? null) as AiModelStatus[] | null,
        paid_configured: !!data?.paid_configured,
      };
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_tickets'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}

/** Réponse MANUELLE de l'admin, postée dans le fil du user (role='admin'), puis ticket résolu. */
export function useAdminReplyAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profileId: string; content: string; ticketId?: string; conversationId?: string | null }) => {
      if (!supabase) throw new Error('Backend indisponible');
      // Cible = la conversation du ticket (pour répondre dans le bon fil), sinon celle fournie.
      let convId = input.conversationId ?? null;
      if (!convId && input.ticketId) {
        const { data: tk } = await supabase.from('ai_tickets').select('conversation_id').eq('id', input.ticketId).maybeSingle();
        convId = (tk as any)?.conversation_id ?? null;
      }
      /* Un message SANS conversation est INVISIBLE pour l'utilisateur : sa page n'affiche jamais que
         le fil sélectionné (`conversation_id = …`). Un ticket sans conversation (ancien ticket, ou
         conversation supprimée depuis) donnait donc une réponse dans le vide — avec en prime une
         notification push annonçant une réponse introuvable. On rattache donc à sa conversation la
         plus récente, et on en crée une si le user n'en a aucune. */
      if (!convId) {
        const { data: last } = await supabase.from('ai_conversations')
          .select('id').eq('profile_id', input.profileId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        convId = (last as any)?.id ?? null;
        if (!convId) {
          const { data: created, error: cErr } = await supabase.from('ai_conversations')
            .insert({ profile_id: input.profileId, title: 'Réponse de l\'équipe Relyka' }).select('id').single();
          if (cErr) throw new Error(cErr.message);
          convId = (created as any).id as string;
        }
      }
      const { error } = await supabase.from('ai_messages').insert({ profile_id: input.profileId, role: 'admin', content: input.content, conversation_id: convId });
      if (error) throw new Error(error.message);
      // Le fil remonte en tête : la page s'ouvre sur la conversation la plus récemment active, une
      // réponse tardive resterait sinon invisible sous des conversations plus récentes.
      await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId);
      if (input.ticketId) await supabase.from('ai_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', input.ticketId);
      // Notifie le user que sa demande a reçu une réponse.
      sendPushToProfile(input.profileId, 'Conseils Intelligents', 'Une réponse à ta demande est disponible.').catch(() => {});
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['ai_tickets'] });
      qc.invalidateQueries({ queryKey: ['ai_messages', v.profileId] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
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
      if (res.ok) sendPushToProfile(input.profileId, 'Conseils Intelligents', 'Ton analyse est prête, ouvre l\'app pour la consulter.').catch(() => {});
      return res;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['ai_tickets'] });
      qc.invalidateQueries({ queryKey: ['ai_messages', v.profileId] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}
