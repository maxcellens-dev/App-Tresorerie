/**
 * Moteur de recommandations intelligentes
 * ─────────────────────────────────────────
 * Analyse la santé financière et propose 2 à 4 recommandations
 * dont la somme = 100 % du « Ce qu'il te reste ce mois-ci ».
 *
 * Types de recommandations :
 *   1. Épargner    → renforcer l'épargne de sécurité
 *   2. Investir    → alimenter un objectif d'investissement
 *   3. Confort     → marge en plus dispo une fois les dépenses variables habituelles couvertes
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
  /**
   * Montant « actionnable » : borne basse (« minimum sûr ») quand les montants sont affichés en
   * fourchette, sinon = amount. C'est LUI qui est interpolé dans les textes et pré-rempli dans les
   * actions (virement / réservation / cumul) — on ne pousse jamais à déplacer de l'argent incertain.
   */
  actionAmount: number;
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
  /** Garde-fou marge × projection : le montant a été réduit (ou mis en réserve) — message d'explication. */
  guardNote?: string;
  /**
   * Tenue du montant en VIREMENT RÉCURRENT sur 6 mois. Donnée STRUCTURÉE (pas une phrase) : le texte
   * est composé avec la projection dans un seul bloc (lib/recoContext) — on ne veut pas 3 messages.
   */
  recurringFit?: RecurringFit;
}

/**
 * Le montant est-il tenable chaque mois sans entamer la marge de sécurité ?
 *  • sustainable : oui, à `monthly` €/mois ;
 *  • capped      : non — le maximum tenable en récurrent est `monthly` €/mois ;
 *  • month_only  : rien n'est tenable en récurrent (à gérer mois par mois).
 * `null`/absent = trajectoire indisponible (pas de conclusion possible).
 */
export type RecurringFit =
  | { kind: 'sustainable'; monthly: number }
  | { kind: 'capped'; monthly: number }
  | { kind: 'month_only' };

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

/* ── Ordre de consommation des recos (cascade de dépassement) ──────────────
 * Quand l'enveloppe des dépenses variables est épuisée, tout dépassement grignote
 * les recos une par une dans cet ordre (1er = réduit en premier). « Confort » d'abord,
 * puis les autres selon la prudence du budget. Les % d'allocation ne sont alors plus
 * exactement respectés : c'est voulu.
 */
export type ConsumptionMode = 'prudent' | 'equilibre' | 'dynamique';

export const CONSUMPTION_MODE_LABELS: Record<ConsumptionMode, string> = {
  prudent:   'Prudent',
  equilibre: 'Équilibré',
  dynamique: 'Dynamique',
};

export const DEFAULT_CONSUMPTION_ORDERS: Record<ConsumptionMode, RecoType[]> = {
  prudent:   ['enjoy', 'invest', 'save', 'keep'],
  equilibre: ['enjoy', 'invest', 'keep', 'save'],
  dynamique: ['enjoy', 'save', 'keep', 'invest'],
};

/** Mode « Auto » : le mode est dérivé du profil financier P1–P5. */
export const DEFAULT_AUTO_PROFILE_MAP: Record<FinancialProfileId, ConsumptionMode> = {
  P1: 'prudent', P2: 'prudent', P3: 'equilibre', P4: 'equilibre', P5: 'dynamique',
};

/**
 * Résout le mode de consommation depuis le réglage de prudence du budget.
 * `prudenceLevel` (profiles.prudence_level) : null = Auto (dérive du profil),
 * sinon 75 ≈ Prudent, 50 ≈ Équilibré, 25 ≈ Dynamique.
 */
export function resolveConsumptionMode(
  prudenceLevel: number | null | undefined,
  profileId: FinancialProfileId | undefined,
  autoMap: Record<FinancialProfileId, ConsumptionMode> = DEFAULT_AUTO_PROFILE_MAP,
): ConsumptionMode {
  if (prudenceLevel == null) return autoMap[profileId ?? 'P3'] ?? 'equilibre';
  if (prudenceLevel >= 63) return 'prudent';
  if (prudenceLevel >= 38) return 'equilibre';
  return 'dynamique';
}

