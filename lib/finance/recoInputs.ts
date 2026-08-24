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
import { computeRelyka } from './relyka';
import type { PilotageData } from '../../hooks/pilotage/usePilotageData';
import type { FinancialProfileId, RecommendationSettings } from '../../types/database';

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
  /**
   * Répartition CHOISIE (mode manuel, cf. lib/finance/recoMode) — `null` en automatique. Elle passe
   * par ici plutôt que d'être lue dans l'écran : le Pilotage et le Pouls construisent leurs options
   * avec la même fonction, donc ils ne peuvent pas répartir différemment le même Relyka.
   */
  manualAllocation?: ComputeRecoOptions['manualAllocation'];
  /** Répartitions par palier réglées en administration (migration 207). */
  profileAllocations?: ComputeRecoOptions['profileAllocations'];
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
/**
 * Part de la rentrée d'argent MENSUELLE moyenne en dessous de laquelle une entrée n'ouvre pas une
 * nouvelle période. Une petite recette dans 3 jours (remboursement, extra) ne « recommence » pas un
 * budget — et un revenu hebdomadaire ne doit pas mettre l'utilisateur en fin de période toute
 * l'année (il serait alors toujours à moins de 7 jours de sa prochaine rentrée).
 */
const PERIOD_START_INCOME_RATIO = 0.4;

/** Nombre de jours entiers entre deux dates ISO (yyyy-mm-dd), ou null si l'une est invalide. */
function daysBetweenIso(fromIso: string, toIso: string): number | null {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * Jours restants avant la fin de la PÉRIODE D'ARGENT en cours = veille de la prochaine rentrée.
 *
 * ⚠️ Surtout PAS le nombre de jours restants dans le mois calendaire, qui était utilisé avant : payé
 * le 25, un utilisateur voyait sa part « Confort » fondre du 25 au 31 — au moment précis où il
 * venait d'être payé et où il en avait le plus. Le mois civil est une supposition ; la prochaine
 * rentrée d'argent (`next_income_date`, déjà détectée pour le point bas de trésorerie) est une
 * donnée réelle.
 *
 * Renvoie `null` — donc AUCUNE bascule, Confort intact — quand on ne peut rien affirmer : pas de
 * rentrée détectée, revenu de référence inconnu, entrée trop petite pour ouvrir une période, ou
 * date hors d'un horizon plausible.
 */
export function daysLeftInPeriod(data: PilotageData, today: Date): number | null {
  const next = data.next_income_date;
  if (!next) return null;
  const monthlyIncome = data.avg_monthly_income ?? 0;
  if (!(monthlyIncome > 0)) return null;
  if ((data.next_income_amount ?? 0) < monthlyIncome * PERIOD_START_INCOME_RATIO) return null;
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const days = daysBetweenIso(`${y}-${m}-${d}`, next);
  if (days == null || days < 0 || days > 60) return null;
  return days;
}

export function buildRecoOptions(data: PilotageData, x: RecoBuildExtras): ComputeRecoOptions {
  const cumulsTotal = x.preEpargneTotal + x.preInvestTotal;
  // Avancement de la PÉRIODE (pas du mois civil) : à l'approche de la prochaine rentrée d'argent, la
  // part « Confort » bascule vers « Conserver ». Calculé ICI → le Pilotage et le Pouls raisonnent
  // sur la même date.
  const now = x.today ?? new Date();
  const daysLeft = daysLeftInPeriod(data, now);
  const margin = data.safety_margin_amount ?? 0;
  const varRemaining = data.variable_envelope_remaining ?? 0;
  const trough = data.cashflow_trough ?? (data.current_checking_balance ?? 0);
  const savingsRemaining = data.month_savings_future ?? 0;
  const investRemaining = data.month_invest_future ?? 0;
  const savingsExecuted = Math.max(0, (data.month_savings_total ?? 0) - savingsRemaining);
  const investExecuted = Math.max(0, (data.month_invest_total ?? 0) - investRemaining);
  /* Dépassement de l'enveloppe : ce qui a été dépensé au-delà de ce qui était prévu pour le mois.
     Les dépenses variables DÉJÀ SAISIES pour les jours à venir font partie du prévu — elles sont
     déduites de l'enveloppe restante, pas un dépassement. */
  const variableOverspend = Math.max(
    0,
    (data.variable_envelope_spent ?? 0) + (data.variable_envelope_planned ?? 0) - (data.variable_envelope_initial ?? 0),
  );
  const recoGrossBudget = Math.max(0, trough - varRemaining - margin);
  /* Relyka (reste disponible) — la MÊME fonction que la carte du Pilotage, le Pouls et le bandeau
     « prochaine action » (lib/relyka). Cette soustraction à huit termes était recopiée ici : le jour
     où un terme change, les montants proposés cessent de faire exactement le Relyka. */
  const resteDisponible = computeRelyka({
    cashflowTrough: trough,
    savingsFuture: savingsRemaining,
    investFuture: investRemaining,
    reservePlanned: data.monthly_reserve_planned ?? 0,
    reservationsTotal: x.reservationsTotal,
    cumulsTotal,
    variableEnvelopeRemaining: varRemaining,
    safetyMargin: margin,
  });

  return {
    customTierAllocations: x.customTierAllocations,
    manualAllocation: x.manualAllocation ?? null,
    profileAllocations: x.profileAllocations ?? null,
    /* PAS ENCORE DE PROFIL → P1, le plus prudent.
       Le profil se déduit maintenant des seules données réelles (financialProfileEngine.
       computeProfileFromData) : tant qu'il manque une donnée pour le calculer, on n'invente pas un
       palier depuis le seul montant d'épargne — un compte neuf avec 20 000 € dormants passait ainsi
       pour « confortable » alors qu'on ne connaissait ni son revenu ni son rythme. */
    financialProfileId: x.financialProfileId ?? 'P0',
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
    //  (12 mois) sert à juger si un virement RÉCURRENT est durable — un horizon
    // court conclut toujours « tenable », il suffit d'entamer le matelas assez lentement.
    projectionGuard: {
      balances: data.projection_balances_6m ?? [],
      margin,
      sustainBalances: data.projection_balances_12m ?? [],
    },
    maxAmount: Math.max(0, floorToTen(resteDisponible)),
    daysLeftInPeriod: daysLeft,
  };
}
