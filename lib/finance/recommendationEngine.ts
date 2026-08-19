/**
 * Moteur de recommandations intelligentes
 * ─────────────────────────────────────────
 * Analyse la santé financière et propose 2 à 4 recommandations
 * dont la somme = 100 % du « Ce qu'il te reste ce mois-ci ».
 *
 * Types de recommandations :
 *   1. Épargner    → renforcer l'épargne de sécurité
 *   2. Investir    → alimenter un compte d'investissement
 *   3. Confort     → marge en plus dispo une fois les dépenses variables habituelles couvertes
 *   4. Conserver   → garder en réserve pour le mois suivant
 */

import type { PilotageData } from '../../hooks/pilotage/usePilotageData';
import type { FinancialProfile, FinancialProfileId } from '../../types/database';
import { PROFILE_ALLOCATIONS, PROFILE_TO_TIER, resolveProfileId } from './financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel } from './securityCushion';
import { computeFinancialPriority, applyPriorityBounds } from './financialPriorities';
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
  /** Garde-fou marge × projection — message tout prêt (cas « tout conserver » : trajectoire déjà sous la marge). */
  guardNote?: string;
  /**
   * Garde-fou marge × projection — cas « reco RÉDUITE » (épargne/invest plafonnés). Donnée STRUCTURÉE :
   * `addMore` = ce qu'on pourrait ajouter en plus, `total` = le total possible sans le garde-fou.
   * Le TEXTE est composé côté écran (RecommendationCard) → un seul message combiné si épargne + invest
   * sont tous deux plafonnés.
   */
  guard?: { addMore: number; total: number };
  /**
   * Tenue du montant en VIREMENT RÉCURRENT sur 6 mois. Donnée STRUCTURÉE (pas une phrase) : le texte
   * est composé avec la projection dans un seul bloc (lib/recoContext) — on ne veut pas 3 messages.
   */
  recurringFit?: RecurringFit;
  /**
   * État FACTUEL rattaché à la reco, sans son montant (il est déjà lu sur la tuile). Aujourd'hui
   * seul « Épargner » en a un : le niveau du matelas de sécurité. Le tableau de bord le met en
   * préambule du message de la décision — c'est la seule chose que la description apportait et que
   * la projection ne dit pas.
   */
  stateNote?: string;
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

/**
 * Mode « Auto » : le mode de consommation du budget est dérivé du profil financier (P0–P9).
 * Prudent tant que le matelas n'est pas fait, équilibré une fois la réserve constituée, dynamique
 * quand l'investissement est en place. P0 (Découverte) reste prudent : on ne sait rien.
 */
export const DEFAULT_AUTO_PROFILE_MAP: Record<FinancialProfileId, ConsumptionMode> = {
  P0: 'prudent',
  P1: 'prudent', P2: 'prudent', P3: 'prudent',
  P4: 'equilibre', P5: 'equilibre', P6: 'equilibre',
  P7: 'dynamique', P8: 'dynamique', P9: 'dynamique',
};

/**
 * Résout le mode de consommation depuis le réglage de prudence du budget.
 * `prudenceLevel` (profiles.prudence_level) : null = Auto (dérive du profil),
 * sinon 75 ≈ Prudent, 50 ≈ Équilibré, 25 ≈ Dynamique.
 */
