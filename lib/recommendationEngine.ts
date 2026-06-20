/**
 * Moteur de recommandations intelligentes
 * ─────────────────────────────────────────
 * Analyse la santé financière et propose 2 à 4 recommandations
 * dont la somme = 100 % du « Ce qu'il te reste ce mois-ci ».
 *
 * Types de recommandations :
 *   1. Épargner    → renforcer l'épargne de sécurité
 *   2. Investir    → alimenter un objectif d'investissement
 *   3. Se faire plaisir → budget dépenses variables / loisirs
 *   4. Conserver   → garder en réserve pour le mois suivant
 */

import type { PilotageData } from '../hooks/usePilotageData';
import type { FinancialProfile, FinancialProfileId } from '../types/database';
import { PROFILE_ALLOCATIONS } from './financialProfileEngine';
import { floorToTen } from './currency';

/* ── Types ───────────────────────────────────────────────── */

export type RecoType = 'save' | 'invest' | 'enjoy' | 'keep';

export interface SmartRecommendation {
  type: RecoType;
  /** Titre complet affiché dans la carte */
  title: string;
  /** Libellé court pour la légende de la barre */
  shortTitle: string;
  /** Description contextuelle */
  description: string;
  /** Montant en euros */
  amount: number;
  /** Pourcentage du safe_to_spend (0-100) */
  percentage: number;
  /** Couleur d'accent */
  color: string;
  /** Nom d'icône Ionicons */
  icon: string;
  /** Route expo-router à ouvrir, ou null si informationnel */
  actionRoute: string | null;
  /** Libellé du bouton d'action */
  actionLabel: string;
}

export type SavingsTier = 'critical' | 'below_optimal' | 'healthy' | 'p4_dynamic' | 'comfortable';

/* ── Couleurs par type ───────────────────────────────────── */

const RECO_COLORS: Record<RecoType, string> = {
  save:   '#34d399',
  invest: '#a78bfa',
  enjoy:  '#f59e0b',
  keep:   '#60a5fa',
};

const RECO_ICONS: Record<RecoType, string> = {
  save:   'shield-outline',
  invest: 'trending-up-outline',
  enjoy:  'sparkles-outline',
  keep:   'hourglass-outline',
};


export const PROFILE_LABELS: Record<FinancialProfile, string> = {
  economiser: 'Économiser',
  suivi: 'Suivi',
  optimiser: 'Optimiser',
  investir: 'Investir',
};

/* ── Répartitions par palier (en %) ──────────────────────── */
/*  Chaque ligne = [save, invest, enjoy, keep]                */

const TIER_ALLOCATIONS: Record<SavingsTier, Record<RecoType, number>> = {
  critical: {
    save:   60,
    invest:  0,
    enjoy:  10,
    keep:   30,
  },
  below_optimal: {
    save:   40,
    invest: 10,
    enjoy:  20,
    keep:   30,
  },
  healthy: {
    save:   25,
    invest: 25,
    enjoy:  20,
    keep:   30,
  },
  p4_dynamic: {
    save:   10,
    invest: 40,
    enjoy:  25,
    keep:   25,
  },
  comfortable: {
    save:    0,
    invest: 65,
    enjoy:  25,
    keep:   10,
  },
};

/* ── Seuil minimum pour afficher une recommandation ──────── */
const MIN_PERCENT_THRESHOLD = 5;

/* ── Helpers ─────────────────────────────────────────────── */

function determineTier(
  savings: number,
  thresholdMin: number,
  thresholdOptimal: number,
  thresholdComfort: number,
): SavingsTier {
  if (savings < thresholdMin) return 'critical';
  if (savings < thresholdOptimal) return 'below_optimal';
  if (savings < thresholdComfort) return 'healthy';
  return 'comfortable';
}


function applyUserAllocationPreferences(alloc: Record<RecoType, number>, data: any) {
  const custom = [data.allocation_save_percent, data.allocation_invest_percent, data.allocation_enjoy_percent, data.allocation_keep_percent];
  if (!custom.every((value) => typeof value === 'number' && !Number.isNaN(value))) return;
  const total = custom.reduce((sum, value) => sum + value, 0);
  if (total !== 100) return;
  alloc.save = data.allocation_save_percent;
  alloc.invest = data.allocation_invest_percent;
  alloc.enjoy = data.allocation_enjoy_percent;
  alloc.keep = data.allocation_keep_percent;
}

/** Clamp et arrondi */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ── Moteur principal ────────────────────────────────────── */

