/**
 * Clôture mensuelle — détection des mois à clôturer, statut souple (confirmed/estimated) et bilan.
 * Activable via l'admin (feature flag monthly_closure_enabled). Désactivé → aucun effet.
 *
 * Un mois passé IGNORÉ (non confirmé après un délai de grâce) est marqué `estimated` : il reste
 * proposé à la clôture, mais il est EXCLU des baselines (dérive, moyennes variables, σ) pour ne
 * pas polluer les mois suivants. Confirmer plus tard écrase le statut (upsert) → rétro-corrigeable.
 */
import { useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useProfile } from './useProfile';
import { useTransactions } from './useTransactions';
import { recomputeBalances } from './useTransactions';
import { useFeatureFlags } from './useFeatureFlags';

export interface MonthClosure { id: string; profile_id: string; month_key: string; surplus: number; closed_at: string; status?: 'confirmed' | 'estimated'; }

/**
 * Libellés des régularisations créées PAR la clôture (et par elle seule) — ceux qu'une réouverture
 * doit défaire. Ils sont écrits par components/MonthlyClosure : toute évolution de ces libellés
 * doit être répercutée ICI, sinon la réouverture laisserait des ajustements orphelins.
 * ⚠️ « Régularisation solde » n'en fait PAS partie : c'est la régul que l'utilisateur saisit
 * lui-même en mettant son solde à jour. Elle ne doit jamais être supprimée par une réouverture.
 */
