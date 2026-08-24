/**
 * LA PRIORITÉ FINANCIÈRE DU MOIS — ce qui prime sur le profil.
 * ────────────────────────────────────────────────────────────
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────────────────────────
 * La répartition du Relyka découlait MÉCANIQUEMENT du profil : « tu es P3, donc 45/5/15/35 », quelle
 * que soit la situation du mois. Deux personnes au même palier recevaient donc le même conseil alors
 * que l'une finissait le mois à découvert et l'autre avec 800 € d'avance. Et un palier ne bouge que
 * lentement (c'est sa raison d'être) : il ne pouvait pas réagir à un mois qui dérape.
 *
 * ── LE PRINCIPE : DEUX NIVEAUX ──────────────────────────────────────────────────────────────────
 *   • le PROFIL (P0–P9) = le contexte financier général. Il donne l'orientation de fond, et il
 *     bouge lentement, ce qui est exactement ce qu'on attend d'un cadre.
 *   • la PRIORITÉ = la décision du mois. Elle regarde la situation réelle — surplus, réserve,
 *     découvert, dettes, épargne, placements, projets proches, stabilité du revenu — et elle
 *     DOMINE le profil quand quelque chose de plus urgent est en jeu.
 *
 * La question à laquelle répond la recommandation devient :
 *     « Compte tenu de ta situation actuelle, voici comment utiliser ton surplus ce mois-ci »
 * et non plus :
 *     « Tu es P3, donc applique 45/5/15/35. »
 *
 * ── L'ORDRE DES PRIORITÉS EST NON NÉGOCIABLE ────────────────────────────────────────────────────
 * Elles sont évaluées de la plus impérieuse à la plus confortable, et la PREMIÈRE qui s'applique
 * gagne. Cet ordre traduit une hiérarchie de bon sens : on ne place pas d'argent quand on est à
 * découvert, on ne construit pas un portefeuille quand on n'a pas trois mois devant soi.
 *
 *   1. STABILISER   — les dépenses dépassent les revenus. Rien d'autre ne compte.
 *   2. DÉSENDETTER  — découvert chronique ou dette coûteuse : chaque euro remboursé rapporte
 *                     davantage, et plus sûrement, que n'importe quel placement.
 *   3. URGENCE      — moins d'1 mois de réserve : investissement à 0 %, sans exception.
 *   4. CONSTRUIRE   — 1 à 3 mois : l'épargne prime, l'investissement reste symbolique (≤ 5 %).
 *   5. FINANCER     — un projet à moins d'un an à couvrir : il passe avant le long terme.
 *   6. ÉQUILIBRER   — 3 à 6 mois : épargne et investissement à parts comparables.
 *   7. INVESTIR     — au-delà de 6 mois : le liquide qui dort coûte, l'investissement prend la main.
 *   8. OPTIMISER    — patrimoine constitué : diversification, l'épargne de précaution est pleine.
 *
 * ── CE QUE LA PRIORITÉ FAIT AUX POURCENTAGES ────────────────────────────────────────────────────
 * Elle ne les remplace pas systématiquement. Elle pose des BORNES (« investissement ≤ 5 % »,
 * « épargne ≥ 40 % ») appliquées à la répartition du profil, puis on renormalise. Le profil garde
 * donc son influence — c'est lui qui fait la différence entre deux personnes en même priorité —
 * mais il ne peut plus conduire à un conseil déraisonnable au vu des faits.
 */

import type { FinancialProfileId } from '../../types/database';
import { PROFILE_ALLOCATIONS } from './financialProfileEngine';
import { CURRENCY_SYMBOL } from './currency';

/** Montant arrondi dans la devise de référence (jamais un « € » en dur — cf. lib/finance/currency). */
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

export type RecoKey = 'save' | 'invest' | 'enjoy' | 'keep';
export type Allocation = Record<RecoKey, number>;

export type PriorityId =
  | 'stabilize'   // revenus < dépenses
  | 'debt'        // découvert chronique / dette coûteuse
  | 'emergency'   // réserve < 1 mois
  | 'build'       // réserve 1–3 mois
  | 'fund_project'// projet court terme à financer
  | 'balanced'    // réserve 3–6 mois
  | 'invest'      // réserve > 6 mois
  | 'optimize';   // patrimoine constitué