/** Seuils minimums de reste disponible pour afficher chaque type de reco. */
export interface RecoThresholds {
  seuil_reco_epargne: number;
  seuil_reco_invest: number;
  seuil_reco_plaisir: number;
  seuil_reco_conserver: number;
}

export interface ComputeRecoOptions {
  customTierAllocations?: Record<SavingsTier, Record<RecoType, number>>;
  financialProfileId?: FinancialProfileId;
  /** Budget de référence (= reste disponible). Défaut : data.safe_to_spend. */
  budget?: number;
  /** Seuils min de reste pour afficher chaque reco (§9). */
  thresholds?: RecoThresholds;
  /** Montants déjà alloués par catégorie (déduits du % théorique de chaque reco). */
  alreadyAllocated?: Partial<Record<RecoType, number>>;
}

export function computeRecommendations(
  data: PilotageData,
  opts: ComputeRecoOptions = {},
): SmartRecommendation[] {
  const { customTierAllocations, financialProfileId, thresholds } = opts;
  const budget = opts.budget ?? data.safe_to_spend;

  // Garde-fou marge de sécurité : si le solde courant est sous la marge, on ne
  // recommande que "Conserver" (tout le budget disponible, s'il en reste).
  if (
    (data.safety_margin_amount ?? 0) > 0 &&
    data.total_checking < (data.safety_margin_amount ?? 0)
  ) {
    if (budget <= 0) return [];
    return [buildRecommendation('keep', 100, Math.round(budget), 'critical', data)];
  }

  // Garde-fou PROJECTION (moyen terme) : si la trajectoire de trésorerie plonge sous le coussin
  // dans les N prochains mois, on FREINE → on ne recommande que "Conserver" (renforcer le coussin),
  // quel que soit le profil. La répartition du profil n'est PAS modifiée : c'est un frein de sécurité,
  // comme le garde-fou marge ci-dessus (n'agit qu'en situation de danger projeté).
  if (data.projection_in_danger) {
    if (budget <= 0) return [];
    return [buildRecommendation('keep', 100, Math.round(budget), 'critical', data)];
  }

  // Pas de budget → pas de recommandation
  if (budget <= 0) return [];

  let tier: SavingsTier;
  let alloc: Record<RecoType, number>;

  if (financialProfileId) {
    // Nouveau système : profil P1-P5 détermine directement les allocations
    alloc = { ...PROFILE_ALLOCATIONS[financialProfileId] };
    const tierMap: Record<FinancialProfileId, SavingsTier> = {
      P1: 'critical',
      P2: 'below_optimal',
      P3: 'healthy',
      P4: 'p4_dynamic',
      P5: 'comfortable',
    };
    tier = tierMap[financialProfileId];
  } else {
    // Ancien système : palier déterminé par le montant d'épargne
    tier = determineTier(
      data.current_savings,
      data.safety_threshold_min,
      data.safety_threshold_optimal,
      data.safety_threshold_comfort,
    );
    const tierTable = customTierAllocations ?? TIER_ALLOCATIONS;
    alloc = { ...tierTable[tier] };
    applyUserAllocationPreferences(alloc, data);
  }

  // 3. Modificateurs contextuels
  applyVariableTrendModifier(alloc, data.variable_trend_percentage);
  applyCheckingHealthModifier(alloc, data);
  applyInvestmentRatioModifier(alloc, data);

  // 4. Normaliser à 100 %
  normalizeAllocations(alloc);

  // 5. Filtrer les recommandations trop petites (< seuil minimum)
  const types: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];
  const filtered = types.filter(t => alloc[t] >= MIN_PERCENT_THRESHOLD);

  // Redistribuer les miettes
  if (filtered.length < types.length) {
    const removed = types.filter(t => !filtered.includes(t));
    const removedTotal = removed.reduce((s, t) => s + alloc[t], 0);
    const share = removedTotal / filtered.length;
    for (const t of filtered) alloc[t] += share;
    for (const t of removed) alloc[t] = 0;
    normalizeAllocations(alloc);
  }

  // 6. Montant net par catégorie = (% × budget) − déjà alloué réellement ce mois.
  const alreadyAllocated = opts.alreadyAllocated ?? {};
  const th = thresholds ?? { seuil_reco_epargne: 50, seuil_reco_invest: 100, seuil_reco_plaisir: 50, seuil_reco_conserver: 50 };
  const thresholdByType: Partial<Record<RecoType, number>> = {
    save: th.seuil_reco_epargne,
    invest: th.seuil_reco_invest,
    enjoy: th.seuil_reco_plaisir,
    keep: th.seuil_reco_conserver,
  };

  // 7. Construire les recommandations (montant net ≥ seuil)
  const result: SmartRecommendation[] = [];
  for (const type of filtered) {
    const raw = (alloc[type] / 100) * budget;
    const net = Math.round(Math.max(0, raw - (alreadyAllocated[type] ?? 0)));
    if (net <= 0) continue;
    const min = thresholdByType[type] ?? 0;
    if (net < min) continue;
    result.push(buildRecommendation(type, alloc[type], net, tier, data));
  }
  return result;
}

