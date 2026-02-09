import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Account } from '../types/database';

const KEY = 'accounts';

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
        .order('name');
      if (error) throw error;
      return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance) }));
    },
    enabled: !!profileId,
  });

  return query;
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
      return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance) }));
    },
    enabled: !!profileId,
  });
  return query;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function useAddAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; type: string; currency: string; balance: number }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const nameNorm = normalizeName(input.name);
      if (!nameNorm) throw new Error('Le nom du compte est requis.');
      const { data: existing } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('profile_id', profileId)
        .eq('is_active', true);
      const hasDuplicate = (existing ?? []).some(
        (r) => normalizeName((r as { name?: string }).name ?? '') === nameNorm
      );
      if (hasDuplicate) throw new Error('Un compte avec ce nom existe déjà.');
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          profile_id: profileId,
          name: input.name.trim(),
          type: input.type || 'checking',
          currency: input.currency || 'EUR',
          balance: input.balance ?? 0,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: [KEY, profileId, 'archived'] });
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
    },
  });
}

export function useUpdateAccount(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; type?: string; currency?: string; balance?: number }) => {
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
    },
  });
}