export interface SituationInputs {
  /** Mois de réserve (épargne ÷ dépenses essentielles). `null` = pas encore mesurable. */
  monthsOfReserve: number | null;
  /** Surplus réellement disponible ce mois-ci (le Relyka). Peut être négatif. */
  monthlySurplus: number;
  /** Revenu mensuel de référence. */
  avgMonthlyIncome: number;
  /** Dépenses essentielles mensuelles (charges récurrentes + enveloppe variable). */
  monthlyEssentialExpenses: number;
  /** Solde des comptes courants aujourd'hui (négatif = découvert). */
  checkingBalance: number;
  /** Mois consécutifs terminés dans le rouge (0 = aucun). ≥ 2 → découvert CHRONIQUE. */
  consecutiveOverdraftMonths?: number;
  /** Capital restant dû des crédits COÛTEUX (conso, revolving) — hors immobilier. */
  costlyDebt?: number;
  /** Épargne disponible. */
  savingsBalance: number;
  /** Total réellement placé. */
  investedBalance: number;
  /** Ce qu'il reste à financer sur les projets à moins d'un an. */
  shortTermProjectsNeed?: number;
  /** Revenus irréguliers (freelance, dividendes) → on exige une réserve plus épaisse. */
  irregularIncome?: boolean;
}

export interface PriorityResult {
  id: PriorityId;
  /** Titre court, affichable tel quel. */
  label: string;
  /** LE pourquoi, en une phrase, avec le fait qui l'a déclenchée. */
  reason: string;
  /** Bornes imposées à la répartition. Absentes = pas de contrainte sur ce poste. */
  bounds: Partial<Record<RecoKey, { min?: number; max?: number }>>;
}

/**
 * Réserve VISÉE, en mois. Trois mois pour un revenu régulier ; six quand il ne l'est pas — un
 * freelance qui encaisse en dents de scie n'a pas la même exposition qu'un salarié.
 */
export function targetReserveMonths(irregularIncome?: boolean): number {
  return irregularIncome ? 6 : 3;
}

/** Le mois est-il structurellement déficitaire ? (dépenses essentielles au-dessus du revenu) */
function isStructuralDeficit(i: SituationInputs): boolean {
  return i.avgMonthlyIncome > 0
    && i.monthlyEssentialExpenses > 0
    && i.monthlyEssentialExpenses > i.avgMonthlyIncome * 1.02; // 2 % de tolérance : bruit de mesure
}

