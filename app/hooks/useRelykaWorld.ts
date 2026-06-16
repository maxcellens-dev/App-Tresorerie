/**
 * Relyka World — hooks de données (comptes partagés type Tricount).
 * Projets, participants, dépenses, répartition (shares), équilibres, invitations par ID.
 *
 * Intégration compte : si une dépense est « payée par moi » avec un compte choisi,
 * une VRAIE transaction (dépense) est créée sur ce compte ; « cash » → aucune transaction.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAddTransaction, useDeleteTransaction } from './useTransactions';

export interface RwProject {
  id: string; owner_id: string; name: string; emoji: string; description: string; currency: string; created_at: string;
}
export interface RwParticipant {
  id: string; project_id: string; user_id: string | null; display_name: string; created_at: string;
}
export interface RwExpense {
  id: string; project_id: string; title: string; emoji: string | null; amount: number; currency: string;
  date: string; paid_by: string; created_by: string | null; account_id: string | null; transaction_id: string | null; created_at: string;
}
export interface RwShare { id: string; expense_id: string; project_id: string; participant_id: string; amount: number; }
export interface RwInvitation {
  id: string; project_id: string; project_name: string; project_emoji: string | null; from_name: string; created_at: string;
}

const ok = () => !!supabase;

/** Liste des projets dont l'utilisateur est membre (RLS filtre). */
export function useRwProjects(userId: string | undefined) {
  return useQuery({
    queryKey: ['rw_projects', userId],
    enabled: !!userId && ok(),
    queryFn: async (): Promise<RwProject[]> => {
      const { data, error } = await supabase!.from('rw_projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RwProject[];
    },
  });
}

/** Un projet + ses participants. */
export function useRwProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['rw_project', projectId],
    enabled: !!projectId && ok(),
    queryFn: async (): Promise<{ project: RwProject | null; participants: RwParticipant[] }> => {
      const [{ data: proj }, { data: parts }] = await Promise.all([
        supabase!.from('rw_projects').select('*').eq('id', projectId).maybeSingle(),
        supabase!.from('rw_participants').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
      ]);
      return { project: (proj ?? null) as RwProject | null, participants: (parts ?? []) as RwParticipant[] };
    },
  });
}

/** Dépenses + répartitions d'un projet. */
export function useRwExpenses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['rw_expenses', projectId],
    enabled: !!projectId && ok(),
    queryFn: async (): Promise<{ expenses: RwExpense[]; shares: RwShare[] }> => {
      const [{ data: expenses }, { data: shares }] = await Promise.all([
        supabase!.from('rw_expenses').select('*').eq('project_id', projectId).order('date', { ascending: false }),
        supabase!.from('rw_expense_shares').select('*').eq('project_id', projectId),
      ]);
      return {
        expenses: (expenses ?? []).map((e: any) => ({ ...e, amount: Number(e.amount) })) as RwExpense[],
        shares: (shares ?? []).map((s: any) => ({ ...s, amount: Number(s.amount) })) as RwShare[],
      };
    },
  });
}

/** Solde net par participant : positif = on lui doit, négatif = il doit. */
export function computeBalances(participants: RwParticipant[], expenses: RwExpense[], shares: RwShare[]): Map<string, number> {
  const net = new Map<string, number>();
  participants.forEach((p) => net.set(p.id, 0));
  for (const e of expenses) net.set(e.paid_by, (net.get(e.paid_by) ?? 0) + e.amount);
  for (const s of shares) net.set(s.participant_id, (net.get(s.participant_id) ?? 0) - s.amount);
  return net;
}

