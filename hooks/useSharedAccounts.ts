/**
 * useSharedAccounts — hooks de données pour les comptes partagés / joints.
 * Calqué sur le flux d'invitation Relyka World (rw_*) mais pour de VRAIS comptes (table accounts).
 *
 * - Invitation par code public (rôle write/read) ou par simple nom (membre externe non inscrit).
 * - Acceptation / refus d'une invitation reçue.
 * - Gestion des membres (changement de rôle, retrait) côté owner.
 *
 * RLS / RPC : cf. migrations 096 & 097 (acct_*). Le partage de comptes PERSO est gated côté serveur
 * par le flag admin perso_account_sharing_enabled ; les comptes joints dédiés sont toujours autorisés.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const ok = () => !!supabase;

export type AccountRole = 'owner' | 'write' | 'read';

export interface AccountInvitation {
  invite_id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  is_joint: boolean;
  role: 'write' | 'read';
  from_name: string;
  created_at: string;
}

export interface AccountMember {
  id: string;
  account_id: string;
  user_id: string | null;       // NULL = invité en attente / externe non inscrit
  display_name: string;
  role: AccountRole;
  created_at: string;
}

/**
 * Souscription TEMPS RÉEL des comptes partagés/joints : quand un autre membre modifie le compte
 * (transaction → solde recalculé → UPDATE accounts), ou qu'un membre/une invitation change, on
 * rafraîchit les vues concernées. La RLS de chaque table limite déjà ce que l'on reçoit.
 * À monter une fois (ex. dans la barre d'onglets, toujours présente).
 */
export function useSharedAccountsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !userId) return;
    const channel = supabase
      .channel(`shared_accounts_${userId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, () => {
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['transactions'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_members' }, () => {
        qc.invalidateQueries({ queryKey: ['accounts'] });
        qc.invalidateQueries({ queryKey: ['account_members'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'account_invitations', filter: `to_user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ['acct_invitations', userId] });
      })
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [userId, qc]);
}

/** Invitations de compte en attente pour l'utilisateur courant (enrichies : nom du compte + invitant). */
export function useAccountInvitations(userId: string | undefined) {
  const { isImpersonating } = useAuth();
  return useQuery({
    queryKey: ['acct_invitations', userId],
    enabled: !!userId && ok() && !isImpersonating,
    queryFn: async (): Promise<AccountInvitation[]> => {
      const { data, error } = await supabase!.rpc('acct_my_invitations');
      if (error) throw error;
      return (data ?? []) as AccountInvitation[];
    },
  });
}

/** Accepter / refuser une invitation de compte. */
export function useRespondAccountInvitation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const fn = input.accept ? 'acct_accept_invitation' : 'acct_decline_invitation';
      const { error } = await supabase.rpc(fn, { p_invite: input.inviteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acct_invitations', userId] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['transactions'] }); // historique du compte rejoint
      qc.invalidateQueries({ queryKey: ['pilotage_data'] });
    },
  });
}

/**
 * Participants d'un compte (propriétaire + membres inscrits) : { user_id, display_name }.
 * Sert à afficher l'AUTEUR d'une transaction sur un compte partagé/joint sans exposer les comptes
 * personnels des autres utilisateurs.
 */
export function useAccountParticipants(accountId: string | undefined) {
  return useQuery({
    queryKey: ['account_participants', accountId],
    enabled: !!accountId && ok(),
    queryFn: async (): Promise<{ user_id: string; display_name: string }[]> => {
      const { data, error } = await supabase!.rpc('acct_participants', { p_account: accountId });
      if (error) throw error;
      return (data ?? []) as { user_id: string; display_name: string }[];
    },
  });
}

/**
 * Participants de TOUS mes comptes accessibles (propriétaires + membres) → map globale pour afficher
 * l'auteur d'une transaction dans la page Transactions (qui mélange plusieurs comptes).
 */
export function useAllParticipants(userId: string | undefined) {
  return useQuery({
    queryKey: ['acct_all_participants', userId],
    enabled: !!userId && ok(),
    queryFn: async (): Promise<{ user_id: string; display_name: string }[]> => {
      const { data, error } = await supabase!.rpc('acct_all_participants');
      if (error) throw error;
      return (data ?? []) as { user_id: string; display_name: string }[];
    },
  });
}

/** Membres d'un compte (pour l'écran de gestion / partage côté owner). */
export function useAccountMembers(accountId: string | undefined) {
  return useQuery({
    queryKey: ['account_members', accountId],
    enabled: !!accountId && ok(),
    queryFn: async (): Promise<AccountMember[]> => {
      const { data, error } = await supabase!
        .from('account_members')
        .select('id, account_id, user_id, display_name, role, created_at')
        .eq('account_id', accountId!)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AccountMember[];
    },
  });
}

/** Inviter sur un compte par code public (rôle write/read), ou ajouter un membre « simple nom ». */
export function useInviteToAccount(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code?: string; name: string; role?: 'write' | 'read' }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const role = input.role ?? 'write';
      if (input.code && input.code.trim()) {
        const { error } = await supabase.rpc('acct_invite_by_code', {
          p_account: accountId, p_code: input.code.trim(), p_name: input.name ?? '', p_role: role,
        });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.rpc('acct_add_named_member', {
          p_account: accountId, p_name: input.name ?? '', p_role: role,
        });
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_members', accountId] }); },
  });
}

/** Changer le rôle d'un membre (owner only). read <-> write sans ré-inviter. */
export function useSetMemberRole(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; role: 'write' | 'read' }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('acct_set_member_role', { p_member: input.memberId, p_role: input.role });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_members', accountId] }); },
  });
}

/** Renommer un membre (utile pour les invités « simple nom » non inscrits). Owner only (RLS). */
export function useRenameMember(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { memberId: string; name: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase
        .from('account_members')
        .update({ display_name: input.name.trim() || 'Invité' })
        .eq('id', input.memberId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_members', accountId] }); },
  });
}

/** Retirer un membre / révoquer un accès (owner only). */
export function useRemoveMember(accountId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('acct_remove_member', { p_member: memberId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account_members', accountId] }); },
  });
}