/** Ordre complet (les 4 types) pour un mode, complété par les défauts si la config est partielle. */
export function getConsumptionOrder(
  mode: ConsumptionMode,
  orders: Partial<Record<ConsumptionMode, RecoType[]>> = DEFAULT_CONSUMPTION_ORDERS,
): RecoType[] {
  const order = orders[mode] ?? DEFAULT_CONSUMPTION_ORDERS[mode];
  const seen = new Set(order);
  return [...order, ...DEFAULT_CONSUMPTION_ORDERS[mode].filter((t) => !seen.has(t))];
}


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
  /**
   * Dépassement de l'enveloppe variable (€) : montant dépensé au-delà des dépenses variables
   * habituelles estimées. Quand > 0, il est grignoté sur les recos une par une dans
   * `consumptionOrder` (cascade), au lieu de réduire toutes les recos au prorata.
   * Le `budget` doit alors être le budget « enveloppe juste atteinte » (= budget courant + overspend).
   */
  overspend?: number;
  /** Ordre de consommation des recos quand `overspend > 0` (1er = réduit en premier). */
  consumptionOrder?: RecoType[];
  /**
   * Garde-fou MARGE × PROJECTION 6 MOIS : soldes courants projetés en fin de mois (index 0 = mois
   * courant), trajectoire partagée avec l'écran Projection (lib/tresoProjection). Épargner/Investir
   * sont plafonnés pour que le POINT BAS des 6 mois reste au-dessus de la marge (invest réduit en
   * premier, excédent → « Conserver »). Ignoré si margin ≤ 0 ou balances vide.
   */
  projectionGuard?: { balances: number[]; margin: number };
  /**
   * Plafond absolu du montant d'une reco (= reste réellement disponible « Ton Relyka », arrondi à
   * la dizaine). Appliqué AVANT la construction des textes → montant affiché, description, conseils
   * et CTA partagent la même valeur (pas de clamp après coup côté écran).
   */
  maxAmount?: number;
  /**
   * Montant « actionnable » pour les textes et CTA : borne basse « minimum sûr » quand les montants
   * sont affichés en fourchette (confiance moyenne/basse), sinon identité. Fourni par l'écran
   * (useReliability.proportional) pour rester alignée sur la fourchette du titre de la reco.
   */
  actionAmountFor?: (amount: number) => { value: number; isRange: boolean };
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
    return [buildRecommendation('keep', 100, Math.round(budget), 'critical', data, opts)];
  }

  // Garde-fou PROJECTION (moyen terme) : si la trajectoire de trésorerie plonge sous le coussin
  // dans les N prochains mois, on FREINE → on ne recommande que "Conserver" (renforcer le coussin),
  // quel que soit le profil. La répartition du profil n'est PAS modifiée : c'est un frein de sécurité,
  // comme le garde-fou marge ci-dessus (n'agit qu'en situation de danger projeté).
  if (data.projection_in_danger) {
    if (budget <= 0) return [];
    return [buildRecommendation('keep', 100, Math.round(budget), 'critical', data, opts)];
  }

  // Garde-fou MARGE × PROJECTION 6 MOIS : point bas de la trajectoire (écran Projection). S'il est
  // déjà sous la marge SANS toucher aux recos → tout « Conserver » (comme les freins ci-dessus).
  const guard = opts.projectionGuard;
  const guardTrough = guard && guard.margin > 0 && guard.balances.length > 0
    ? Math.min(...guard.balances)
    : null;
  if (guardTrough != null && guardTrough <= guard!.margin) {
    if (budget <= 0) return [];
    return [{
      ...buildRecommendation('keep', 100, Math.round(budget), 'critical', data, opts),
      guardNote: `Ton solde projeté passe sous ta marge de sécurité (${Math.round(guard!.margin).toLocaleString('fr-FR')} €) dans les 6 prochains mois : il vaut mieux conserver ce mois-ci.`,
    }];
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

  // 7. Montant net par catégorie = (% × budget) − déjà alloué réellement ce mois (clampé ≥ 0).
  // Si l'alloué dépasse la part théorique d'une catégorie (ex. on a déjà viré plus vers l'épargne
  // que sa part recommandée), l'excédent (`overflow`) n'est pas perdu : il est répercuté en cascade
  // ci-dessous, comme le dépassement. Sans ça, Σ(recos) dépasserait le Relyka (un segment saturerait
  // toute la jauge). Invariant visé : Σ(recos) = Relyka.
  const nets: Partial<Record<RecoType, number>> = {};
  let overflow = 0;
  for (const type of filtered) {
    const afterAlloc = (alloc[type] / 100) * budget - (alreadyAllocated[type] ?? 0);
    if (afterAlloc < 0) overflow += -afterAlloc;
    nets[type] = Math.round(Math.max(0, afterAlloc));
  }
  // Allocations volontaires fléchées sur une catégorie NON recommandée (ex. épargne déjà engagée
  // alors que la part « épargne » est à 0 % pour ce profil → reco filtrée) : ce montant réduit bien
  // le Relyka, donc il doit aussi être répercuté en cascade. Sinon Σ(recos) dépasse le Relyka.
  for (const type of types) {
    if (filtered.includes(type)) continue;
    overflow += Math.max(0, alreadyAllocated[type] ?? 0);
  }

  // 8. Cascade : le dépassement de l'enveloppe variable + l'excédent d'allocation volontaire
  // grignotent les recos une par une dans l'ordre choisi (selon la prudence) — « Confort » d'abord,
  // jusqu'à passer sous son seuil d'affichage, puis les suivantes. Les % d'allocation ne sont alors
  // plus exactement respectés : c'est voulu, et Σ(recos) reste égal au Relyka.
  let toConsume = Math.round(Math.max(0, (opts.overspend ?? 0) + overflow));
  if (toConsume > 0) {
    const order = opts.consumptionOrder ?? DEFAULT_CONSUMPTION_ORDERS.equilibre;
    for (const type of order) {
      if (toConsume <= 0) break;
      const cur = nets[type] ?? 0;
      const take = Math.min(cur, toConsume);
      nets[type] = cur - take;
      toConsume -= take;
    }
  }

  // 8bis. Garde-fou marge × projection : Épargner + Investir plafonnés au « headroom » (point bas
  // des 6 mois − marge) pour qu'exécuter les recos ne fasse pas plonger la trajectoire sous la marge.
  // Invest réduit en PREMIER (illiquide), épargne ensuite ; l'excédent file vers « Conserver »
  // (Σ recos = Relyka préservé). Réduit sous son seuil d'affichage → tout le reste part en réserve.
  const guardNotes: Partial<Record<RecoType, string>> = {};
  if (guardTrough != null) {
    const headroom = Math.max(0, Math.round(guardTrough - guard!.margin));
    let remaining = Math.max(0, (nets.save ?? 0) + (nets.invest ?? 0) - headroom);
    let moved = 0;
    for (const type of ['invest', 'save'] as RecoType[]) {
      if (remaining <= 0) break;
      const cur = nets[type] ?? 0;
      if (cur <= 0) continue;
      let take = Math.min(cur, remaining);
      let rest = cur - take;
      const minTh = thresholdByType[type] ?? 0;
      if (rest > 0 && rest < minTh) { take = cur; rest = 0; }
      remaining = Math.max(0, remaining - take);
      moved += take;
      nets[type] = rest;
      // Message seulement si la reco reste visible et que la réduction est significative (> 10 €).
      if (rest > 0 && take > 10) {
        guardNotes[type] = `Ce mois-ci tu pourrais rajouter ${take.toLocaleString('fr-FR')} € à cette recommandation : mais ton solde repasserait sous ta marge de sécurité d'ici 6 mois.`;
      }
    }
    if (moved > 0) {
      nets.keep = (nets.keep ?? 0) + moved;
      if (!filtered.includes('keep')) filtered.push('keep');
      // (Cas B) Pas de message orange sur « Conserver » ici : la mise en réserve est déjà reflétée
      // par le montant, et le message « Dont X € mis en réserve… » n'apportait rien.
    }
  }

  // 9. Construire les recommandations (montant net ≥ seuil d'affichage)
  const result: SmartRecommendation[] = [];
  for (const type of filtered) {
    const net = nets[type] ?? 0;
    if (net <= 0) continue;
    const min = thresholdByType[type] ?? 0;
    if (net < min) continue;
    result.push(buildRecommendation(type, alloc[type], net, tier, data, opts));
  }

  // 10. Notes du garde-fou + conseil « virement récurrent » (tenable ou non en répétant le montant
  // chaque mois : au mois k, le solde projeté porte k+1 exécutions). Le conseil n'est affiché que si
  // la reco n'a PAS été réduite (sinon le message de réduction suffit). Basé sur le montant
  // ACTIONNABLE (borne basse en fourchette) : c'est lui qu'on propose en virement.
  if (guardTrough != null) {
    for (const reco of result) {
      const note = guardNotes[reco.type];
      if (note) reco.guardNote = note;
      if ((reco.type === 'save' || reco.type === 'invest') && !note) {
        reco.recurringFit = computeRecurringFit(reco.actionAmount, guard!.balances, guard!.margin);
      }
    }
  }
  return result;
}

