/**
 * Construction PARTAGÉE des entrées du moteur de recommandations (§P7).
 *
 * Utilisée par le PILOTAGE (recos affichées) ET par le POULS (capacité d'investissement de la carte
 * « Investissement du mois »). Une seule source de vérité : « tu pourrais placer jusqu'à X » du
 * Pouls = déjà placé + déjà fléché + la reco « Investir » affichée — plus jamais deux chiffres qui
 * se contredisent entre l'état des lieux et les recommandations.
 */
import {
  resolveConsumptionMode,
  getConsumptionOrder,
  type ComputeRecoOptions,
} from './recommendationEngine';
import { floorToTen } from './currency';
import type { PilotageData } from '../hooks/usePilotageData';
import type { FinancialProfileId, RecommendationSettings } from '../types/database';

export interface RecoBuildExtras {
  /** Réservations du mois (manuelles ou via reco « Conserver »). */
  reservationsTotal: number;
  /** Cumuls fléchés épargne / invest (pré-épargne, en attente de virement). */
  preEpargneTotal: number;
  preInvestTotal: number;
  /** profiles.prudence_level (null = Auto → dérivé du profil financier). */
  prudenceLevel: number | null;
  financialProfileId?: FinancialProfileId;
  thresholds?: RecommendationSettings | null;
  customTierAllocations?: ComputeRecoOptions['customTierAllocations'];
  /** Date de référence (tests). Défaut : aujourd'hui. */
  today?: Date;
}

/**
 * Options du moteur de recos, dérivées du pilotage — À L'IDENTIQUE pour tous les appelants :
 *  - budget BRUT invariant (point bas − enveloppe variable restante − marge), reconstitué des
 *    virements épargne/invest déjà EXÉCUTÉS (le point bas les a déduits) et du dépassement variable ;
 *  - `alreadyAllocated` par type (exécuté + prévu + cumuls fléchés) → pas de re-proposition ;
 *  - cascade de consommation selon la prudence, garde-fou marge × projection 6 mois ;
 *  - plafond absolu = Relyka (reste disponible), arrondi à la dizaine.
 */
export function buildRecoOptions(data: PilotageData, x: RecoBuildExtras): ComputeRecoOptions {
  const cumulsTotal = x.preEpargneTotal + x.preInvestTotal;
  // Avancement du mois : en fin de mois la part « Confort » bascule vers « Conserver » (reporter sur
  // le mois prochain). Calculé ICI → le Pilotage et le Pouls raisonnent sur la même date.
  const now = x.today ?? new Date();
  const daysLeftInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const margin = data.safety_margin_amount ?? 0;
  const varRemaining = data.variable_envelope_remaining ?? 0;
  const trough = data.cashflow_trough ?? (data.current_checking_balance ?? 0);
  const savingsRemaining = data.month_savings_future ?? 0;
  const investRemaining = data.month_invest_future ?? 0;
  const savingsExecuted = Math.max(0, (data.month_savings_total ?? 0) - savingsRemaining);
  const investExecuted = Math.max(0, (data.month_invest_total ?? 0) - investRemaining);
  const variableOverspend = Math.max(0, (data.variable_envelope_spent ?? 0) - (data.variable_envelope_initial ?? 0));
  const recoGrossBudget = Math.max(0, trough - varRemaining - margin);
  // Relyka (reste disponible) — même formule que la carte du Pilotage (lib/relyka la partage aussi).
  const resteDisponible = Math.max(0,
    trough - savingsRemaining - investRemaining - (data.monthly_reserve_planned ?? 0)
    - x.reservationsTotal - cumulsTotal - varRemaining - margin,
  );

  return {
    customTierAllocations: x.customTierAllocations,
    financialProfileId: x.financialProfileId,
    // Budget « enveloppe juste atteinte » : le dépassement est rajouté (le moteur le re-déduit en cascade).
    budget: recoGrossBudget + variableOverspend + savingsExecuted + investExecuted,
    thresholds: x.thresholds ?? undefined,
    alreadyAllocated: {
      // Épargne / invest : EXÉCUTÉ ce mois + virements prévus (non exécutés) + cumuls fléchés.
      save: savingsExecuted + savingsRemaining + x.preEpargneTotal,
      invest: investExecuted + investRemaining + x.preInvestTotal,
      // Conserver : réservations (manuelles ou via reco) + réservé projets du mois.
      keep: x.reservationsTotal + (data.monthly_reserve_planned ?? 0),
    },
    overspend: variableOverspend,
    consumptionOrder: getConsumptionOrder(
      resolveConsumptionMode(x.prudenceLevel, x.financialProfileId, x.thresholds?.auto_profile_map),
      x.thresholds?.consumption_orders,
    ),
    // Garde-fou marge × projection 6 mois : point bas de la trajectoire (écran Projection).
    projectionGuard: { balances: data.projection_balances_6m ?? [], margin },
    maxAmount: Math.max(0, floorToTen(resteDisponible)),
    daysLeftInMonth,
  };
}