export function resolveConsumptionMode(
  prudenceLevel: number | null | undefined,
  profileId: FinancialProfileId | undefined,
  /* PARTIEL exprès : la table vient de la base (réglage admin) et a été écrite quand il n'existait
     que cinq profils. Un profil ajouté depuis n'y figure pas — on retombe alors sur le défaut du
     code, jamais sur `undefined`. */
  autoMap: Partial<Record<FinancialProfileId, ConsumptionMode>> = DEFAULT_AUTO_PROFILE_MAP,
): ConsumptionMode {
  if (prudenceLevel == null) {
    const id = resolveProfileId(profileId);
    return autoMap[id] ?? DEFAULT_AUTO_PROFILE_MAP[id] ?? 'equilibre';
  }
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

/**
 * Montant minimal d'une reco de REPLI (quand aucun poste n'atteint son seuil d'affichage).
 * En dessous, il n'y a vraiment plus rien à proposer et on n'affiche aucune reco.
 */
const MIN_FALLBACK_AMOUNT = 10;

/**
 * FIN DE PÉRIODE — fenêtre (jours restants AVANT LA PROCHAINE RENTRÉE D'ARGENT) sur laquelle la part
 * « Confort » bascule progressivement vers « Conserver » : à quelques jours de la fin, proposer de la
 * marge de plaisir n'a plus de sens (pas le temps d'en profiter) et ce qui reste se reporte
 * naturellement sur la période suivante.
 *
 * ⚠️ « PÉRIODE », PAS « MOIS CALENDAIRE ». Cette bascule suivait le 31 du mois : quelqu'un payé le 25
 * se voyait donc supprimer son Confort du 25 au 31 — c'est-à-dire au tout DÉBUT de son mois d'argent,
 * quand il vient d'être payé. Le calendrier est une supposition ; la rentrée d'argent, elle, est une
 * donnée réelle (cf. daysLeftInPeriod dans lib/recoInputs). Période inconnue → aucune bascule.
 */
const PERIOD_END_WINDOW_DAYS = 7;
/** En deçà de ce nombre de jours restants, « Conserver » devient un report sur la période suivante. */
const PERIOD_END_LABEL_DAYS = 5;

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

/**
 * Allocation (%) par poste — LA source unique des pourcentages de répartition, partagée entre le
 * moteur de recos et le Pouls (capacité d'investissement) : profil P0-P9 (ou paliers d'épargne +
 * préférences custom en legacy), puis modificateurs contextuels, normalisation à 100 %.
 * Sans ça, deux écrans peuvent annoncer des montants « plaçables » différents pour le même mois.
 */
export function deriveRecoAllocations(
  data: PilotageData,
  opts: {
    customTierAllocations?: Record<SavingsTier, Record<RecoType, number>>;
    financialProfileId?: FinancialProfileId;
    /** Jours restants avant la prochaine rentrée d'argent (fin de période : « Confort » → « Conserver »). */
    daysLeftInPeriod?: number | null;
  } = {},
): { tier: SavingsTier; alloc: Record<RecoType, number> } {
  let tier: SavingsTier;
  let alloc: Record<RecoType, number>;

  if (opts.financialProfileId) {
    /* ── DEUX NIVEAUX : le profil pose le CONTEXTE, la situation décide du MOIS ────────────────
       Le profil donnait seul les pourcentages : deux personnes au même palier recevaient le même
       conseil, que l'une finisse le mois à découvert ou avec 800 € d'avance. Et un palier bouge
       lentement — c'est sa raison d'être — donc il ne pouvait pas réagir à un mois qui dérape.

       La PRIORITÉ (lib/financialPriorities) regarde les faits du moment et pose des bornes que le
       profil ne peut pas franchir : investissement à 0 % tant qu'il n'y a pas un mois de réserve,
       épargne plancher tant qu'elle n'est pas constituée, remboursement avant placement… Le profil
       garde toute son influence À L'INTÉRIEUR de ces bornes — c'est lui qui distingue deux
       personnes en même priorité. Le PALIER, lui, ne sert plus qu'au vocabulaire des conseils. */
    // Identifiant venu de la base : ramené sur le référentiel de CE bundle (cf. resolveProfileId).
    const pid = resolveProfileId(opts.financialProfileId);
    const priority = computeFinancialPriority({
      monthsOfReserve: computeSecurityCushion({
        availableSavings: data.current_savings,
        monthlyEssentialExpenses: data.monthly_essential_expenses,
        avgMonthlyIncome: data.avg_monthly_income,
      }).months,
      monthlySurplus: data.safe_to_spend ?? 0,
      avgMonthlyIncome: data.avg_monthly_income ?? 0,
      monthlyEssentialExpenses: data.monthly_essential_expenses ?? 0,
      checkingBalance: data.current_checking_balance ?? 0,
      savingsBalance: data.current_savings ?? 0,
      investedBalance: data.total_invested ?? 0,
    });
    alloc = applyPriorityBounds({ ...PROFILE_ALLOCATIONS[pid] }, priority);
    tier = PROFILE_TO_TIER[pid];
  } else {
    // Ancien système : palier déterminé par le montant d'épargne
    tier = determineTier(
      data.current_savings,
      data.safety_threshold_min,
      data.safety_threshold_optimal,
      data.safety_threshold_comfort,
    );
    const tierTable = opts.customTierAllocations ?? TIER_ALLOCATIONS;
    alloc = { ...tierTable[tier] };
    applyUserAllocationPreferences(alloc, data);
  }

  // Modificateurs contextuels puis normalisation à 100 %.
  applyVariablePaceModifier(alloc, data.variable_pace_percentage);
  applyCheckingHealthModifier(alloc, data);
  applyInvestmentRatioModifier(alloc, data);
  // Fin de PÉRIODE EN DERNIER : ne touche que « Confort » → « Conserver » (épargne/invest inchangés,
  // pour que la capacité d'investissement annoncée par le Pouls reste la même).
  applyPeriodEndModifier(alloc, opts.daysLeftInPeriod);
  normalizeAllocations(alloc);
  return { tier, alloc };
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
  projectionGuard?: {
    balances: number[];
    margin: number;
    /**
     * Trajectoire LONGUE (12 mois) servant à juger la DURABILITÉ d'un virement récurrent
     * (cf. computeRecurringFit). Le garde-fou, lui, reste sur les 6 mois de  — c'est
     * l'horizon annoncé dans ses messages. Absente → repli sur .
     */
    sustainBalances?: number[];
  };
  /**
   * Plafond absolu du montant d'une reco (= reste réellement disponible « Ton Relyka », arrondi à
   * la dizaine). Appliqué AVANT la construction des textes → montant affiché, description, conseils
   * et CTA partagent la même valeur (pas de clamp après coup côté écran).
   */
  maxAmount?: number;
  /**
   * Montant « actionnable » pour les textes et CTA : borne basse « minimum sûr » quand les montants
   * sont affichés en fourchette (confiance moyenne/basse), sinon identité. Fourni par l'écran
   * (useReliability.actionable) pour rester alignée sur la fourchette du titre de la reco.
   * Le `type` est passé car le DOUTE EST DIRECTIONNEL : la borne basse protège les gestes qui
   * SORTENT l'argent du compte (épargner / investir, irréversibles) ; « Conserver » ne sort rien du
   * compte, donc en cas de doute il faut en garder PLUS, pas moins → montant plein.
   */
  actionAmountFor?: (amount: number, type: RecoType) => { value: number; isRange: boolean };
  /**
   * Jours restants avant la PROCHAINE RENTRÉE D'ARGENT (fin de la période d'argent réelle, pas du
   * mois calendaire) : bascule progressive « Confort » → « Conserver », et « Conserver » devient un
   * report sur la période suivante. Absent / `null` = aucun modificateur (cf. lib/recoInputs).
   */
  daysLeftInPeriod?: number | null;
}

export function computeRecommendations(
  data: PilotageData,
  opts: ComputeRecoOptions = {},
): SmartRecommendation[] {
  const { customTierAllocations, financialProfileId, thresholds } = opts;
  const budget = opts.budget ?? data.safe_to_spend;
  const types: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];

  /**
   * FREINS DE SÉCURITÉ : tout le reste en « Conserver ».
   * Deux garde-fous par rapport à l'ancienne version, qui proposait 100 % du budget BRUT :
   *  • on déduit ce qui est DÉJÀ alloué (virements exécutés/prévus, cumuls, réservations) — comme
   *    le fait le chemin normal — sinon on repropose de conserver de l'argent déjà engagé ;
   *  • on n'émet RIEN si le montant retombe à 0 une fois plafonné au Relyka (plus de carte « 0 € »).
   */
  const keepEverything = (guardNote?: string): SmartRecommendation[] => {
    const allocated = types.reduce((s, t) => s + Math.max(0, opts.alreadyAllocated?.[t] ?? 0), 0);
    const net = Math.round(Math.max(0, budget - allocated));
    if (net <= 0) return [];
    const reco = buildRecommendation('keep', 100, net, 'critical', data, opts);
    if (reco.amount <= 0) return [];
    return [guardNote ? { ...reco, guardNote } : reco];
  };

  // Garde-fou marge de sécurité : si le solde courant est sous la marge, on ne
  // recommande que "Conserver" (tout le budget disponible, s'il en reste).
  if (
    (data.safety_margin_amount ?? 0) > 0 &&
    data.total_checking < (data.safety_margin_amount ?? 0)
  ) {
    return keepEverything();
  }

  // Garde-fou PROJECTION (moyen terme) : si la trajectoire de trésorerie plonge sous le coussin
  // dans les N prochains mois, on FREINE → on ne recommande que "Conserver" (renforcer le coussin),
  // quel que soit le profil. La répartition du profil n'est PAS modifiée : c'est un frein de sécurité,
  // comme le garde-fou marge ci-dessus (n'agit qu'en situation de danger projeté).
  if (data.projection_in_danger) {
    return keepEverything();
  }

  // Garde-fou MARGE × PROJECTION 6 MOIS : point bas de la trajectoire (écran Projection). S'il est
  // déjà sous la marge SANS toucher aux recos → tout « Conserver » (comme les freins ci-dessus).
  const guard = opts.projectionGuard;
  const guardTrough = guard && guard.margin > 0 && guard.balances.length > 0
    ? Math.min(...guard.balances)
    : null;
  if (guardTrough != null && guardTrough <= guard!.margin) {
    return keepEverything(
      `ton solde projeté passe sous ta marge de sécurité (${Math.round(guard!.margin).toLocaleString('fr-FR')} €) dans les 6 prochains mois : il vaut mieux conserver ton Relyka ce mois-ci.`,
    );
  }

  // Pas de budget → pas de recommandation
  if (budget <= 0) return [];

  const { tier, alloc } = deriveRecoAllocations(data, {
    customTierAllocations, financialProfileId, daysLeftInPeriod: opts.daysLeftInPeriod,
  });

  // 5. Filtrer les recommandations trop petites (< seuil minimum)
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
  const guardInfo: Partial<Record<RecoType, { addMore: number; total: number }>> = {};
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
      // Donnée structurée seulement si la reco reste visible et que la réduction est significative (> 10 €).
      // `total` = ce qui était possible AVANT le garde-fou (rest visible + ce qu'on a retiré).
      if (rest > 0 && take > 10) {
        guardInfo[type] = { addMore: take, total: rest + take };
      }
    }
    if (moved > 0) {
      nets.keep = (nets.keep ?? 0) + moved;
      if (!filtered.includes('keep')) filtered.push('keep');
      // (Cas B) Pas de message orange sur « Conserver » ici : la mise en réserve est déjà reflétée
      // par le montant, et le message « Dont X € mis en réserve… » n'apportait rien.
    }
  }

  // 9. MIETTES : un poste sous son seuil d'affichage ne disparaît plus AVEC son montant — celui-ci
  // rejoint le poste le MIEUX PROTÉGÉ (dernier de la cascade, celui qu'on grignote en dernier).
  // Avant, chaque poste sous son seuil était simplement jeté : un petit Relyka voyait ses 4 postes
  // filtrés un à un et l'écran annonçait « tout est traité ✨ » alors qu'il restait de l'argent.
  const consumption = opts.consumptionOrder ?? DEFAULT_CONSUMPTION_ORDERS.equilibre;
  const protection = (t: RecoType) => consumption.indexOf(t); // plus grand = mieux protégé
  const mostProtected = (list: RecoType[]) => list.reduce((a, b) => (protection(a) >= protection(b) ? a : b));
  const shown = filtered.filter((t) => (nets[t] ?? 0) > 0 && (nets[t] ?? 0) >= (thresholdByType[t] ?? 0));
  if (shown.length > 0) {
    let crumbs = 0;
    for (const type of filtered) {
      if (shown.includes(type)) continue;
      crumbs += Math.max(0, nets[type] ?? 0);
      nets[type] = 0;
    }
    if (crumbs > 0) {
      const host = mostProtected(shown);
      nets[host] = (nets[host] ?? 0) + crumbs;
    }
  }

  // 9bis. REPLI « une seule reco » : aucun poste n'atteint son seuil (Relyka trop petit pour être
  // découpé en 4). On ne prétend pas que tout est traité : on propose de TOUT conserver — le seul
  // geste qui ait du sens en dessous des seuils d'action, et celui que l'utilisateur attend.
  if (shown.length === 0) {
    const rest = types.reduce((s, t) => s + Math.max(0, nets[t] ?? 0), 0);
    const reco = buildRecommendation('keep', 100, Math.round(rest), tier, data, opts);
    return reco.amount >= MIN_FALLBACK_AMOUNT ? [reco] : [];
  }

  // 10. RÉCONCILIATION avec le Relyka AFFICHÉ. Deux dérives à corriger, dans les deux sens :
  //  • chaque montant est arrondi à la dizaine inférieure (jusqu'à 9 € perdus par poste) → Σ(recos)
  //    passait sous le Relyka ; le reliquat va au poste le MIEUX protégé ;
  //  • le plafond `maxAmount` (= Relyka arrondi) s'applique poste par poste, jamais à la somme →
  //    Σ(recos) pouvait le DÉPASSER (jauge annonçant plus que le Relyka) ; l'excédent est repris
  //    sur le poste le MOINS protégé, comme la cascade de dépassement.
  const capAmount = (v: number) => Math.max(0, floorToTen(opts.maxAmount != null ? Math.min(v, opts.maxAmount) : v));
  const target = capAmount(shown.reduce((s, t) => s + (nets[t] ?? 0), 0));
  const rounded = shown.reduce((s, t) => s + capAmount(nets[t] ?? 0), 0);
  const delta = target - rounded;
  if (delta >= 10) {
    const host = mostProtected(shown);
    nets[host] = (nets[host] ?? 0) + floorToTen(delta);
  } else if (delta <= -10) {
    let excess = floorToTen(-delta);
    for (const type of consumption) {
      if (excess <= 0) break;
      if (!shown.includes(type)) continue;
      const take = Math.min(nets[type] ?? 0, excess);
      nets[type] = (nets[type] ?? 0) - take;
      excess -= take;
    }
  }

  // 11. Construire les recommandations retenues.
  const result: SmartRecommendation[] = shown.map((type) =>
    buildRecommendation(type, alloc[type], Math.round(nets[type] ?? 0), tier, data, opts));

  // 12. Notes du garde-fou + conseil « virement récurrent » (tenable ou non en répétant le montant
  // chaque mois : au mois k, le solde projeté porte k+1 exécutions). Le conseil n'est affiché que si
  // la reco n'a PAS été réduite (sinon le message de réduction suffit). Basé sur le montant
  // ACTIONNABLE (borne basse en fourchette) : c'est lui qu'on propose en virement.
  if (guardTrough != null) {
    for (const reco of result) {
      const info = guardInfo[reco.type];
      if (info) reco.guard = info;
      if ((reco.type === 'save' || reco.type === 'invest') && !info) {
        // Durabilité jugée sur la trajectoire LONGUE quand elle est fournie : un mois atypique
        // pèse moins sur la pente, et un comportement qui ne casse qu'au 10ᵉ mois est vu.
        reco.recurringFit = computeRecurringFit(
          reco.actionAmount, guard!.sustainBalances?.length ? guard!.sustainBalances : guard!.balances, guard!.margin,
        );
      }
    }
  }
  return result;
}

