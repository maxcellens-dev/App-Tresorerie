/**
 * Assistance — demandes de support et fil de messages (utilisateur ⇄ admin).
 * Tables : support_requests + support_messages (migration 036).
 * Rafraîchissement régulier (polling) pour un échange "en direct".
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { notifyAdminsEvent } from '../../lib/platform/pushSend';

export interface SupportRequest {
  id: string;
  profile_id: string;
  profile_email: string | null;
  subject: string;
  status: 'open' | 'closed';
  user_unread: boolean;
  admin_unread: boolean;
  created_at: string;
  last_message_at: string;
}

export interface SupportMessage {
  id: string;
  request_id: string;
  sender_role: 'user' | 'admin';
  author_id: string | null;
  body: string;
  created_at: string;
}

// ── Côté utilisateur ────────────────────────────────────────────

export function useMySupportRequests(profileId: string | undefined) {
  return useQuery({
    queryKey: ['support_requests', 'mine', profileId],
    queryFn: async (): Promise<SupportRequest[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('support_requests')
        .select('*')
        .eq('profile_id', profileId)
        .order('last_message_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportRequest[];
    },
    enabled: !!profileId,
    refetchInterval: 20000,
  });
}

/** Longueurs acceptées par le serveur (cf. migration 212). Le client borne AVANT d'envoyer, pour
 *  que la limite se voie en tapant plutôt que sous forme de refus après coup. */
export const SUPPORT_MAX_BODY = 5000;
export const SUPPORT_MAX_SUBJECT = 150;

export function useCreateSupportRequest(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ subject, body }: { subject: string; body: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      /* UNE SEULE OPÉRATION, côté serveur (migration 212).
         On enchaînait deux écritures : la demande, puis son premier message. Un échec de la seconde
         laissait une demande SANS message — un fil vide, visible par l'utilisateur comme par
         l'équipe, que rien ne permettait d'expliquer ni de rattraper. La fonction serveur fait les
         deux dans la même transaction, et pose elle-même l'identité de l'auteur (le client ne
         choisit plus ni l'adresse e-mail affichée à l'équipe, ni les drapeaux « non lu »). */
      const { data, error } = await supabase.rpc('create_support_request', {
        p_subject: subject.trim().slice(0, SUPPORT_MAX_SUBJECT),
        p_body: body.trim().slice(0, SUPPORT_MAX_BODY),
      });
      if (error) throw error;
      const req = (Array.isArray(data) ? data[0] : data) as SupportRequest;
      // Notifie les admins (événementiel, respecte leurs préférences push).
      const excerpt = body.trim().slice(0, 160);
      notifyAdminsEvent('support', `Assistance — ${(subject.trim() || 'nouvelle demande')}`, excerpt)
        .catch(() => {});
      return req;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support_requests'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}

// ── Côté admin ──────────────────────────────────────────────────

/** Au-delà, on ne charge plus : la liste d'administration est faite pour être traitée, pas archivée. */
export const SUPPORT_ADMIN_PAGE = 200;

export function useAllSupportRequests(enabled = true) {
  return useQuery({
    queryKey: ['support_requests', 'all'],
    queryFn: async (): Promise<{ rows: SupportRequest[]; total: number }> => {
      if (!supabase) return { rows: [], total: 0 };
      /* PLAFOND EXPLICITE. La requête ramenait TOUTES les demandes de TOUS les utilisateurs, toutes
         les vingt secondes, et l'écran les rendait d'un bloc. Ça tient tant qu'elles se comptent en
         dizaines ; avec quelques milliers d'utilisateurs, chaque rafraîchissement devient un
         transfert inutile et la page se fige au rendu. On prend les plus récentes — celles qui
         attendent une réponse — et on dit franchement combien il y en a en tout. */
      const { data, error, count } = await supabase
        .from('support_requests')
        .select('*', { count: 'exact' })
        .order('last_message_at', { ascending: false })
        .limit(SUPPORT_ADMIN_PAGE);
      if (error) throw error;
      return { rows: (data ?? []) as SupportRequest[], total: count ?? (data?.length ?? 0) };
    },
    enabled,
    refetchInterval: 20000,
  });
}

// ── Une demande (live, pour refléter le statut dans le fil) ─────

export function useSupportRequest(requestId: string | undefined) {
  return useQuery({
    queryKey: ['support_request', requestId],
    queryFn: async (): Promise<SupportRequest | null> => {
      if (!supabase || !requestId) return null;
      const { data, error } = await supabase.from('support_requests').select('*').eq('id', requestId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as SupportRequest | null;
    },
    enabled: !!requestId,
    refetchInterval: 8000,
  });
}

// ── Fil de messages (commun) ────────────────────────────────────

export function useSupportMessages(requestId: string | undefined) {
  return useQuery({
    queryKey: ['support_messages', requestId],
    queryFn: async (): Promise<SupportMessage[]> => {
      if (!supabase || !requestId) return [];
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as SupportMessage[];
    },
    enabled: !!requestId,
    refetchInterval: 8000,
  });
}

export function useAddSupportMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, role, authorId, body }: { requestId: string; role: 'user' | 'admin'; authorId?: string; body: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      /* `sender_role` et `author_id` sont envoyés pour rester lisibles côté client, mais le serveur
         les REMPLACE par ce qu'il déduit du compte appelant (migration 212) : on ne peut plus écrire
         un message signé « Assistance » depuis un compte ordinaire. */
      const { error } = await supabase
        .from('support_messages')
        .insert({ request_id: requestId, sender_role: role, author_id: authorId ?? null, body: body.trim().slice(0, SUPPORT_MAX_BODY) });
      if (error) throw error;
      /* HORODATAGE, RÉOUVERTURE ET DRAPEAU « NON LU » : POSÉS PAR LE SERVEUR.
         Ils étaient écrits ici, par une mise à jour dont personne ne lisait le résultat. Quand elle
         échouait — règle d'accès, réseau coupé entre les deux appels — le message partait quand même
         mais son destinataire n'était jamais prévenu : pas de pastille, et la demande restait au
         fond de la liste avec sa vieille date. Un déclencheur s'en charge désormais, dans la même
         transaction que l'insertion du message.
         PAS de push non plus : une seule notification par conversation, à sa création. */
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['support_messages', vars.requestId] });
      qc.invalidateQueries({ queryKey: ['support_requests'] });
      qc.invalidateQueries({ queryKey: ['support_request', vars.requestId] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}

export function useSetSupportStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: 'open' | 'closed' }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('support_requests').update({ status }).eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['support_requests'] });
      qc.invalidateQueries({ queryKey: ['support_request', vars.requestId] });
    },
  });
}

