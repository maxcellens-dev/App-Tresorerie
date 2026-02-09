import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Transaction, TransactionWithDetails, RecurrenceRule } from '../types/database';

const KEY = 'transactions';

export function useTransactions(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<TransactionWithDetails[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          account:accounts(name),
          category:categories(name, type)
        `)
        .eq('profile_id', profileId)
        .order('date', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        amount: Number((r as Transaction).amount),
        account: (r as { account?: { name: string } }).account,
        category: (r as { category?: { name: string; type: string } }).category,
      }));
    },
    enabled: !!profileId,
  });

  return query;
}

export function useAddTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      account_id: string;
      category_id: string | null;
      amount: number;
      date: string;
      note?: string;
      is_forecast?: boolean;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          profile_id: profileId,
          account_id: input.account_id,
          category_id: input.category_id || null,
          amount: input.amount,
          date: input.date,
          note: input.note || null,
          is_forecast: input.is_forecast ?? false,
          is_recurring: input.is_recurring ?? false,
          recurrence_rule: input.recurrence_rule ?? null,
          recurrence_end_date: input.recurrence_end_date ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const { data: acc } = await supabase.from('accounts').select('balance').eq('id', input.account_id).single();
      if (acc) {
        await supabase.from('accounts').update({ balance: Number(acc.balance) + input.amount }).eq('id', input.account_id);
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
    },
  });
}

export function useUpdateTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      account_id?: string;
      category_id?: string | null;
      amount?: number;
      date?: string;
      note?: string | null;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: existing, error: fetchErr } = await supabase.from('transactions').select('account_id, amount').eq('id', input.id).eq('profile_id', profileId).single();
      if (fetchErr || !existing) throw fetchErr || new Error('Transaction introuvable');
      const oldAccId = (existing as { account_id: string }).account_id;
      const oldAmount = Number((existing as { amount: number }).amount);
      const balanceChanged = input.amount !== undefined || input.account_id !== undefined;
      if (balanceChanged) {
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', oldAccId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) - oldAmount }).eq('id', oldAccId);
      }
      const updates: Record<string, unknown> = {};
      if (input.account_id !== undefined) updates.account_id = input.account_id;
      if (input.category_id !== undefined) updates.category_id = input.category_id;
      if (input.amount !== undefined) updates.amount = input.amount;
      if (input.date !== undefined) updates.date = input.date;
      if (input.note !== undefined) updates.note = input.note;
      if (input.is_recurring !== undefined) updates.is_recurring = input.is_recurring;
      if (input.recurrence_rule !== undefined) updates.recurrence_rule = input.recurrence_rule;
      if (input.recurrence_end_date !== undefined) updates.recurrence_end_date = input.recurrence_end_date;
      const { data, error } = await supabase.from('transactions').update(updates).eq('id', input.id).eq('profile_id', profileId).select().single();
      if (error) throw error;
      if (balanceChanged) {
        const newAccId = (input.account_id !== undefined ? input.account_id : oldAccId) as string;
        const newAmount = input.amount !== undefined ? input.amount : oldAmount;
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', newAccId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) + newAmount }).eq('id', newAccId);
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
    },
  });
}

export function useDeleteTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: row, error: fetchErr } = await supabase.from('transactions').select('account_id, amount').eq('id', id).eq('profile_id', profileId).single();
      if (fetchErr) throw fetchErr;
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', id).eq('profile_id', profileId);
      if (delErr) throw delErr;
      if (row) {
        const accId = (row as { account_id: string }).account_id;
        const amount = Number((row as { amount: number }).amount);
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', accId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) - amount }).eq('id', accId);
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
    },
  });
}
