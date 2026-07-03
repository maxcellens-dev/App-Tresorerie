// Réglages ADMIN de fiabilité (app_config.reliability) + dérivation de la confiance côté écran.
// La confiance est calculée AVEC le vrai Relyka pour n'avoir qu'UNE seule fonction de doute partout.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  resolveReliabilityConfig, computeConfidence, toRange, computeCalibration,
  type ReliabilityConfig, type ConfidenceResult, type Range,
} from '../lib/confidenceEngine';
import { todayISO } from '../lib/dateUtils';
import type { PilotageData } from './usePilotageData';
import type { SystemNotificationsConfig } from '../lib/systemNotifications';

export function useReliabilityConfig() {
  return useQuery({
    queryKey: ['reliability_config'],
    queryFn: async (): Promise<ReliabilityConfig> => {
      if (!supabase) return resolveReliabilityConfig(null);
      const { data } = await supabase.from('app_config').select('reliability').eq('id', 'default').single();
      return resolveReliabilityConfig((data as any)?.reliability ?? null);
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useSaveReliabilityConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ReliabilityConfig>) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data } = await supabase.from('app_config').select('reliability').eq('id', 'default').single();
      const prev = ((data as any)?.reliability ?? {}) as Partial<ReliabilityConfig>;
      const merged = { ...prev, ...patch };
      const { error } = await supabase.from('app_config').update({ reliability: merged, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reliability_config'] }); },
  });
}

export function useSystemNotificationsConfig() {
  return useQuery({
    queryKey: ['system_notifications_config'],
    queryFn: async (): Promise<SystemNotificationsConfig> => {
      if (!supabase) return {};
      const { data } = await supabase.from('app_config').select('system_notifications').eq('id', 'default').single();
      return ((data as any)?.system_notifications ?? {}) as SystemNotificationsConfig;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useSaveSystemNotificationsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SystemNotificationsConfig) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { data } = await supabase.from('app_config').select('system_notifications').eq('id', 'default').single();
      const prev = ((data as any)?.system_notifications ?? {}) as SystemNotificationsConfig;
      const merged = { ...prev, ...patch };
      const { error } = await supabase.from('app_config').update({ system_notifications: merged, updated_at: new Date().toISOString() }).eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['system_notifications_config'] }); },
  });
}

/**
 * Recalcule la CALIBRATION de dérive du user (profiles.reliability_calib) à partir de ses
 * vérifications passées (régularisations). À appeler après chaque régul / clôture confirmée.
 *   dérive_journalière = médiane(|écarts trouvés|) / médiane(jours entre vérifications)
 * Les réguls des mois « estimated » sont EXCLUES (mois non fiables → ne calibrent pas).
 * Un user qui vérifie avec écart ~0 voit sa dérive tendre vers 0 → confiance durable.
 */
export function useRecalibrateReliability(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!supabase || !profileId) return;
      const [txRes, clRes] = await Promise.all([
        supabase.from('transactions')
          .select('date, amount, regul_target')
          .eq('profile_id', profileId)
          .not('regul_target', 'is', null)
          .lte('date', todayISO())
          .order('date', { ascending: true }),
        supabase.from('month_closures').select('month_key, status').eq('profile_id', profileId),
      ]);
      const estimated = new Set(
        ((clRes.data ?? []) as any[]).filter((c) => c.status === 'estimated').map((c) => c.month_key),
      );
      // Une « vérification » = un JOUR de régul (multi-comptes le même jour → écarts sommés).
      const byDay = new Map<string, number>();
      for (const t of (txRes.data ?? []) as any[]) {
        const d = String(t.date).slice(0, 10);
        if (estimated.has(d.slice(0, 7))) continue;
        byDay.set(d, (byDay.get(d) ?? 0) + Math.abs(Number(t.amount)));
      }
      const days = [...byDay.keys()].sort();
      const samples: { absGap: number; daysBetween: number }[] = [];
      for (let i = 1; i < days.length; i++) {
        const gapDays = Math.round((new Date(days[i] + 'T00:00:00').getTime() - new Date(days[i - 1] + 'T00:00:00').getTime()) / 86400000);
        samples.push({ absGap: byDay.get(days[i])!, daysBetween: gapDays });
      }
      const calib = computeCalibration(samples);
      await supabase.from('profiles').update({ reliability_calib: calib }).eq('id', profileId);
      return calib;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', profileId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * Dérive le niveau de confiance + fourchette du Relyka à partir des signaux du pilotage et du vrai
 * montant Relyka. Retourne aussi une fonction `range()` pour fourcher n'importe quel sous-montant
 * (recos) DANS LA MÊME PROPORTION que le Relyka (invariant : Σ bornes basses recos = borne basse Relyka).
 */
export interface RelykaConfidence {
  result: ConfidenceResult;
  relyka: number;
  relykaRange: Range;
  config: ReliabilityConfig;
  /** Fourchette d'un sous-montant proportionnelle à celle du Relyka. */
  proportional: (amount: number) => Range;
}

export function deriveRelykaConfidence(
  pilotage: Pick<PilotageData, 'confidence_inputs'> | null | undefined,
  relyka: number,
  config: ReliabilityConfig,
): RelykaConfidence {
  const inputs = pilotage?.confidence_inputs;
  const result = computeConfidence({
    today: new Date(),
    lastVerifiedAt: inputs?.lastVerifiedAt ?? null,
    calibration: inputs?.calibration ?? null,
    relyka,
    floorBase: inputs?.floorBase ?? 0,
    config,
  });
  const relykaRange = toRange(relyka, result, config);
  // Ratios de fourchette du Relyka, réappliqués proportionnellement à chaque sous-montant.
  const lowRatio = relyka > 0 ? relykaRange.low / relyka : 1;
  const highRatio = relyka > 0 ? relykaRange.high / relyka : 1;
  const proportional = (amount: number): Range => {
    if (!relykaRange.isRange) return { low: amount, high: amount, isRange: false };
    const low = Math.round(amount * lowRatio);
    const high = Math.round(amount * highRatio);
    return { low: Math.min(low, high), high: Math.max(low, high), isRange: true };
  };
  return { result, relyka, relykaRange, config, proportional };
}
