import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Account } from '../types/database';
import { todayISO } from '../lib/dateUtils';

const KEY = 'accounts';

const mapAccount = (r: any, profileId: string, roleById: Record<string, string>): Account => ({
  ...r,
  balance: Number(r.balance),
  initial_contributed: r.initial_contributed != null ? Number(r.initial_contributed) : null,
  current_contributed: r.current_contributed != null ? Number(r.current_contributed) : null,
  is_joint: !!r.is_joint,
  // 'owner' si c'est mon compte, sinon le rôle de membership (write/read).
  _role: r.profile_id === profileId ? 'owner' : ((roleById[r.id] as any) ?? 'read'),
});

/**
 * Comptes PERSONNELS (mes comptes non joints). C'est la vue « mon argent » : utilisée par le pilotage,
 * la projection, le reporting, les objectifs, les totaux… Les comptes JOINTS et les comptes PARTAGÉS
 * reçus d'autres utilisateurs en sont volontairement EXCLUS (aucun impact sur les agrégats perso).
 * → Pour la vue complète (page Comptes / virements / détail), utiliser useAllAccounts.
 */
export function useAccounts(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('profile_id', profileId)
        .eq('is_active', true)
        .eq('is_joint', false)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => mapAccount(r, profileId, {}));
    },
    enabled: !!profileId,
  });

  return query;
}

/**
 * TOUS les comptes accessibles : mes comptes perso + mes comptes joints + les comptes partagés reçus
 * d'autres utilisateurs (avec `_role` = owner/write/read et `is_joint`). À n'utiliser QUE là où l'on
 * veut voir les comptes partagés/joints (page Comptes, virements, détail de compte). Ne JAMAIS l'utiliser
 * pour des agrégats perso (pilotage/projection) → ça réintègrerait les comptes partagés.
 */
export function useAllAccounts(profileId: string | undefined) {
  return useQuery({
    queryKey: [KEY, profileId, 'all'],
    enabled: !!profileId,
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const ownP = supabase.from('accounts').select('*').eq('profile_id', profileId).eq('is_active', true);
      const memP = supabase.from('account_members').select('account_id, role').eq('user_id', profileId);
      const [{ data: own, error: ownErr }, memRes] = await Promise.all([ownP, memP]);
      if (ownErr) throw ownErr;

      const roleById: Record<string, string> = {};
      const memberIds: string[] = [];
      for (const m of (memRes?.data ?? []) as any[]) { roleById[m.account_id] = m.role; memberIds.push(m.account_id); }

      let memberAccounts: any[] = [];
      if (memberIds.length > 0) {
        const { data: ma } = await supabase
          .from('accounts').select('*').in('id', memberIds).eq('is_active', true).order('name');
        memberAccounts = (ma ?? []).filter((a: any) => a.profile_id !== profileId); // exclut mes propres comptes
      }

      const ownMapped = (own ?? []).map((r) => mapAccount(r, profileId, roleById));
      const memMapped = memberAccounts.map((r) => mapAccount(r, profileId, roleById));
      return [...ownMapped, ...memMapped];
    },
  });
}