export function computeFinancialPriority(i: SituationInputs): PriorityResult {
  const months = i.monthsOfReserve;
  const overdraftMonths = i.consecutiveOverdraftMonths ?? 0;
  const costlyDebt = Math.max(0, i.costlyDebt ?? 0);
  const projectNeed = Math.max(0, i.shortTermProjectsNeed ?? 0);
  const wealth = Math.max(0, i.savingsBalance) + Math.max(0, i.investedBalance);

  // 1. STABILISER — ce qui sort dépasse ce qui rentre. Aucun conseil d'allocation n'a de sens
  //    tant que l'équation de base n'est pas rétablie.
  if (isStructuralDeficit(i)) {
    return {
      id: 'stabilize',
      label: 'Rééquilibrer ton mois',
      reason: `Tes charges (${eur(i.monthlyEssentialExpenses)}) dépassent tes revenus (${eur(i.avgMonthlyIncome)}) : tant que c'est le cas, tout le reste attend.`,
      bounds: { invest: { max: 0 }, enjoy: { max: 5 }, keep: { min: 45 } },
    };
  }

  // 2. DÉSENDETTER — un découvert coûte plus cher, et plus sûrement, que ce que rapporte un
  //    placement. Rembourser EST le meilleur rendement disponible.
  if (overdraftMonths >= 2 || (i.checkingBalance < 0 && overdraftMonths >= 1) || costlyDebt > 0) {
    const why = costlyDebt > 0
      ? `Il te reste ${eur(costlyDebt)} de crédit coûteux : rembourser rapporte plus, et sans risque, que n'importe quel placement.`
      : `Ton compte finit dans le rouge depuis ${overdraftMonths} mois : sortir du découvert passe avant tout le reste.`;
    return {
      id: 'debt',
      label: 'Sortir du rouge',
      reason: why,
      bounds: { invest: { max: 0 }, enjoy: { max: 10 }, keep: { min: 35 } },
    };
  }

  // 3. URGENCE — moins d'un mois devant soi. L'investissement est bloqué à zéro, sans exception :
  //    le premier imprévu obligerait à vendre au pire moment.
  if (months != null && months < 1) {
    return {
      id: 'emergency',
      label: 'Te constituer un filet',
      reason: 'Tu as moins d’un mois de dépenses de côté : le moindre imprévu ferait basculer ton mois. Un premier mois de réserve change tout.',
      bounds: { invest: { max: 0 }, save: { min: 50 }, enjoy: { max: 12 } },
    };
  }

  // 4. CONSTRUIRE — 1 à 3 mois. L'épargne prime, l'investissement reste symbolique : le geste
  //    compte (on prend l'habitude), le montant non.
  if (months != null && months < 3) {
    return {
      id: 'build',
      label: 'Renforcer ta réserve',
      reason: `Tu as ${months.toFixed(1).replace('.', ',')} mois de dépenses de côté. L’objectif du moment est d’atteindre trois mois — après, l’investissement aura du sens.`,
      bounds: { invest: { max: 5 }, save: { min: 40 } },
    };
  }

  /* 5. FINANCER UN PROJET PROCHE — un besoin à moins d'un an se prépare en épargne, pas en
        placement : on ne met pas en Bourse de l'argent dont on a besoin dans huit mois. Passe
        APRÈS la réserve (on ne finance pas un projet sans filet) mais AVANT l'investissement. */
  if (projectNeed > 0 && months != null && months >= 3 && projectNeed > i.monthlySurplus * 3) {
    return {
      id: 'fund_project',
      label: 'Financer ton projet',
      reason: `Il te reste ${eur(projectNeed)} à réunir sur un projet proche : cet argent-là se prépare en épargne, pas en placement.`,
      bounds: { invest: { max: 15 }, save: { min: 35 } },
    };
  }

  // 6. ÉQUILIBRER — 3 à 6 mois : la réserve fait son travail, on peut commencer à faire travailler
  //    ce qui dépasse, sans se découvrir.
  if (months != null && months < 6) {
    return {
      id: 'balanced',
      label: 'Équilibrer épargne et placements',
      reason: `Avec ${months.toFixed(1).replace('.', ',')} mois de réserve, tu es à l’abri d’un imprévu. Ce qui dépasse peut commencer à travailler.`,
      bounds: { invest: { min: 15, max: 40 } },
    };
  }

  /* 8. OPTIMISER — patrimoine déjà constitué ET réserve pleine : l'épargne de précaution n'a plus
        rien à absorber, le liquide immobilisé a un coût réel. Volontairement exigeant sur les DEUX
        critères : un gros capital sans réserve n'est pas une situation confortable. */
  if (months != null && months >= 6 && wealth >= 100_000 && i.investedBalance > 0) {
    return {
      id: 'optimize',
      label: 'Faire travailler ton patrimoine',
      reason: 'Ta réserve est pleine et ton patrimoine constitué : l’enjeu n’est plus d’accumuler, mais de diversifier et de limiter ce qui dort.',
      bounds: { save: { max: 10 }, invest: { min: 45 } },
    };
  }

  // 7. INVESTIR — plus de 6 mois de réserve. Continuer à empiler du liquide ne rapporte plus rien.
  if (months != null && months >= 6) {
    return {
      id: 'invest',
      label: 'Faire travailler ton épargne',
      reason: 'Tu as plus de six mois de dépenses de côté : au-delà, le liquide ne te rapporte plus rien. C’est le moment de placer.',
      bounds: { save: { max: 20 }, invest: { min: 30 } },
    };
  }

  /* Réserve non mesurable (compte neuf) : aucune priorité ne s'impose, et surtout on n'en INVENTE
     pas une. Le profil décide seul, et il vaut P0 « Découverte » dans ce cas — donc prudent. */
  return {
    id: 'balanced',
    label: 'Prendre tes repères',
    reason: 'On n’a pas encore assez de données pour trancher : renseigne tes charges et tes revenus, la recommandation s’affinera toute seule.',
    bounds: {},
  };
}

