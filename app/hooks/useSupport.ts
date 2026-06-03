/**
 * Assistance — demandes de support et fil de messages (utilisateur ⇄ admin).
 * Tables : support_requests + support_messages (migration 036).
 * Rafraîchissement régulier (polling) pour un échange "en direct".
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

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

export function useCreateSupportRequest(profileId: string | undefined, profileEmail?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ subject, body }: { subject: string; body: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: req, error } = await supabase
        .from('support_requests')
        .insert({ profile_id: profileId, profile_email: profileEmail ?? null, subject: subject.trim() || 'Demande d’assistance', status: 'open', admin_unread: true, user_unread: false })
        .select('*')
        .single();
      if (error) throw error;
      const { error: msgErr } = await supabase
        .from('support_messages')
        .insert({ request_id: (req as any).id, sender_role: 'user', author_id: profileId, body: body.trim() });
      if (msgErr) throw msgErr;
      return req as SupportRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support_requests'] });
    },
  });
}

// ── Côté admin ──────────────────────────────────────────────────

export function useAllSupportRequests(enabled = true) {
  return useQuery({
    queryKey: ['support_requests', 'all'],
    queryFn: async (): Promise<SupportRequest[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('support_requests')
        .select('*')
        .order('last_message_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupportRequest[];
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
      const { error } = await supabase
        .from('support_messages')
        .insert({ request_id: requestId, sender_role: role, author_id: authorId ?? null, body: body.trim() });
      if (error) throw error;
      // Met à jour la demande : horodatage + drapeaux de lecture + réouverture si fermée.
      const patch: Record<string, any> = {
        last_message_at: new Date().toISOString(),
        status: 'open',
        ...(role === 'user' ? { admin_unread: true } : { user_unread: true }),
      };
      await supabase.from('support_requests').update(patch).eq('id', requestId);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['support_messages', vars.requestId] });
      qc.invalidateQueries({ queryKey: ['support_requests'] });
      qc.invalidateQueries({ queryKey: ['support_request', vars.requestId] });
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

/** Supprime en masse toutes les demandes clôturées (admin). */
export function useDeleteClosedSupportRequests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('support_requests').delete().eq('status', 'closed');
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
      await supabase.from('support_requests').update(patch).eq('id', requestId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support_requests'] }); },
  });
}
