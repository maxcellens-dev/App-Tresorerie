// Réglages ADMIN de fiabilité (app_config.reliability) + dérivation de la confiance côté écran.
// La confiance est calculée AVEC le vrai Relyka pour n'avoir qu'UNE seule fonction de doute partout.
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import {
  resolveReliabilityConfig, computeConfidence, toRange, makeSubRanges, RELIABILITY_DEFAULTS,
  type ReliabilityConfig, type ConfidenceResult, type Range,
} from '../../lib/finance/confidenceEngine';
import { recomputeReliabilityCalibration } from '../../lib/finance/reliabilityCalib';
import { computeRelyka, relykaInputsFrom } from '../../lib/finance/relyka';
import { floorToTen } from '../../lib/finance/currency';
import { monthReservationsTotal } from '../../lib/finance/pilotageView';
import { usePilotageData, type PilotageData } from './usePilotageData';
import { useReservations } from '../data/useReservations';
import { usePreSavings } from '../data/usePreSavings';
import type { SystemNotificationsConfig } from '../../lib/platform/systemNotifications';

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
    /* Effet de bord non commentable : un échec ici ne change rien pour l'utilisateur et ne
       mérite pas de l'interrompre. Opt-out explicite du backstop global (lib/ui/writeErrors). */
    meta: { silentError: true },
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
    /* Signaux d'observation : assiduité de saisie (amortit le doute) et variable constaté (l'efface
       à hauteur du taux d'honoration de l'enveloppe).
       ⚠️ On passe `undefined`, JAMAIS `{}`, quand le champ manque. Le cache local peut servir un
       `pilotage_data` calculé par une version antérieure de l'app, qui ne contenait pas ces séries :
       un objet vide se lit « tu n'as rien saisi » (doute plein, en silence), là où l'absence se lit
       « je n'ai pas cette donnée » — et laisse `observedRelief` à `null`, ce qui rend le diagnostic
       possible au lieu de faire passer un cache périmé pour un utilisateur négligent. */
    activityDays: inputs?.activityDays,
    variableSpentByDay: inputs?.variableSpentByDay,
    calibration: inputs?.calibration ?? null,
    relyka,
    floorBase: inputs?.floorBase ?? 0,
    variableBase: inputs?.variableBase ?? 0,
    config,
  });
  /* ── PAS DE FOURCHETTE SOUS UN CHIFFRE À ZÉRO ──────────────────────────────────────────────────
     `toRange` refuse déjà de fourcher un Relyka nul. Mais le tableau de bord AFFICHE la dizaine
     inférieure : entre 1 € et 9 €, il montre « 0 € » — et la fourchette, calculée sur le montant
     exact, restait active. On lisait alors « 0 € » en orange, « Pas de marge » et « jusqu'à 100 €
     si tout est à jour » sur trois lignes qui se suivent. On applique donc la même règle au chiffre
     tel qu'il est MONTRÉ, et pas seulement à sa valeur interne. */
  const relykaRange = floorToTen(relyka) > 0
    ? toRange(relyka, result, config)
    : { low: relyka, high: relyka, isRange: false };
  // Sous-fourchettes (recos) : logique PURE et testée dans lib/confidenceEngine (makeSubRanges).
  // L'arrondi des sous-montants n'intervient qu'à l'affichage (dizaine inférieure).
  const { proportional, actionable } = makeSubRanges(relyka, relykaRange, result, config);
  return { result, relyka, relykaRange, config, proportional, actionable };
}

/**
 * LA confiance du jour, branchée aux données — pour les écrans qui n'ont pas déjà le Relyka sous la
 * main (Projection). Elle rassemble exactement les mêmes entrées que le tableau de bord : même
 * Relyka (lib/relyka), même réglage admin, mêmes signaux.
 *
 * ⚠️ POURQUOI CE HOOK EXISTE. La Projection recalculait son propre doute avec `safe_to_spend`
 * (un tout autre agrégat), SANS l'enveloppe variable, et surtout avec les réglages PAR DÉFAUT au
 * lieu de ceux de l'administration : régler les seuils n'avait aucun effet sur la largeur du cône,
 * et un compte neuf pouvait voir un cône « confiance basse » pendant que sa carte Relyka affichait
 * des chiffres nets. « Une seule fonction de doute » ne suffit pas si on ne lui donne pas les mêmes
 * entrées — c'est ce que ce hook garantit.
 *
 * Les requêtes sont celles du tableau de bord (mêmes clés de cache) : aucun aller-retour en plus
 * quand il a déjà été affiché, ce qui est le cas dès l'ouverture de l'app.
 */
export function useRelykaConfidence(profileId: string | undefined): RelykaConfidence | null {
  const { data: pilotage } = usePilotageData(profileId);
  const { data: config } = useReliabilityConfig();
  const { data: reservations = [] } = useReservations(profileId);
  const { data: preSavings } = usePreSavings(profileId);

  return useMemo(() => {
    if (!pilotage || !config) return null;
    const relyka = computeRelyka(relykaInputsFrom(pilotage, {
      reservationsTotal: monthReservationsTotal(reservations as any[]),
      preEpargneTotal: preSavings?.epargne.total_cumule ?? 0,
      preInvestTotal: preSavings?.invest.total_cumule ?? 0,
    }));
    return deriveRelykaConfidence(pilotage, relyka, config);
  }, [pilotage, config, reservations, preSavings]);
}