/** Somme d'une répartition (doit valoir 100 après normalisation). */
function total(a: Allocation): number {
  return a.save + a.invest + a.enjoy + a.keep;
}

/**
 * Applique les bornes d'une priorité à une répartition, puis renormalise à 100 %.
 *
 * Le point délicat est la renormalisation : ramener naïvement le total à 100 pourrait faire
 * REPASSER un poste au-delà de sa borne (baisser l'investissement puis tout remonter au prorata le
 * ferait remonter avec le reste). On procède donc en deux temps : on FIGE les postes contraints,
 * et on redistribue l'écart sur les seuls postes libres. Si tout est contraint, on répartit l'écart
 * sur « Conserver », qui est le poste neutre par nature — garder n'engage à rien.
 */
export function applyPriorityBounds(base: Allocation, p: PriorityResult): Allocation {
  const out: Allocation = { ...base };
  const locked = new Set<RecoKey>();

  for (const key of ['save', 'invest', 'enjoy', 'keep'] as RecoKey[]) {
    const b = p.bounds[key];
    if (!b) continue;
    if (b.max != null && out[key] > b.max) { out[key] = b.max; locked.add(key); }
    if (b.min != null && out[key] < b.min) { out[key] = b.min; locked.add(key); }
  }
  if (locked.size === 0) return out;

  const free = (['save', 'invest', 'enjoy', 'keep'] as RecoKey[]).filter((k) => !locked.has(k));
  let gap = 100 - total(out);
  if (Math.abs(gap) < 0.001) return out;

  if (free.length === 0) {
    out.keep = Math.max(0, out.keep + gap);
    return normalize(out);
  }

  // Répartition au prorata des poids libres (à poids nuls, on répartit également).
  const freeTotal = free.reduce((s, k) => s + out[k], 0);
  for (const k of free) {
    const weight = freeTotal > 0 ? out[k] / freeTotal : 1 / free.length;
    out[k] = Math.max(0, out[k] + gap * weight);
  }
  return normalize(out);
}

/** Ramène une répartition à exactement 100 %, l'arrondi tombant sur « Conserver ». */
export function normalize(a: Allocation): Allocation {
  const t = total(a);
  if (t <= 0) return { save: 0, invest: 0, enjoy: 0, keep: 100 };
  const scaled: Allocation = {
    save: Math.round((a.save / t) * 100),
    invest: Math.round((a.invest / t) * 100),
    enjoy: Math.round((a.enjoy / t) * 100),
    keep: 0,
  };
  scaled.keep = 100 - scaled.save - scaled.invest - scaled.enjoy;
  if (scaled.keep < 0) { scaled.save = Math.max(0, scaled.save + scaled.keep); scaled.keep = 0; }
  return scaled;
}

/**
 * LA RÉPARTITION DU MOIS : profil (contexte) + priorité (situation).
 *
 * C'est le point d'entrée unique du nouveau système. Le profil pose la couleur de fond — c'est lui
 * qui distingue deux personnes en même priorité — et la priorité pose les limites que les faits
 * imposent. Ni l'un ni l'autre ne décide seul.
 *
 * `baseOverride` est la RÉPARTITION MANUELLE (cf. lib/finance/recoMode) : l'utilisateur qui règle
 * lui-même ses pourcentages se donne un profil sur mesure, et rien d'autre ne change — la priorité
 * du mois borne SA répartition exactement comme elle bornerait celle d'un palier. Un mode manuel
 * qui court-circuiterait aussi les bornes recommanderait d'investir à quelqu'un qui finit ses mois
 * dans le rouge : ce ne serait plus un réglage, ce serait une panne.
 */
export function resolveMonthlyAllocation(
  profileId: FinancialProfileId,
  situation: SituationInputs,
  baseOverride?: Allocation | null,
): { alloc: Allocation; priority: PriorityResult } {
  const priority = computeFinancialPriority(situation);
  const base = baseOverride ?? PROFILE_ALLOCATIONS[profileId] ?? PROFILE_ALLOCATIONS.P0;
  return { alloc: applyPriorityBounds({ ...base }, priority), priority };
}