/**
 * Le montant est-il tenable en le répétant chaque mois ? Au mois k (0 = mois courant), le solde
 * projeté supporte (k+1) exécutions cumulées → tenable ⟺ montant ≤ min sur k de (solde_k − marge) ÷ (k+1).
 */
export function computeRecurringFit(amount: number, balances: number[], margin: number): RecurringFit | undefined {
  if (amount <= 0 || balances.length === 0) return undefined;
  let maxSustainable = Infinity;
  for (let k = 0; k < balances.length; k++) {
    maxSustainable = Math.min(maxSustainable, (balances[k] - margin) / (k + 1));
  }
  if (!Number.isFinite(maxSustainable)) return undefined;
  if (amount <= maxSustainable) return { kind: 'sustainable', monthly: amount };
  const maxMonthly = Math.max(0, floorToTen(maxSustainable));
  return maxMonthly > 0 ? { kind: 'capped', monthly: maxMonthly } : { kind: 'month_only' };
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
  enjoy: 'Confort',
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

/** Montant « actionnable » interpolé dans les textes : « 90 € » ou « au moins 90 € » (minimum sûr). */
interface ActionAmount { value: number; isRange: boolean }

function amountPhrase(a: ActionAmount): string {
  return `${a.isRange ? 'au moins ' : ''}${a.value.toLocaleString('fr-FR')} €`;
}

function buildRecommendation(
  type: RecoType,
  percentage: number,
  rawAmount: number,
  tier: SavingsTier,
  data: PilotageData,
  opts?: Pick<ComputeRecoOptions, 'maxAmount' | 'actionAmountFor'>,
): SmartRecommendation {
  // Montant « proposition » : plafonné au reste réellement disponible (maxAmount) PUIS arrondi à la
  // dizaine inférieure → le montant affiché, les sous-textes/conseils et l'action validée
  // (virement/conservation) partagent tous cette même valeur.
  const capped = opts?.maxAmount != null ? Math.min(rawAmount, opts.maxAmount) : rawAmount;
  const amount = Math.max(0, floorToTen(capped));
  // Montant actionnable : borne basse « minimum sûr » si les montants sont en fourchette.
  const action: ActionAmount = opts?.actionAmountFor?.(amount) ?? { value: amount, isRange: false };
  switch (type) {
    case 'save':
      return {
        type,
        title: 'Épargner',
        shortTitle: 'Épargner',
        description: getSaveDescription(tier, action, data),
        amount,
        actionAmount: action.value,
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
        description: getInvestDescription(tier, action, data),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.invest,
        icon: RECO_ICONS.invest,
        actionRoute: '/(tabs)/objectives',
        actionLabel: 'Voir objectifs',
      };
    case 'enjoy':
      return {
        type,
        title: 'Confort',
        shortTitle: 'Confort',
        description: getEnjoyDescription(action, data),
        amount,
        actionAmount: action.value,
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
        description: getKeepDescription(action, data),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.keep,
        icon: RECO_ICONS.keep,
        actionRoute: null,
        actionLabel: 'Compris',
      };
  }
}

/* ── Descriptions contextuelles ──────────────────────────── */

/** Nombre de mois de revenus couverts par l'épargne (mois de sécurité), en libellé générique. */
function securityMonthsLabel(months: number): string {
  if (months < 0.75) return 'moins d’1 mois';
  return `${Math.round(months)} mois`;
}

function getSaveDescription(tier: SavingsTier, action: ActionAmount, data: PilotageData): string {
  // Approche générique : épargne de sécurité totale + nb de mois de sécurité (= mois de REVENUS
  // couverts par l'épargne) + appréciation de niveau. Plus parlant qu'un écart à un « seuil » abstrait.
  const savings = Math.max(0, data.current_savings);
  // Mois de sécurité = épargne / revenu mensuel moyen (6 mois, hors 1er mois incomplet).
  const monthlyIncome = data.avg_monthly_income;
  const months = monthlyIncome > 0 ? savings / monthlyIncome : null;

  const QUAL: Record<SavingsTier, string> = {
    critical:      'Niveau encore faible, à renforcer en priorité',
    below_optimal: 'Niveau à renforcer',
    healthy:       'Niveau correct',
    p4_dynamic:    'Niveau solide',
    comfortable:   'Niveau confortable',
  };

  // Revenu non détecté → on n'affiche pas les « mois de sécurité » (juste le total + l'appréciation).
  const coverage = months != null ? ` (≈ ${securityMonthsLabel(months)} de sécurité)` : '';
  return `Épargne de sécurité : ${savings.toLocaleString('fr-FR')} €${coverage}. \nTu peux placer ${amountPhrase(action)} ce mois-ci pour la consolider.`;
}

function getInvestDescription(tier: SavingsTier, action: ActionAmount, _data: PilotageData): string {
  if (tier === 'comfortable') {
    return `Ton épargne est confortable. Tu peux placer ${amountPhrase(action)} ce mois-ci sur tes investissements, pour faire fructifier ton patrimoine.`;
  }
  if (tier === 'healthy') {
    return `Bonne santé financière ! Tu peux investir ${amountPhrase(action)} ce mois-ci pour diversifier ton patrimoine.`;
  }
  return `Tu peux investir ${amountPhrase(action)} ce mois-ci pour préparer l'avenir.`;
}

function getEnjoyDescription(action: ActionAmount, _data: PilotageData): string {
  // « Confort » = la marge totalement libre, une fois tes dépenses variables habituelles couvertes.
  // C'est elle qui est entamée en premier si tu dépenses au-delà de ton budget variable.
  return `Il te reste ${amountPhrase(action)} totalement disponibles ce mois-ci. \nFais-en ce que tu veux : des loisirs, un projet qui te tient à cœur, ou réinvestis-les pour accélérer tes objectifs !`;
}

function getKeepDescription(action: ActionAmount, data: PilotageData): string {
  if (data.current_checking_balance < data.committed_allocations * 2) {
    return `Ton solde courant est un peu juste. Garde ${amountPhrase(action)} en réserve pour couvrir les imprévus.`;
  }
  return `Conserve ${amountPhrase(action)} sur ton compte courant comme marge de manœuvre pour le mois prochain. Cette somme sera déduite de ton Relyka pour ne pas y toucher.`;
}
