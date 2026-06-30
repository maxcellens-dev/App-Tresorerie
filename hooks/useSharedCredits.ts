// Crédits partagés — invitations / membres (calqué sur useSharedAccounts).
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

const ok = () => !!supabase;

export interface CreditInvitation {
  invite_id: string; credit_id: string; credit_label: string; role: 'write' | 'read'; from_name: string; created_at: string;
}
export interface CreditMember {
  id: string; credit_id: string; user_id: string | null; display_name: string; role: 'write' | 'read'; created_at: string;
}

export function useCreditInvitations(userId: string | undefined) {
  return useQuery({
    queryKey: ['credit_invitations', userId],
    enabled: !!userId && ok(),
    queryFn: async (): Promise<CreditInvitation[]> => {
      // p_user = user consulté → l'admin en impersonation voit les invitations du user visité (sinon
      // auth.uid() = l'admin). Un user normal ne peut viser que lui-même (gardé côté RPC).
      const { data, error } = await supabase!.rpc('credit_my_invitations', { p_user: userId });
      if (error) throw error;
      return (data ?? []) as CreditInvitation[];
    },
  });
}

export function useRespondCreditInvitation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc(input.accept ? 'credit_accept_invitation' : 'credit_decline_invitation', { p_invite: input.inviteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credit_invitations', userId] });
      qc.invalidateQueries({ queryKey: ['credits'] });
    },
  });
}

export function useCreditMembers(creditId: string | undefined) {
  return useQuery({
    queryKey: ['credit_members', creditId],
    enabled: !!creditId && ok(),
    queryFn: async (): Promise<CreditMember[]> => {
      const { data, error } = await supabase!.from('credit_members').select('id, credit_id, user_id, display_name, role, created_at').eq('credit_id', creditId!).order('created_at');
      if (error) throw error;
      return (data ?? []) as CreditMember[];
    },
  });
}

export function useInviteToCredit(creditId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; role?: 'write' | 'read' }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('credit_invite_by_code', { p_credit: creditId, p_code: input.code.trim(), p_role: input.role ?? 'write' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_members', creditId] }),
  });
}

export function useSetCreditMemberRole(creditId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; role: 'write' | 'read' }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('credit_set_member_role', { p_member: input.memberId, p_role: input.role });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credit_members', creditId] }),
  });
}

export function useRemoveCreditMember(creditId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('credit_remove_member', { p_member: memberId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['credit_members', creditId] }); qc.invalidateQueries({ queryKey: ['credits'] }); },
  });
}

/** Temps réel : un changement de membre/invitation de crédit rafraîchit les listes. */
export function useSharedCreditsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`shared_credits_${userId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_members' }, () => {
        qc.invalidateQueries({ queryKey: ['credits'] });
        qc.invalidateQueries({ queryKey: ['credit_members'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_invitations', filter: `to_user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ['credit_invitations', userId] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId, qc]);
}