export const CLOSURE_REGUL_NOTES = [
  'Régularisation (à jour)',
  'Régularisation clôture (mois)',
  'Régularisation clôture (mois courant)',
];
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
    // Seuls les mois CONFIRMÉS sont réellement clos : un mois `estimated` reste proposé à la clôture
    // (le user peut toujours répondre plus tard) mais est déjà exclu des baselines.
    const confirmed = closures.filter((c) => (c.status ?? 'confirmed') === 'confirmed');
    const closedSet = new Set(confirmed.map((c) => c.month_key));
    const cur = ym(new Date());
    const firstTx = (transactions as any[]).reduce((min, t) => (t.date < min ? t.date : min), (transactions as any[])[0].date) as string;
    const firstKey = firstTx.slice(0, 7);
    const lastClosed = confirmed.length ? confirmed[confirmed.length - 1].month_key : null;
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

  // ── Marquage AUTO `estimated` : un mois pendant ignoré au-delà du délai de grâce (8 jours dans
  // le mois suivant) est marqué estimated (jamais bloquant, silencieux, rétro-corrigeable). ──
  const estimatedRunFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !userId || !supabase || pendingMonths.length === 0) return;
    const now = new Date();
    const prevMonth = addMonthKey(ym(now), -1);
    const graceOver = now.getDate() >= 8;
    const alreadyMarked = new Set(closures.map((c) => c.month_key)); // confirmed OU estimated
    const toEstimate = pendingMonths.filter((mk) =>
      !alreadyMarked.has(mk) && (mk < prevMonth || (mk === prevMonth && graceOver)),
    );
    if (toEstimate.length === 0) return;
    const sig = `${userId}:${toEstimate.join(',')}`;
    if (estimatedRunFor.current === sig) return;
    estimatedRunFor.current = sig;
    (async () => {
      try {
        const rows = toEstimate.map((mk) => ({ profile_id: userId, month_key: mk, surplus: 0, status: 'estimated' }));
        await supabase!.from('month_closures').upsert(rows, { onConflict: 'profile_id,month_key', ignoreDuplicates: true });
        qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      } catch { estimatedRunFor.current = null; }
    })();
  }, [enabled, userId, pendingMonths, closures, qc]);

  const closeMonths = useMutation({
    mutationFn: async ({ monthKeys, surplus, status = 'confirmed' }: { monthKeys: string[]; surplus: number; status?: 'confirmed' | 'estimated' }) => {
      if (!supabase || !userId || !monthKeys.length) return;
      const rows = monthKeys.map((mk) => ({ profile_id: userId, month_key: mk, surplus: mk === monthKeys[monthKeys.length - 1] ? surplus : 0, status }));
      const { error } = await supabase.from('month_closures').upsert(rows, { onConflict: 'profile_id,month_key' });
      if (error) throw error;
      const maxKey = monthKeys.reduce((a, b) => (a > b ? a : b));
      // AUCUN blocage (décision produit) : on ne pose plus de verrou dur — les mois restent modifiables,
      // le statut confirmed/estimated suffit à la fiabilité. On efface un éventuel verrou hérité.
      const prevMonth = addMonthKey(ym(new Date()), -1);
      const patch: Record<string, any> = { closure_lock_date: null };
      patch.last_closure_bilan = (status === 'confirmed' && maxKey === prevMonth) ? { month_key: maxKey, surplus, seen: false } : null;
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

  /**
   * Mois RÉOUVRABLE = uniquement la clôture confirmée la PLUS RÉCENTE.
   *
   * Rouvrir un mois ancien alors qu'un mois postérieur reste clos produirait un trou incohérent :
   * les régularisations du mois rouvert disparaissent, mais celles des mois suivants — calculées
   * PAR RAPPORT à ce solde — restent en place et deviennent fausses. On dépile donc dans l'ordre.
   */
  const reopenableMonth = useMemo(() => {
    const confirmed = closures.filter((c) => (c.status ?? 'confirmed') === 'confirmed');
    if (confirmed.length === 0) return null;
    return confirmed.reduce((a, b) => (a.month_key > b.month_key ? a : b)).month_key;
  }, [closures]);

  const reopenMonth = useMutation({
    mutationFn: async (monthKey: string) => {
      if (!supabase || !userId) return;
      if (reopenableMonth && monthKey !== reopenableMonth) {
        throw new Error(`Rouvre d'abord ${monthLabel(reopenableMonth)} : on ne peut rouvrir que la dernière clôture.`);
      }
      /* ROUVRIR = DÉFAIRE. Les régularisations créées PAR la clôture n'ont plus lieu d'être : les
         laisser, c'est garder un ajustement de solde qui ne correspond plus à aucune vérification —
         et il serait recréé à la clôture suivante, en double. On ne touche QU'À CELLES-LÀ : les
         régularisations saisies à la main par l'utilisateur (« Régularisation solde ») restent. */
      const from = `${monthKey}-01`;
      const to = lastDayOfMonthKey(monthKey);
      const { error: delErr } = await supabase
        .from('transactions')
        .delete()
        .eq('profile_id', userId)
        .is('category_id', null)
        .in('note', CLOSURE_REGUL_NOTES)
        .gte('date', from)
        .lte('date', to);
      if (delErr) throw new Error(delErr.message);
      /* La part « mois courant » d'une clôture au prorata est datée APRÈS le mois clos : elle
         appartient pourtant à la même opération, et doit partir avec. */
      const { error: delErr2 } = await supabase
        .from('transactions')
        .delete()
        .eq('profile_id', userId)
        .is('category_id', null)
        .eq('note', 'Régularisation clôture (mois courant)')
        .gt('date', to);
      if (delErr2) throw new Error(delErr2.message);
      /* Mode « solde réel » sur le mois le plus récent : la clôture écrit une « Régularisation
         solde » — le MÊME libellé qu'une mise à jour manuelle. On ne peut donc pas les distinguer
         par le texte : on ne supprime que celles datées EXACTEMENT du dernier jour du mois clos,
         la date que la clôture leur donne toujours. */
      const { error: delErr3 } = await supabase
        .from('transactions')
        .delete()
        .eq('profile_id', userId)
        .is('category_id', null)
        .eq('note', 'Régularisation solde')
        .eq('date', to);
      if (delErr3) throw new Error(delErr3.message);

      const { error } = await supabase.from('month_closures').delete().eq('profile_id', userId).eq('month_key', monthKey);
      if (error) throw new Error(error.message);
      // Recalcule le verrou = dernier jour du mois clôturé le plus récent restant (sinon null).
      /* Les soldes ont bougé (régularisations supprimées) : on les RECALCULE depuis les faits, comme
         partout ailleurs — sinon les comptes garderaient la valeur qu'ils avaient avec les réguls. */
      const { data: accs } = await supabase.from('accounts').select('id').eq('profile_id', userId);
      await recomputeBalances((accs ?? []).map((a: any) => a.id));

      const remaining = closures.filter((c) => c.month_key !== monthKey).map((c) => c.month_key);
      const newLock = remaining.length ? lastDayOfMonthKey(remaining.reduce((a, b) => (a > b ? a : b))) : null;
      /* On efface AUSSI le bilan éphémère : rouvrir un mois puis se voir féliciter pour l'enveloppe
         qu'il restait dessus n'a aucun sens — c'est précisément le mois qu'on vient d'annuler. */
      await supabase.from('profiles').update({ closure_lock_date: newLock, last_closure_bilan: null }).eq('id', userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
      // Les soldes bougent (régularisations supprimées) → tout ce qui en dépend doit se relire.
      qc.invalidateQueries({ queryKey: ['transactions', userId] });
      qc.invalidateQueries({ queryKey: ['accounts', userId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', userId] });
    },
  });

  return { enabled, pendingMonths, lockDate, bilan, closures, closeMonths, markBilanSeen, reopenMonth, reopenableMonth };
}
