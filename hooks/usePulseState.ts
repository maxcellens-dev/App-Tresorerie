/**
 * LE POULS — état & historique.
 *  • `pulse_state` (profiles) : dernière semaine / dernier mois VUS → la carte ne revient pas en boucle.
 *  • `pulse_snapshots` : le constat tel qu'il a été affiché (évolution du patrimoine, série « tout au
 *    vert », statistiques admin). On stocke ce qui a été MONTRÉ, on ne le recalcule jamais après coup.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { PulseResult } from '../lib/pulseEngine';

export interface PulseSnapshot {
  id: string;
  profile_id: string;
  period_kind: 'week' | 'month';
  period_key: string;
  profile_tier: string | null;
  signals: { id: string; label: string; status: string; headline: string }[];
  green_count: number;
  judged_count: number;
  all_green: boolean;
  estimated: boolean;
  wealth: number;
  created_at: string;
}

export interface PulseSeenState {
  week?: string;
  month?: string;
}

const SNAP_KEY = 'pulse_snapshots';

/** Bilans passés (12 derniers, toutes périodes) — évolution + séries. */
export function usePulseSnapshots(userId: string | undefined) {
  return useQuery({
    queryKey: [SNAP_KEY, userId],
    queryFn: async (): Promise<PulseSnapshot[]> => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase
        .from('pulse_snapshots')
        .select('*')
        .eq('profile_id', userId)          // RLS ≠ filtre de liste : on filtre TOUJOURS explicitement
        .order('period_key', { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []) as PulseSnapshot[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Périodes déjà vues (la carte hebdo / l'état des lieux ne se rouvrent pas tout seuls). */
export function usePulseSeen(userId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['pulse_seen', userId],
    queryFn: async (): Promise<PulseSeenState> => {
      if (!supabase || !userId) return {};
      const { data, error } = await supabase
        .from('profiles')
        .select('pulse_state')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return ((data as any)?.pulse_state ?? {}) as PulseSeenState;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  const markSeen = useMutation({
    mutationFn: async (patch: PulseSeenState) => {
      if (!supabase || !userId) return;
      const merged = { ...(query.data ?? {}), ...patch };
      const { error } = await supabase.from('profiles').update({ pulse_state: merged }).eq('id', userId);
      if (error) throw error;
      return merged;
    },
    onSuccess: (merged) => {
      if (merged) qc.setQueryData(['pulse_seen', userId], merged);
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });

  return { seen: query.data ?? {}, isLoading: query.isLoading, markSeen };
}

/** Enregistre le bilan affiché (idempotent : un seul par période, ré-enregistré si le mois évolue). */
export function useSavePulseSnapshot() {
  const { user, isImpersonating } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      periodKind: 'week' | 'month';
      periodKey: string;
      profileTier: string;
      result: PulseResult;
      wealth: number;
    }) => {
      // En consultation admin (« connecté en tant que »), on n'écrit JAMAIS dans l'historique du compte visité.
      if (!supabase || !user?.id || isImpersonating) return;
      const { error } = await supabase.from('pulse_snapshots').upsert(
        {
          profile_id: user.id,
          period_kind: input.periodKind,
          period_key: input.periodKey,
          profile_tier: input.profileTier,
          signals: input.result.signals.map((s) => ({
            id: s.id, label: s.label, status: s.status, headline: s.headline,
          })),
          green_count: input.result.greenCount,
          judged_count: input.result.judgedCount,
          all_green: input.result.allGreen,
          estimated: input.result.estimated,
          wealth: Math.round(input.wealth),
        },
        { onConflict: 'profile_id,period_kind,period_key' },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [SNAP_KEY, user?.id] }); },
  });
}

/**
 * Semaines consécutives « tout au vert » (la plus récente d'abord). Les bilans ESTIMÉS (chiffres
 * douteux) ne cassent pas la série mais ne la nourrissent pas non plus : on les saute.
 * Alimente le succès « semaine tout au vert » (lib/gamification).
 */
export function computeGreenWeekStreak(snapshots: PulseSnapshot[]): number {
  const weeks = snapshots
    .filter((s) => s.period_kind === 'week' && !s.estimated)
    .sort((a, b) => b.period_key.localeCompare(a.period_key));
  let streak = 0;
  for (const w of weeks) {
    if (!w.all_green) break;
    streak++;
  }
  return streak;
}
