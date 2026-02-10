/**
 * Moteur de recommandations intelligentes
 * ─────────────────────────────────────────
 * Analyse la santé financière et propose 2 à 4 recommandations
 * dont la somme = 100 % du « À dépenser ou placer en sécurité ».
 *
 * Types de recommandations :
 *   1. Épargner    → renforcer l'épargne de sécurité
 *   2. Investir    → alimenter un objectif d'investissement
 *   3. Se faire plaisir → budget dépenses variables / loisirs
 *   4. Conserver   → garder en réserve pour le mois suivant
 */

import type { PilotageData } from '../hooks/usePilotageData';

/* ── Types ───────────────────────────────────────────────── */

export type RecoType = 'save' | 'invest' | 'enjoy' | 'keep';

export interface SmartRecommendation {
  type: RecoType;
  /** Titre court affiché dans la carte */
  title: string;
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

export type SavingsTier = 'critical' | 'below_optimal' | 'healthy' | 'comfortable';

/* ── Couleurs par type ───────────────────────────────────── */

const RECO_COLORS: Record<RecoType, string> = {
  save:   '#34d399',  // vert (épargne)
  invest: '#a78bfa',  // violet (investissement)
  enjoy:  '#f59e0b',  // orange (variables/plaisir)
  keep:   '#60a5fa',  // bleu (courant/réserve)
};

const RECO_ICONS: Record<RecoType, string> = {
  save:   'shield-outline',
  invest: 'trending-up-outline',
  enjoy:  'sparkles-outline',
  keep:   'hourglass-outline',
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
    invest: 15,
    enjoy:  20,
    keep:   25,
  },
  healthy: {
    save:   15,
    invest: 35,
    enjoy:  30,
    keep:   20,
  },
  comfortable: {
    save:   10,
    invest: 45,
    enjoy:  30,
    keep:   15,
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

/** Clamp et arrondi */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* ── Moteur principal ────────────────────────────────────── */

export function computeRecommendations(data: PilotageData): SmartRecommendation[] {
  const budget = data.safe_to_spend;

  // Pas de budget → pas de recommandation
  if (budget <= 0) return [];

  // 1. Déterminer le palier d'épargne
  const tier = determineTier(
    data.current_savings,
    data.safety_threshold_min,
    data.safety_threshold_optimal,
    data.safety_threshold_comfort,
  );

  // 2. Partir des allocations de base du palier
  const alloc: Record<RecoType, number> = { ...TIER_ALLOCATIONS[tier] };

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

  // 6. Construire les recommandations
  return filtered.map(type => buildRecommendation(type, alloc[type], budget, tier, data));
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
  critical: 'Épargne critique',
  below_optimal: 'Épargne à renforcer',
  healthy: 'Bonne dynamique',
  comfortable: 'Épargne confortable',
};

/** Couleurs pour les paliers */
export const TIER_COLORS: Record<SavingsTier, string> = {
  critical: '#ef4444',
  below_optimal: '#f59e0b',
  healthy: '#34d399',
  comfortable: '#34d399',
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
  budget: number,
  tier: SavingsTier,
  data: PilotageData,
): SmartRecommendation {
  const amount = Math.round((percentage / 100) * budget);

  switch (type) {
    case 'save':
      return {
        type,
        title: 'Épargner',
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
        title: 'Se faire plaisir',
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
        title: 'Conserver',
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

function getInvestDescription(tier: SavingsTier, amount: number, data: PilotageData): string {
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
  return `Conservez ${amount} € sur votre compte courant comme marge de manœuvre pour le mois prochain.`;
}