/** Renvoie le palier d'épargne courant (utile pour l'affichage) */
export function getCurrentTier(data: PilotageData): SavingsTier {
  return determineTier(
    data.current_savings,
    data.safety_threshold_min,
    data.safety_threshold_optimal,
    data.safety_threshold_comfort,
  );
}

/** Labels français pour les paliers */
export const TIER_LABELS: Record<SavingsTier, string> = {
  critical:      'Épargne critique',
  below_optimal: 'Épargne à renforcer',
  healthy:       'Stabilité à améliorer',
  p4_dynamic:    'Bonne dynamique',
  comfortable:   'Confortable',
};

/** Couleurs pour les paliers */
export const TIER_COLORS: Record<SavingsTier, string> = {
  critical:      '#ef4444',
  below_optimal: '#f59e0b',
  healthy:       '#3b82f6',
  p4_dynamic:    '#8b5cf6',
  comfortable:   '#34d399',
};

/** Descriptions par type pour l'admin */
export const RECO_TYPE_LABELS: Record<RecoType, string> = {
  save: 'Épargner',
  invest: 'Investir',
  enjoy: 'Se faire plaisir',
  keep: 'Conserver',
};

/** Export les allocations par palier pour l'admin */
export { TIER_ALLOCATIONS, RECO_COLORS, RECO_ICONS };

/* ── Modificateurs ───────────────────────────────────────── */

function applyVariableTrendModifier(alloc: Record<RecoType, number>, trendPct: number) {
  // Si dépenses variables en hausse → réduire "plaisir", augmenter "conserver"
  if (trendPct > 120) {
    const shift = clamp((trendPct - 120) / 10, 0, 15);
    alloc.enjoy = Math.max(0, alloc.enjoy - shift);
    alloc.keep += shift;
  }
  // Si dépenses variables en baisse → un peu plus de "plaisir"
  if (trendPct > 0 && trendPct < 80) {
    const shift = clamp((80 - trendPct) / 20, 0, 5);
    alloc.enjoy += shift;
    alloc.keep = Math.max(0, alloc.keep - shift);
  }
}

function applyCheckingHealthModifier(alloc: Record<RecoType, number>, data: PilotageData) {
  // Si le solde courant est serré (< 2× engagements mensuels) → boost "conserver"
  const monthlyCommit = data.committed_allocations + data.remaining_fixed_expenses;
  if (monthlyCommit > 0 && data.current_checking_balance < monthlyCommit * 2) {
    const shift = 10;
    alloc.keep += shift;
    alloc.save = Math.max(0, alloc.save - shift / 2);
    alloc.invest = Math.max(0, alloc.invest - shift / 2);
  }
}

function applyInvestmentRatioModifier(alloc: Record<RecoType, number>, data: PilotageData) {
  // Si très peu d'investissements par rapport à l'épargne → boost "investir"
  if (data.total_savings > 0 && data.total_invested < data.total_savings * 0.15) {
    const shift = 8;
    alloc.invest += shift;
    // Prendre sur le poste le plus élevé entre save et enjoy
    if (alloc.save >= alloc.enjoy) {
      alloc.save = Math.max(0, alloc.save - shift);
    } else {
      alloc.enjoy = Math.max(0, alloc.enjoy - shift);
    }
  }
}

/* ── Normalisation ───────────────────────────────────────── */

function normalizeAllocations(alloc: Record<RecoType, number>) {
  const total = alloc.save + alloc.invest + alloc.enjoy + alloc.keep;
  if (total <= 0) return;
  const factor = 100 / total;
  alloc.save = Math.round(alloc.save * factor);
  alloc.invest = Math.round(alloc.invest * factor);
  alloc.enjoy = Math.round(alloc.enjoy * factor);
  alloc.keep = Math.round(alloc.keep * factor);

  // Corriger les arrondis pour que ça tombe juste à 100
  const diff = 100 - (alloc.save + alloc.invest + alloc.enjoy + alloc.keep);
  if (diff !== 0) {
    // Ajouter/retirer au poste le plus gros
    const max = Math.max(alloc.save, alloc.invest, alloc.enjoy, alloc.keep);
    if (alloc.save === max) alloc.save += diff;
    else if (alloc.invest === max) alloc.invest += diff;
    else if (alloc.enjoy === max) alloc.enjoy += diff;
    else alloc.keep += diff;
  }
}

