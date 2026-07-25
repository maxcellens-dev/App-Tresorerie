// Réglages ADMIN de fiabilité (app_config.reliability) + dérivation de la confiance côté écran.
// La confiance est calculée AVEC le vrai Relyka pour n'avoir qu'UNE seule fonction de doute partout.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  resolveReliabilityConfig, computeConfidence, toRange, makeSubRanges, RELIABILITY_DEFAULTS,
  type ReliabilityConfig, type ConfidenceResult, type Range,
} from '../lib/confidenceEngine';
import { recomputeReliabilityCalibration } from '../lib/reliabilityCalib';
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
    // ANTI-CONTRADICTION AU DÉMARRAGE : sans config, tous les consommateurs (carte Relyka, bandeau,
    // Pouls) retombaient sur « aucun doute » → montant sec affiché, puis fourchette une fois la config
    // arrivée du réseau. On part donc TOUJOURS d'une config valable (défauts, puis cache persisté au
    // 2ᵉ lancement) : le doute est calculé dès la 1ʳᵉ frame, sans attendre le réseau.
    // `initialDataUpdatedAt: 0` → la donnée est considérée périmée d'emblée : le fetch réel part quand
    // même immédiatement (aucun délai ajouté, aucune config admin ignorée).
    initialData: RELIABILITY_DEFAULTS,
    initialDataUpdatedAt: 0,
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
 * AMORÇAGE : dès la 1ʳᵉ régul (pas encore d'intervalle entre deux réguls), on fabrique un
 * échantillon provisoire : l'écart trouvé s'est accumulé depuis la création du profil
 * (plafonné à coldStartDays) → on sort du cold start dès la première vérification.
 */
export function useRecalibrateReliability(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    // Logique PURE partagée (lib/reliabilityCalib) : la MÊME est appelée à la suppression d'une régul
    // (useDeleteTransaction) pour ne pas laisser une dérive figée quand une régul est retirée.
    mutationFn: async () => {
      if (!profileId) return;
      await recomputeReliabilityCalibration(profileId);
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
  /**
   * Même fourchette, mais destinée aux ACTIONS (montant pré-rempli d'un virement, d'un cumul,
   * d'une réservation) : la borne basse ne descend jamais sous `minActionRatio × montant`.
   * Le doute est calculé sur la base (revenu/enveloppe) et non sur le Relyka : dès qu'il y a
   * fourchette, il dépasse un petit Relyka et la borne basse tombait à 0 → on proposait 0 €.
   */
  actionable: (amount: number) => Range;
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
    lastActivityAt: inputs?.lastActivityAt ?? null,
    calibration: inputs?.calibration ?? null,
    relyka,
    floorBase: inputs?.floorBase ?? 0,
    variableBase: inputs?.variableBase ?? 0,
    config,
  });
  const relykaRange = toRange(relyka, result, config);
  // Sous-fourchettes (recos) : logique PURE et testée dans lib/confidenceEngine (makeSubRanges).
  // L'arrondi des sous-montants n'intervient qu'à l'affichage (dizaine inférieure).
  const { proportional, actionable } = makeSubRanges(relyka, relykaRange, result, config);
  return { result, relyka, relykaRange, config, proportional, actionable };
}