/** Comptes archivés (fermés), non utilisables pour virements ou nouvelles transactions. */
export function useArchivedAccounts(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId, 'archived'],
    queryFn: async (): Promise<Account[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('profile_id', profileId)
        .eq('is_active', false)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance), initial_contributed: r.initial_contributed != null ? Number(r.initial_contributed) : null, current_contributed: r.current_contributed != null ? Number(r.current_contributed) : null }));
    },
    enabled: !!profileId,
  });
  return query;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Crée le compte par défaut à la fin de l'onboarding si l'utilisateur n'en a aucun :
 * un seul compte courant. (Plus de Livret A / LDDS auto — l'utilisateur les crée au besoin.)
 * Idempotent.
 */
export function useSeedDefaultAccounts(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: existing } = await supabase
        .from('accounts')
        .select('id')
        .eq('profile_id', profileId)
        .limit(1);
      if (existing && existing.length > 0) return; // déjà des comptes → ne rien faire

      const { error } = await supabase.from('accounts').insert({
        profile_id: profileId,
        name: 'Compte courant',
        type: 'checking',
        currency: 'EUR',
        balance: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useAddAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: string; currency: string; balance: number; fiscal_envelope?: string | null; init_date?: string | null; initial_contributed?: number | null; is_joint?: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      // SOURCE DE VÉRITÉ = l'utilisateur réellement authentifié (auth.uid()), pas le profileId du
      // contexte (qui peut être désynchronisé). La RLS exige profile_id = auth.uid() → on garantit
      // que le compte est créé pour le bon propriétaire, sinon « violates RLS » à coup sûr.
      const { data: sess } = await supabase.auth.getSession();
      const ownerId = sess?.session?.user?.id ?? profileId;
      if (!ownerId) throw new Error('Session expirée — déconnecte-toi puis reconnecte-toi.');
      const nameNorm = normalizeName(input.name);
      if (!nameNorm) throw new Error('Le nom du compte est requis.');
      const { data: existing } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('profile_id', ownerId)
        .eq('is_active', true);
      const hasDuplicate = (existing ?? []).some(
        (r) => normalizeName((r as { name?: string }).name ?? '') === nameNorm
      );
      if (hasDuplicate) throw new Error('Un compte avec ce nom existe déjà.');
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          profile_id: ownerId,
          name: input.name.trim(),
          type: input.type || 'checking',
          currency: input.currency || 'EUR',
          balance: 0,
          ...(input.is_joint ? { is_joint: true } : {}),
          ...(input.type === 'investment' && input.fiscal_envelope ? { fiscal_envelope: input.fiscal_envelope } : {}),
          ...(input.type === 'investment' && input.initial_contributed != null ? { initial_contributed: input.initial_contributed, current_contributed: input.initial_contributed } : {}),
          ...(input.init_date ? { init_date: input.init_date } : {}),
        })
        .select()
        .single();
      if (error) throw new Error([error.message, (error as any).details, (error as any).hint].filter(Boolean).join(' — ') || 'Erreur base de données');

      // Le solde est désormais DÉRIVÉ des transactions (recompute_account_balance). Le solde initial est
      // adossé à une transaction d'ANCRE DE RÉGULARISATION (même nature qu'une régul de solde) :
      // category_id NULL + note « Régularisation » + regul_target. Avantages : (a) traitée comme une
      // régul (pas de sous-catégorie exigée à l'édition), (b) solde déterministe dès le départ (ancre).
      const initBal = input.balance ?? 0;
      if (data && initBal !== 0) {
        const accId = (data as any).id as string;
        const initDate = input.init_date ?? todayISO();
        const { error: regErr } = await supabase.from('transactions').insert({
          profile_id: ownerId,
          account_id: accId,
          category_id: null,
          amount: initBal,
          date: initDate,
          note: 'Régularisation solde initial',
          regul_target: initBal,
          is_draft: false,
          is_recurring: false,
          posted: true,
        });
        if (regErr) throw new Error('Solde initial : ' + [regErr.message, (regErr as any).details, (regErr as any).hint].filter(Boolean).join(' — '));
        const { error: recErr } = await supabase.rpc('recompute_account_balance', { p_account: accId, p_today: todayISO() });
        if (recErr) throw new Error('Recalcul du solde : ' + recErr.message);
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/** Fermer un compte : s'il a des écritures → archivage (is_active = false), sinon suppression. */
export function useCloseAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: acc, error: accErr } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .eq('profile_id', profileId)
        .single();
      if (accErr || !acc) throw new Error('Compte introuvable.');
      const { count, error: countErr } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId);
      if (countErr) throw countErr;
      if ((count ?? 0) > 0) {
        const { error: updErr } = await supabase
          .from('accounts')
          .update({ is_active: false })
          .eq('id', accountId)
          .eq('profile_id', profileId);
        if (updErr) throw updErr;
      } else {
        const { error: delErr } = await supabase.from('accounts').delete().eq('id', accountId).eq('profile_id', profileId);
        if (delErr) throw delErr;
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; type?: string; currency?: string; balance?: number; fiscal_envelope?: string | null; current_contributed?: number | null; initial_contributed?: number | null }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      if (input.name !== undefined) {
        const nameNorm = normalizeName(input.name);
        if (!nameNorm) throw new Error('Le nom du compte est requis.');
        const { data: existing } = await supabase
          .from('accounts')
          .select('id, name')
          .eq('profile_id', profileId)
          .eq('is_active', true);
        const duplicate = (existing ?? []).find(
          (r) => (r as { id: string }).id !== input.id && normalizeName((r as { name?: string }).name ?? '') === nameNorm
        );
        if (duplicate) throw new Error('Un compte avec ce nom existe déjà.');
      }
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name.trim();
      if (input.type !== undefined) updates.type = input.type;
      if (input.currency !== undefined) updates.currency = input.currency;
      if (input.balance !== undefined) updates.balance = input.balance;
      if (input.fiscal_envelope !== undefined) updates.fiscal_envelope = input.fiscal_envelope;
      if (input.current_contributed !== undefined) updates.current_contributed = input.current_contributed;
      if (input.initial_contributed !== undefined) updates.initial_contributed = input.initial_contributed;
      const { data, error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
