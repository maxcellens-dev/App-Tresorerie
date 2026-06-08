/**
 * Clôture mensuelle — détection des mois à clôturer, verrou temporel et bilan éphémère.
 * Activable via l'admin (feature flag monthly_closure_enabled). Désactivé → aucun effet.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useProfile } from './useProfile';
import { useTransactions } from './useTransactions';
import { useFeatureFlags } from './useFeatureFlags';

export interface MonthClosure { id: string; profile_id: string; month_key: string; surplus: number; closed_at: string; }
export interface ClosureBilan { month_key: string; surplus: number; seen?: boolean; }

export function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function addMonthKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ym(d);
}
export function lastDayOfMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0); // jour 0 du mois suivant = dernier jour du mois
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function useMonthClosures(userId: string | undefined) {
  return useQuery({
    queryKey: ['month_closures', userId],
    queryFn: async (): Promise<MonthClosure[]> => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase.from('month_closures').select('*').eq('profile_id', userId).order('month_key', { ascending: true });
      if (error) throw error;
      return (data ?? []) as MonthClosure[];
    },
    enabled: !!userId,
  });
}

export function useMonthlyClosure(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: flags } = useFeatureFlags();
  const enabled = Boolean(flags?.monthly_closure_enabled);
  const { data: profile } = useProfile(userId);
  const { data: transactions = [] } = useTransactions(userId);
  const { data: closures = [] } = useMonthClosures(userId);

  // Verrou effectif : ignoré si la fonctionnalité Clôture est désactivée (tout reste éditable).
  // La valeur stockée (closure_lock_date) est conservée → réactiver la fonctionnalité re-fige.
  const rawLock: string | null = (profile as any)?.closure_lock_date ?? null;
  const lockDate: string | null = enabled ? rawLock : null;
  const bilanRaw = (profile as any)?.last_closure_bilan as ClosureBilan | null | undefined;
  const bilan = bilanRaw && !bilanRaw.seen ? bilanRaw : null;

  const pendingMonths = useMemo(() => {
    if (!enabled || !transactions.length) return [];
    const closedSet = new Set(closures.map((c) => c.month_key));
    const cur = ym(new Date());
    const firstTx = (transactions as any[]).reduce((min, t) => (t.date < min ? t.date : min), (transactions as any[])[0].date) as string;
    const firstKey = firstTx.slice(0, 7);
    const lastClosed = closures.length ? closures[closures.length - 1].month_key : null;
    let start = lastClosed ? addMonthKey(lastClosed, 1) : firstKey;
    if (start < firstKey) start = firstKey;
    const res: string[] = [];
    let k = start;
    let guard = 0;
    while (k < cur && guard < 60) {
      if (!closedSet.has(k)) res.push(k);
      k = addMonthKey(k, 1);
      guard++;
    }
    return res; // du plus ancien au plus récent
  }, [enabled, transactions, closures]);

  const closeMonths = useMutation({
    mutationFn: async ({ monthKeys, surplus }: { monthKeys: string[]; surplus: number }) => {
      if (!supabase || !userId || !monthKeys.length) return;
      const rows = monthKeys.map((mk) => ({ profile_id: userId, month_key: mk, surplus: mk === monthKeys[monthKeys.length - 1] ? surplus : 0 }));
      const { error } = await supabase.from('month_closures').upsert(rows, { onConflict: 'profile_id,month_key' });
      if (error) throw error;
      const maxKey = monthKeys.reduce((a, b) => (a > b ? a : b));
      const lock = lastDayOfMonthKey(maxKey);
      // Bilan affiché uniquement pour le mois qui vient de se terminer (mois précédent).
      const prevMonth = addMonthKey(ym(new Date()), -1);
      const patch: Record<string, any> = { closure_lock_date: lock };
      patch.last_closure_bilan = maxKey === prevMonth ? { month_key: maxKey, surplus, seen: false } : null;
      await supabase.from('profiles').update(patch).eq('id', userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });

  const markBilanSeen = useMutation({
    mutationFn: async () => {
      if (!supabase || !userId || !bilanRaw) return;
      await supabase.from('profiles').update({ last_closure_bilan: { ...bilanRaw, seen: true } }).eq('id', userId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile', userId] }); },
  });

  const reopenMonth = useMutation({
    mutationFn: async (monthKey: string) => {
      if (!supabase || !userId) return;
      await supabase.from('month_closures').delete().eq('profile_id', userId).eq('month_key', monthKey);
      // Recalcule le verrou = dernier jour du mois clôturé le plus récent restant (sinon null).
      const remaining = closures.filter((c) => c.month_key !== monthKey).map((c) => c.month_key);
      const newLock = remaining.length ? lastDayOfMonthKey(remaining.reduce((a, b) => (a > b ? a : b))) : null;
      await supabase.from('profiles').update({ closure_lock_date: newLock }).eq('id', userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });

  return { enabled, pendingMonths, lockDate, bilan, closures, closeMonths, markBilanSeen, reopenMonth };
}