/**
 * Pente mensuelle du solde projeté = SURPLUS STRUCTUREL (ce que le mois type dégage réellement,
 * virements récurrents déjà déduits puisqu'ils sont dans la trajectoire).
 *
 * Le mois 0 est PARTIEL (on est au milieu du mois courant : il ne porte que la fin du mois) — il
 * fausserait la pente vers le haut ou le bas selon le jour où on regarde. On part donc du mois 1.
 * Renvoie `null` quand la série est trop courte pour conclure.
 */
function monthlySurplus(balances: number[]): number | null {
  if (balances.length >= 3) return (balances[balances.length - 1] - balances[1]) / (balances.length - 2);
  if (balances.length === 2) return balances[1] - balances[0];
  return null;
}

/**
 * Le montant est-il tenable en le répétant chaque mois ?
 *
 * DEUX conditions, et il faut les deux :
 *
 *  1. TRANSITION — ne pas passer sous la marge pendant l'horizon projeté. Au mois k, le solde
 *     projeté supporte (k+1) exécutions cumulées → montant ≤ min sur k de (solde_k − marge) ÷ (k+1).
 *
 *  2. DURABILITÉ — le solde ne doit pas DÉCLINER. C'est la condition qui manquait : la 1ʳᵉ n'est
 *     qu'un test d'épuisement sur horizon FINI, qui répond toujours « oui » si l'horizon est assez
 *     court, puisqu'elle autorise à grignoter le matelas lentement. Un montant qui ne casse rien à
 *     6 mois pouvait mettre l'utilisateur dans le rouge au 15ᵉ. On borne donc aussi par le surplus
 *     mensuel structurel : au-delà, chaque mois retire plus que le mois ne rapporte.
 *
 * Surplus ≤ 0 → RIEN n'est tenable en récurrent : le geste ne peut être que ponctuel.
 */