/* ── Construction de chaque recommandation ────────────────── */

function buildRecommendation(
  type: RecoType,
  percentage: number,
  rawAmount: number,
  tier: SavingsTier,
  data: PilotageData,
): SmartRecommendation {
  // Montant « proposition » : arrondi à la dizaine inférieure → le montant affiché, les
  // sous-textes/conseils (qui interpolent `amount`) et l'action validée (virement/conservation)
  // partagent tous cette même valeur arrondie.
  const amount = Math.max(0, floorToTen(rawAmount));
  switch (type) {
    case 'save':
      return {
        type,
        title: 'Épargner',
        shortTitle: 'Épargner',
        description: getSaveDescription(tier, amount, data),
        amount,
        percentage,
        color: RECO_COLORS.save,
        icon: RECO_ICONS.save,
        actionRoute: '/(tabs)/comptes',
        actionLabel: 'Transférer',
      };
    case 'invest':
      return {
        type,
        title: 'Investir',
        shortTitle: 'Investir',
        description: getInvestDescription(tier, amount, data),
        amount,
        percentage,
        color: RECO_COLORS.invest,
        icon: RECO_ICONS.invest,
        actionRoute: '/(tabs)/objectives',
        actionLabel: 'Voir objectifs',
      };
    case 'enjoy':
      return {
        type,
        title: 'Possibilité de se faire plaisir',
        shortTitle: 'Plaisir',
        description: getEnjoyDescription(amount, data),
        amount,
        percentage,
        color: RECO_COLORS.enjoy,
        icon: RECO_ICONS.enjoy,
        actionRoute: null,
        actionLabel: 'Compris',
      };
    case 'keep':
      return {
        type,
        title: 'Conserver pour plus tard',
        shortTitle: 'Conserver',
        description: getKeepDescription(amount, data),
        amount,
        percentage,
        color: RECO_COLORS.keep,
        icon: RECO_ICONS.keep,
        actionRoute: null,
        actionLabel: 'Compris',
      };
  }
}

/* ── Descriptions contextuelles ──────────────────────────── */

function getSaveDescription(tier: SavingsTier, amount: number, data: PilotageData): string {
  const gap = data.safety_threshold_optimal - data.current_savings;
  if (tier === 'critical') {
    return `Votre épargne est en dessous du seuil critique. Transférez ${amount} € vers votre compte épargne pour vous rapprocher de l'objectif de ${data.safety_threshold_min.toLocaleString('fr-FR')} €.`;
  }
  if (tier === 'below_optimal') {
    return `Il vous manque ${Math.max(0, gap).toLocaleString('fr-FR')} € pour atteindre le seuil optimal. Épargnez ${amount} € ce mois-ci.`;
  }
  return `Maintenez votre matelas de sécurité en épargnant ${amount} €.`;
}

function getInvestDescription(tier: SavingsTier, amount: number, _data: PilotageData): string {
  if (tier === 'comfortable') {
    return `Votre épargne est confortable. Placez ${amount} € sur vos investissements pour faire fructifier votre patrimoine.`;
  }
  if (tier === 'healthy') {
    return `Bonne santé financière ! Investissez ${amount} € pour diversifier votre patrimoine.`;
  }
  return `Commencez à investir ${amount} € même modestement pour préparer l'avenir.`;
}

function getEnjoyDescription(amount: number, data: PilotageData): string {
  if (data.variable_trend_percentage > 120) {
    return `Vos dépenses variables sont en hausse. Limitez-vous à ${amount} € de budget plaisir ce mois-ci.`;
  }
  if (data.variable_trend_percentage < 80 && data.variable_trend_percentage > 0) {
    return `Bravo, vos dépenses sont maîtrisées ! Profitez de ${amount} € pour vous faire plaisir.`;
  }
  return `Budget plaisir recommandé : ${amount} € pour vos dépenses variables et loisirs.`;
}

function getKeepDescription(amount: number, data: PilotageData): string {
  if (data.current_checking_balance < data.committed_allocations * 2) {
    return `Votre solde courant est un peu juste. Gardez ${amount} € en réserve pour couvrir les imprévus.`;
  }
  return `Conservez ${amount} € sur votre compte courant comme marge de manœuvre pour le mois prochain.\nCette somme sera déduite de votre Relyka pour ne pas y toucher.`;
}
