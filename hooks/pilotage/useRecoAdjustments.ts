/**
 * CE QUI FAIT QUE LES MONTANTS RECOMMANDÉS NE TOMBENT PAS SUR LES POURCENTAGES DU PROFIL.
 * ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Depuis le retrait de l'étage « priorité du mois » et des modificateurs contextuels, les
 * POURCENTAGES appliqués sont exactement ceux du profil (ou du réglage manuel). Mais les MONTANTS
 * peuvent encore s'en écarter, pour des raisons factuelles : de l'argent déjà mis de côté ce
 * mois-ci, un budget variable dépassé, une trajectoire de trésorerie qui passe sous la marge…
 *
 * L'utilisateur voit alors « Investir 55 % » sur son profil et une reco qui ne fait pas 55 % du
 * Relyka. Sans explication, c'est l'application qui perd sa crédibilité. Ce hook fournit la liste
 * des écarts RÉELLEMENT appliqués, telle que le moteur l'a consignée en la produisant
 * (cf. `ComputeRecoOptions.trace`) — jamais re-déduite après coup, ce qui finirait par expliquer
 * autre chose que ce qui s'est passé.
 *
 * ⚠️ LES ENTRÉES SONT CELLES DU TABLEAU DE BORD, sans exception. Elles passent par la même fabrique
 * (`buildRecoOptions`) et les mêmes hooks de données que `usePilotageViewModel` : un assemblage qui
 * divergerait d'un champ annoncerait des exceptions que l'écran n'applique pas — précisément le
 * genre d'explication qui aggrave la confusion au lieu de la lever.
 */
import { useMemo } from 'react';
import { useProfile } from '../data/useProfile';
import { usePilotageData } from './usePilotageData';
import { useFinancialProfile, useProfileAllocations } from './useFinancialProfile';
import { useRecoThresholds } from './useRecoThresholds';
import { usePreSavings } from '../data/usePreSavings';
import { useReservations } from '../data/useReservations';
import { monthReservationsTotal } from '../../lib/finance/pilotageView';
import { buildRecoOptions } from '../../lib/finance/recoInputs';
import { computeRecommendations, type RecoAdjustmentKind } from '../../lib/finance/recommendationEngine';
import { resolveRecoMode } from '../../lib/finance/recoMode';
import type { FinancialProfileId } from '../../types/database';

export type { RecoAdjustmentKind };

/** Les écarts en cours, sans doublon et dans l'ordre où le moteur les a rencontrés. */
export function useRecoAdjustments(userId: string | undefined): RecoAdjustmentKind[] {
  const { data: pilotage } = usePilotageData(userId);
  const { data: profile } = useProfile(userId);
  const { data: financialProfile } = useFinancialProfile(userId);
  const { data: profileAllocations } = useProfileAllocations();
  const { data: recoThresholds } = useRecoThresholds();
  const { data: preSavings } = usePreSavings(userId);
  const { data: reservations = [] } = useReservations(userId);

  return useMemo(() => {
    if (!pilotage) return [];
    const recoMode = resolveRecoMode(profile as any);
    const opts = buildRecoOptions(pilotage, {
      reservationsTotal: monthReservationsTotal(reservations),
      preEpargneTotal: preSavings?.epargne.total_cumule ?? 0,
      preInvestTotal: preSavings?.invest.total_cumule ?? 0,
      prudenceLevel: ((profile as any)?.prudence_level ?? null) as number | null,
      financialProfileId: (financialProfile as any)?.profile_id as FinancialProfileId | undefined,
      thresholds: recoThresholds,
      manualAllocation: recoMode.manualAllocation,
      profileAllocations,
    });
    const trace: RecoAdjustmentKind[] = [];
    // Le résultat ne nous intéresse pas : on ne veut que la trace de ce que le calcul a fait.
    computeRecommendations(pilotage, { ...opts, trace });
    return trace;
  }, [pilotage, profile, financialProfile, profileAllocations, recoThresholds, preSavings, reservations]);
}