/** Suggestions de remboursement « qui paie qui » (algorithme glouton). */
export function settleUp(balances: { id: string; amount: number }[]): { from: string; to: string; amount: number }[] {
  const debtors = balances.filter((b) => b.amount < -0.005).map((b) => ({ ...b })).sort((a, b) => a.amount - b.amount);
  const creditors = balances.filter((b) => b.amount > 0.005).map((b) => ({ ...b })).sort((a, b) => b.amount - a.amount);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(-debtors[i].amount, creditors[j].amount);
    if (pay > 0.005) out.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay * 100) / 100 });
    debtors[i].amount += pay; creditors[j].amount -= pay;
    if (Math.abs(debtors[i].amount) < 0.005) i++;
    if (Math.abs(creditors[j].amount) < 0.005) j++;
  }
  return out;
}

/** Crée un projet et ajoute le créateur comme participant. */
export function useCreateRwProject(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; emoji: string; description: string; myName: string }): Promise<RwProject> => {
      if (!supabase) throw new Error('Backend indisponible');
      // Création via RPC SECURITY DEFINER (owner_id = auth.uid() côté serveur, ajoute le créateur
      // en participant) → robuste face aux policies d'INSERT / RETURNING.
      const { data: pid, error } = await supabase.rpc('rw_create_project', {
        p_name: input.name, p_emoji: input.emoji, p_desc: input.description, p_myname: input.myName,
      });
      if (error) throw new Error(error.message);
      return { id: pid } as RwProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_projects'] }),
  });
}

export function useUpdateRwProject(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { name?: string; description?: string; emoji?: string }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_projects').update(patch).eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_project', projectId] }); qc.invalidateQueries({ queryKey: ['rw_projects'] }); },
  });
}

export function useDeleteRwProject(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_projects').delete().eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_projects'] }),
  });
}

/** Ajoute un participant « simple nom » (non inscrit). */
export function useAddRwParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_participants').insert({ project_id: projectId, user_id: null, display_name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

export function useRemoveRwParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (participantId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_participants').delete().eq('id', participantId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_project', projectId] }); qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); },
  });
}

/** Ajoute une dépense + sa répartition. Crée une vraie transaction si un compte est fourni. */
export function useAddRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const addTx = useAddTransaction(userId);
  return useMutation({
    mutationFn: async (input: {
      title: string; emoji?: string | null; amount: number; date: string; paidBy: string;
      shares: { participant_id: string; amount: number }[];
      accountId: string | null; projectName: string; categoryId?: string | null;
    }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      let transaction_id: string | null = null;
      // Compte choisi → vraie transaction (dépense) sur le compte du payeur (= moi).
      // Catégorie « Projets » + libellé commençant par le nom du projet (texte affiché en bleu côté UI).
      if (input.accountId) {
        const tx = await addTx.mutateAsync({
          account_id: input.accountId,
          category_id: input.categoryId ?? null,
          amount: -Math.abs(input.amount),
          date: input.date,
          note: `${input.projectName} · ${input.title || 'Dépense'}`,
        });
        transaction_id = (tx as any)?.id ?? null;
      }
      const { data: exp, error } = await supabase.from('rw_expenses').insert({
        project_id: projectId, title: input.title, emoji: input.emoji ?? null, amount: Math.abs(input.amount),
        date: input.date, paid_by: input.paidBy, created_by: userId, account_id: input.accountId, transaction_id,
      }).select().single();
      if (error) throw error;
      const rows = input.shares
        .filter((s) => s.amount > 0)
        .map((s) => ({ expense_id: (exp as any).id, project_id: projectId, participant_id: s.participant_id, amount: s.amount }));
      if (rows.length) {
        const { error: se } = await supabase.from('rw_expense_shares').insert(rows);
        if (se) throw se;
      }
      return exp as RwExpense;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); },
  });
}