export function computeRecurringFit(amount: number, balances: number[], margin: number): RecurringFit | undefined {
  if (amount <= 0 || balances.length === 0) return undefined;

  // 1) Transition : jamais sous la marge sur l'horizon projeté.
  let maxHorizon = Infinity;
  for (let k = 0; k < balances.length; k++) {
    maxHorizon = Math.min(maxHorizon, (balances[k] - margin) / (k + 1));
  }
  if (!Number.isFinite(maxHorizon)) return undefined;

  // 2) Durabilité : ne pas retirer plus que ce que le mois dégage.
  const surplus = monthlySurplus(balances);
  const maxSustainable = surplus == null ? maxHorizon : Math.min(maxHorizon, surplus);

  if (maxSustainable <= 0) return { kind: 'month_only' };
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

/** Descriptions par type pour l'admin. « Réserver » = le mot d'affichage (cf. shortTitle). */
export const RECO_TYPE_LABELS: Record<RecoType, string> = {
  save: 'Épargner',
  invest: 'Investir',
  enjoy: 'Confort',
  keep: 'Réserver',
};

/** Export les allocations par palier pour l'admin */
export { TIER_ALLOCATIONS, RECO_COLORS, RECO_ICONS };

/* ── Modificateurs ───────────────────────────────────────── */

/**
 * RYTHME de dépenses variables (100 = rythme habituel), pas taux de remplissage.
 *
 * ⚠️ Attend `variable_pace_percentage` (lib/spendingPace), qui rapporte le dépensé à l'AVANCEMENT
 * du mois. L'ancien `variable_trend_percentage` était un remplissage : il valait mécaniquement 5 %
 * le 3 du mois → cette fonction lisait « dépenses en baisse » et gonflait « Confort » de 5 points
 * en début de mois, puis le dégonflait jour après jour sans qu'aucune dépense ne le justifie.
 * `null` (trop tôt dans le mois pour conclure) → on ne touche à RIEN.
 */
function applyVariablePaceModifier(alloc: Record<RecoType, number>, pacePct: number | null | undefined) {
  if (pacePct == null || !Number.isFinite(pacePct) || pacePct <= 0) return;
  // Rythme au-dessus des habitudes → réduire « Confort », renforcer « Conserver ».
  if (pacePct > 120) {
    const shift = clamp((pacePct - 120) / 10, 0, 15);
    alloc.enjoy = Math.max(0, alloc.enjoy - shift);
    alloc.keep += shift;
  }
  // Rythme en dessous des habitudes → un peu plus de « Confort ».
  if (pacePct < 80) {
    const shift = clamp((80 - pacePct) / 20, 0, 5);
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

/**
 * FIN DE PÉRIODE : la part « Confort » se déverse progressivement dans « Conserver » sur les derniers
 * jours AVANT LA PROCHAINE RENTRÉE D'ARGENT (100 % la veille). La veille de la paie, proposer
 * « fais-toi plaisir avec 30 € » n'a plus de sens : ce qui reste se reporte sur la période suivante.
 * Épargner / Investir ne bougent pas.
 *
 * `daysLeft` nul/inconnu → AUCUNE bascule. On ne retombe surtout pas sur le calendrier : mieux vaut
 * un Confort intact qu'un Confort supprimé pour une raison fausse (cf. PERIOD_END_WINDOW_DAYS).
 */
function applyPeriodEndModifier(alloc: Record<RecoType, number>, daysLeft?: number | null) {
  if (daysLeft == null || !Number.isFinite(daysLeft) || daysLeft >= PERIOD_END_WINDOW_DAYS) return;
  const t = clamp((PERIOD_END_WINDOW_DAYS - Math.max(0, daysLeft)) / PERIOD_END_WINDOW_DAYS, 0, 1);
  const shift = alloc.enjoy * t;
  alloc.enjoy = Math.max(0, alloc.enjoy - shift);
  alloc.keep += shift;
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
  opts?: Pick<ComputeRecoOptions, 'maxAmount' | 'actionAmountFor' | 'daysLeftInPeriod'>,
): SmartRecommendation {
  // Montant « proposition » : plafonné au reste réellement disponible (maxAmount) PUIS arrondi à la
  // dizaine inférieure → le montant affiché, les sous-textes/conseils et l'action validée
  // (virement/conservation) partagent tous cette même valeur.
  const capped = opts?.maxAmount != null ? Math.min(rawAmount, opts.maxAmount) : rawAmount;
  const amount = Math.max(0, floorToTen(capped));
  // Montant actionnable : borne basse « minimum sûr » si les montants sont en fourchette.
  // FILET : une borne basse nulle (doute plus large que le Relyka) produisait des cartes absurdes —
  // « Conserve au moins 0 € », CTA et virements pré-remplis à 0 € — pour un montant affiché non nul.
  // On retombe alors sur le montant proposé lui-même.
  const proposed = opts?.actionAmountFor?.(amount, type);
  const action: ActionAmount = proposed && proposed.value > 0 ? proposed : { value: amount, isRange: false };
  // Fin de PÉRIODE (veille de la prochaine rentrée d'argent) : « Conserver » devient explicitement
  // un report sur la période suivante.
  const periodEnd = opts?.daysLeftInPeriod != null && opts.daysLeftInPeriod <= PERIOD_END_LABEL_DAYS;
  switch (type) {
    case 'save':
      return {
        type,
        title: 'Épargner',
        shortTitle: 'Épargner',
        description: getSaveDescription(tier, action, data),
        stateNote: getSaveStateNote(tier, data),
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
        // Investir se fait par un virement vers le compte d'investissement, comme épargner : la
        // page « Objectifs » qui portait ce geste n'existe plus.
        actionRoute: '/(tabs)/comptes',
        actionLabel: 'Transférer',
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
        // VOCABULAIRE FIGÉ : à l'affichage on dit « Réserver » / « Réservé » — c'est le mot employé
        // partout ailleurs dans l'app (ligne « Réservé » du suivi, montants réservés). « Reporter »
        // introduisait un troisième terme pour la même chose. « Conserver » ne subsiste que dans les
        // explications, pour dire ce que le geste FAIT.
        // « Après ta paie » plutôt que « le mois prochain » : l'horizon est la prochaine rentrée
        // d'argent, qui ne tombe pas le 1ᵉʳ pour tout le monde.
        title: periodEnd ? 'Réserver pour après ta rentrée d’argent' : 'Réserver pour plus tard',
        shortTitle: 'Réserver',
        description: getKeepDescription(action, data, periodEnd),
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

/**
 * Appréciation du niveau d'épargne, formulée en TITRE (« Épargne à renforcer ») plutôt qu'en
 * suffixe (« … — niveau à renforcer »). Le jugement passe ainsi devant le chiffre, en trois mots,
 * au lieu de rallonger une phrase déjà longue.
 */
const SAVE_LEVEL_LABEL: Record<SavingsTier, string> = {
  critical:      'Épargne à constituer',
  below_optimal: 'Épargne à renforcer',
  healthy:       'Épargne correcte',
  p4_dynamic:    'Épargne solide',
  comfortable:   'Épargne confortable',
};

function getSaveDescription(tier: SavingsTier, action: ActionAmount, data: PilotageData): string {
  // Approche générique : épargne de sécurité totale + nb de mois de sécurité (= mois de DÉPENSES
  // couverts par l'épargne) + appréciation de niveau. Plus parlant qu'un écart à un « seuil » abstrait.
  const savings = Math.max(0, data.current_savings);
  // Mois de sécurité — MÊME définition que partout (lib/securityCushion) : base = les DÉPENSES.
  const months = computeSecurityCushion({
    availableSavings: savings,
    monthlyEssentialExpenses: data.monthly_essential_expenses,
    avgMonthlyIncome: data.avg_monthly_income,
  }).months;

  // Revenu non détecté → on n'affiche pas les « mois de sécurité » (juste le total + l'appréciation).
  const coverage = months != null ? ` (≈ ${securityMonthsLabel(months)} de sécurité)` : '';
  return `${SAVE_LEVEL_LABEL[tier]} : ${savings.toLocaleString('fr-FR')} €${coverage}. \nTu peux placer ${amountPhrase(action)} ce mois-ci pour la consolider.`;
}

/**
 * État FACTUEL du matelas de sécurité, sans le montant de la reco (il est déjà sur la tuile).
 * Sert de préambule au message d'épargne du tableau de bord : c'est la seule information que la
 * description apporte et que la projection ne dit pas.
 */
function getSaveStateNote(tier: SavingsTier, data: PilotageData): string {
  const savings = Math.max(0, data.current_savings);
  const months = computeSecurityCushion({
    availableSavings: savings,
    monthlyEssentialExpenses: data.monthly_essential_expenses,
    avgMonthlyIncome: data.avg_monthly_income,
  }).months;
  const coverage = months != null ? ` (≈ ${securityMonthsLabel(months)} de sécurité)` : '';
  return `${SAVE_LEVEL_LABEL[tier]} : ${savings.toLocaleString('fr-FR')} €${coverage}`;
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
  return `Fais ce que tu veux des ${amountPhrase(action)} restants : des loisirs, un projet qui te tient à cœur, ou réinvestis-les pour accélérer tes objectifs !`;
}

function getKeepDescription(action: ActionAmount, data: PilotageData, periodEnd = false): string {
  if (periodEnd) {
    // Fin de PÉRIODE : le geste attendu n'est plus « mettre de côté au cas où » mais « ne pas cramer
    // le reste dans les derniers jours avant la paie ». On dit où va l'argent : dans le budget d'après.
    return `Ta prochaine rentrée d'argent approche. Garde ${amountPhrase(action)} sur ton compte plutôt que de les dépenser d'ici là : tu les retrouveras dans ton budget suivant.`;
  }
  if (data.current_checking_balance < data.committed_allocations * 2) {
    return `Ton solde courant est un peu juste. Garde ${amountPhrase(action)} en réserve pour couvrir les imprévus.`;
  }
  return `Conserve ${amountPhrase(action)} sur ton compte courant comme marge de manœuvre pour le mois prochain. Cette somme sera déduite de ton Relyka pour ne pas y toucher.`;
}