/** Supprime une demande (admin). Les messages partent en cascade. */
export function useDeleteSupportRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('support_requests').delete().eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support_requests'] }); },
  });
}

/**
 * Supprime les demandes clôturées DÉSIGNÉES (admin).
 *
 * ⚠️ La version précédente effaçait `WHERE status = 'closed'` — c'est-à-dire TOUTES les demandes
 * clôturées de la base. Or le bouton annonce un nombre calculé sur ce qui est affiché à l'écran
 * (une page de résultats) : on confirmait « supprimer 12 demandes » et on en supprimait cinq cents,
 * définitivement, sans qu'aucun écran ne l'ait montré. On supprime donc exactement ce qui a été
 * annoncé, et rien d'autre.
 */
export function useDeleteClosedSupportRequests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!supabase) throw new Error('Backend indisponible');
      if (!ids.length) return;
      const { error } = await supabase.from('support_requests').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support_requests'] }); },
  });
}

/** Marque une demande comme lue côté 'user' ou 'admin' (efface le drapeau). */
export function useMarkSupportRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, side }: { requestId: string; side: 'user' | 'admin' }) => {
      if (!supabase) return;
      const patch = side === 'user' ? { user_unread: false } : { admin_unread: false };
      // L'erreur était ignorée : la pastille « non lu » restait alors indéfiniment, sur une
      // conversation pourtant ouverte et lue. On la remonte — react-query réessaie.
      const { error } = await supabase.from('support_requests').update(patch).eq('id', requestId);
      if (error) throw error;
    },
    // Une pastille qui ne s'efface pas n'est pas un incident : on retente, sans rien afficher.
    retry: 2,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support_requests'] });
      qc.invalidateQueries({ queryKey: ['unread_badges'] });
    },
  });
}
