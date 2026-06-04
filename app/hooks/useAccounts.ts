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
      return (data ?? []).map((r) => ({ ...r, balance: Number(r.balance), initial_contributed: r.initial_contributed != null ? Number(r.initial_contributed) : null, current_contributed: r.current_contributed != null ? Number(r.current_contributed) : null }));
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
 * Crée les comptes par défaut à la fin de l'onboarding si l'utilisateur n'en a aucun :
 * un compte courant, un Livret A et un LDDS (épargne). Idempotent.
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

      const defaults = [
        { name: 'Compte courant', type: 'checking' },
        { name: 'Livret A', type: 'savings' },
        { name: 'LDDS', type: 'savings' },
      ];
      const { error } = await supabase.from('accounts').insert(
        defaults.map((d) => ({
          profile_id: profileId,
          name: d.name,
          type: d.type,
          currency: 'EUR',
          balance: 0,
        }))
      );
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
    mutationFn: async (input: { name: string; type: string; currency: string; balance: number; fiscal_envelope?: string | null; init_date?: string | null; initial_contributed?: number | null }) => {
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
          ...(input.type === 'investment' && input.fiscal_envelope ? { fiscal_envelope: input.fiscal_envelope } : {}),
          ...(input.type === 'investment' && input.initial_contributed != null ? { initial_contributed: input.initial_contributed, current_contributed: input.initial_contributed } : {}),
          ...(input.init_date ? { init_date: input.init_date } : {}),
        })
        .select()
        .single();
      if (error) throw error;
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
    mutationFn: async (input: { id: string; name?: string; type?: string; currency?: string; balance?: number; fiscal_envelope?: string | null; current_contributed?: number | null }) => {
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
