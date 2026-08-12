/**
 * L'ÉTAT DES LIEUX — état & historique.
 *  • `pulse_state` (profiles) : dernier mois VU → le bilan ne revient pas en boucle.
 *  • `pulse_snapshots` : le constat tel qu'il a été affiché (évolution du patrimoine, statistiques
 *    admin). On stocke ce qui a été MONTRÉ, on ne le recalcule jamais après coup.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { PulseResult } from '../../lib/pulse/pulseEngine';

export interface PulseSnapshot {
  id: string;
  profile_id: string;
  /** Toujours 'month' : le rendez-vous hebdomadaire n'existe plus (les anciennes lignes 'week'
   *  ont été supprimées par la migration 171). */
  period_kind: 'month';
  /** « 2026-07 ». */
  period_key: string;
  profile_tier: string | null;
  signals: { id: string; label: string; headline: string }[];
  estimated: boolean;
  wealth: number;
  created_at: string;
}

export interface PulseSeenState {
  month?: string;
}

const SNAP_KEY = 'pulse_snapshots';

/** Bilans passés (les plus récents) — évolution du patrimoine à 3 mois. */
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
        .limit(24);
      if (error) throw error;
      return (data ?? []) as PulseSnapshot[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Mois déjà vus (l'état des lieux ne se rouvre pas tout seul). */
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

/** Enregistre le bilan affiché (idempotent : un seul par mois, ré-enregistré si le mois évolue). */
export function useSavePulseSnapshot() {
  const { user, isImpersonating } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
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
          period_kind: 'month',
          period_key: input.periodKey,
          profile_tier: input.profileTier,
          signals: input.result.signals.map((s) => ({
            id: s.id, label: s.label, headline: s.headline,
          })),
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