/** Modifie une dépense + sa répartition. Recrée la transaction liée si nécessaire. */
export function useUpdateRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const addTx = useAddTransaction(userId);
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    mutationFn: async (input: {
      expense: RwExpense; title: string; emoji?: string | null; amount: number; date: string; paidBy: string;
      shares: { participant_id: string; amount: number }[];
      accountId: string | null; projectName: string; categoryId?: string | null;
      /** L'utilisateur courant est-il le payeur ? Seul lui peut gérer SA transaction / SON compte. */
      iAmPayer: boolean;
    }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      // Par défaut on PRÉSERVE le compte/transaction (réglés par le payeur). On ne les touche
      // que si l'utilisateur courant EST le payeur (c'est sa transaction, son argent).
      let account_id: string | null = input.expense.account_id;
      let transaction_id: string | null = input.expense.transaction_id;
      if (input.iAmPayer) {
        if (transaction_id) { try { await delTx.mutateAsync(transaction_id); } catch { /* déjà supprimée */ } transaction_id = null; }
        account_id = input.accountId;
        if (input.accountId) {
          const tx = await addTx.mutateAsync({
            account_id: input.accountId, category_id: input.categoryId ?? null,
            amount: -Math.abs(input.amount), date: input.date,
            note: `${input.projectName} · ${input.title || 'Dépense'}`,
          });
          transaction_id = (tx as any)?.id ?? null;
        }
      }
      // Met à jour la dépense.
      const { error } = await supabase.from('rw_expenses').update({
        title: input.title, emoji: input.emoji ?? null, amount: Math.abs(input.amount),
        date: input.date, paid_by: input.paidBy, account_id, transaction_id,
      }).eq('id', input.expense.id);
      if (error) throw error;
      // 3) Remplace la répartition.
      await supabase.from('rw_expense_shares').delete().eq('expense_id', input.expense.id);
      const rows = input.shares.filter((s) => s.amount > 0)
        .map((s) => ({ expense_id: input.expense.id, project_id: projectId, participant_id: s.participant_id, amount: s.amount }));
      if (rows.length) { const { error: se } = await supabase.from('rw_expense_shares').insert(rows); if (se) throw se; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); },
  });
}

/** Supprime une dépense (et la transaction liée, en rétablissant le solde du compte). */
export function useDeleteRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    mutationFn: async (expense: RwExpense) => {
      if (!supabase) throw new Error('Backend indisponible');
      // La transaction liée n'existe que chez le payeur (créateur) → on ne la supprime que si c'est la nôtre.
      if (expense.transaction_id && expense.created_by === userId) {
        try { await delTx.mutateAsync(expense.transaction_id); } catch { /* déjà supprimée */ }
      }
      const { error } = await supabase.from('rw_expenses').delete().eq('id', expense.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); },
  });
}

/** Invite un utilisateur par son code public (RPC sécurisée). */
export function useRwInviteByCode(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; name: string }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('rw_invite_by_code', { p_project: projectId, p_code: input.code, p_name: input.name });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

/** Invitations en attente reçues par l'utilisateur courant. */
export function useRwInvitations(userId: string | undefined) {
  return useQuery({
    queryKey: ['rw_invitations', userId],
    enabled: !!userId && ok(),
    queryFn: async (): Promise<RwInvitation[]> => {
      // RPC : enrichit avec le nom du projet + le nom de l'invitant (l'invité n'a pas encore accès au projet).
      const { data, error } = await supabase!.rpc('rw_my_invitations');
      if (error) throw error;
      return (data ?? []) as RwInvitation[];
    },
  });
}

export function useRwRespondInvitation(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const fn = input.accept ? 'rw_accept_invitation' : 'rw_decline_invitation';
      const { error } = await supabase.rpc(fn, { p_invite: input.inviteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_invitations', userId] });
      qc.invalidateQueries({ queryKey: ['rw_projects'] });
    },
  });
}

/** Abonnement temps réel : rafraîchit le projet quand un participant modifie quelque chose. */
export function useRwRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !projectId) return;
    const channel = supabase
      .channel(`rw_${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_expenses', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_expense_shares', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_participants', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }))
      .subscribe();
    return () => { supabase!.removeChannel(channel); };
  }, [projectId, qc]);
}
