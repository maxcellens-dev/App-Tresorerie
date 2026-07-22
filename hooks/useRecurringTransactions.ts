/**
 * Toutes les TRANSACTIONS RÉCURRENTES actives de l'utilisateur (dépenses + recettes + virements),
 * pour le modal « Transactions récurrentes » (vue unifiée). Un TEMPLATE récurrent = `is_recurring`
 * + `recurrence_rule` non nul et non expiré (cf. sémantique des récurrences, migration 030).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { todayISO } from '../lib/dateUtils';

export type RecurKind = 'expense' | 'income' | 'transfer';
export interface RecurringItem {
  id: string;
  kind: RecurKind;
  label: string;          // catégorie (dépense/recette) ou « Compte A → Compte B » (virement)
  amount: number;         // valeur absolue
  rule: string;           // daily | weekly | monthly | quarterly | yearly
  nextDate: string;       // prochaine échéance (ancre `date`)
  accountName: string | null;
}

const RULE_LABEL: Record<string, string> = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', quarterly: 'Chaque trimestre', yearly: 'Chaque année' };
export const ruleLabel = (r: string) => RULE_LABEL[r] ?? r;

export function useRecurringTransactions(userId: string | undefined) {
  return useQuery({
    queryKey: ['recurring_transactions', userId],
    enabled: !!userId && !!supabase,
    queryFn: async (): Promise<RecurringItem[]> => {
      const today = todayISO();
      const { data, error } = await supabase!
        .from('transactions')
        .select(`
          id, amount, date, recurrence_rule, recurrence_end_date, linked_account_id, category_id,
          account:accounts!account_id(name),
          category:categories!category_id(name),
          linked_account:accounts!linked_account_id(name)
        `)
        .eq('profile_id', userId!)
        .eq('is_recurring', true)
        .not('recurrence_rule', 'is', null)
        .order('date', { ascending: true });
      if (error) throw error;

      return (data ?? [])
        // Séries vivantes uniquement (non tronquées / non expirées).
        .filter((r: any) => !r.recurrence_end_date || r.recurrence_end_date >= today)
        .map((r: any): RecurringItem => {
          const amt = Number(r.amount);
          const isTransfer = !!r.linked_account_id;
          const kind: RecurKind = isTransfer ? 'transfer' : amt >= 0 ? 'income' : 'expense';
          const acc = r.account?.name ?? null;
          const dest = r.linked_account?.name ?? '?';
          const label = isTransfer
            ? `${acc ?? '?'} → ${dest}`
            : (r.category?.name ?? 'Sans catégorie');
          return { id: r.id, kind, label, amount: Math.abs(amt), rule: r.recurrence_rule, nextDate: r.date, accountName: acc };
        });
    },
    staleTime: 30 * 1000,
  });
}
