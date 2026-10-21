/**
 * Les RÈGLES du jardin : à partir de quand chaque chose apparaît. Réglables par l'admin
 * (Gamification › Jardin, stockées dans app_config.gamification.garden) ; ce fichier n'en est que
 * le repli. Fonction PURE : `mergeGardenRules` accepte n'importe quoi venant de la base et rend
 * toujours des règles valides (bornes, ordre croissant), sans jamais planter le jardin.
 *
 * « Mois » = mois de dépenses essentielles (à défaut, de revenu) — l'unité de tout le jardin, la
 * même que le matelas de sécurité et les profils financiers.
 *
 * ── LOGIQUE D'ENSEMBLE ───────────────────────────────────────────────────────────────────────────
 * La TAILLE de l'arbre suit l'étape du profil financier (P1 → P9, la même échelle que « Mon
 * parcours ») : l'arbre et le profil racontent la même histoire. Le reste du dessin garde sa propre
 * mesure, plus fine : racines = épargne de secours, fruits = placements, fleurs = plaisir,
 * cabane / ronces = crédits.
 */
import type { FinancialProfileId } from '../../types/database';

export type ClassedProfileId = Exclude<FinancialProfileId, 'P0'>;
export const CLASSED_PROFILES: ClassedProfileId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];

export interface GardenRules {
  /** Taille de l'arbre (0 → 1) pour chaque étape du profil. P0 (pas encore classé) : calculée. */
  growthByProfile: Record<ClassedProfileId, number>;
  /** Taille quand l'étape n'est pas encore connue : épargne (mois) qui donne la moitié de l'arbre… */
  growthSavingsMonths: number;
  /** …et placements (mois) qui donnent l'arbre entier. */
  branchesFullMonths: number;
  /** Les trois traits des racines (mois d'épargne de secours), croissants. Au-delà du dernier : la nappe. */
  rootsMarks: [number, number, number];
  /** Valeur placée (mois) à partir de laquelle on a 1, 2, 3, 4 puis 6 fruits (croissant, le 1ᵉʳ = 0). */
  fruitSteps: [number, number, number, number, number];
  /** Panier de récolte : petit puis grand (mois placés). */
  harvestSmallMonths: number;
  harvestBigMonths: number;
  /** Fruits dorés : plus-value d'au moins N mois… */
  goldenGainMonths: number;
  /** …ou placements doublés avec au moins N mois de plus-value. */
  goldenDoubledMinMonths: number;
  /** Part du mois « pour te faire plaisir » qui donne les 5 fleurs (%). */
  flowersFullPct: number;
  /** Crédit cher (mois) qui donne les ronces les plus denses, et densité minimale dès 1 € (%). */
  bramblesFullMonths: number;
  bramblesMinPct: number;
  /** Avancement du crédit (%) où commencent les étapes 2 à 5 de la cabane (1 = l'échelle seule). */
  cabinSteps: [number, number, number, number];
}

export const DEFAULT_GARDEN_RULES: GardenRules = {
  growthByProfile: { P1: 0.18, P2: 0.24, P3: 0.33, P4: 0.47, P5: 0.6, P6: 0.72, P7: 0.8, P8: 0.9, P9: 1 },
  growthSavingsMonths: 3,
  branchesFullMonths: 24,
  rootsMarks: [1, 3, 6],
  fruitSteps: [0, 1, 3, 6, 12],
  harvestSmallMonths: 12,
  harvestBigMonths: 36,
  goldenGainMonths: 12,
  goldenDoubledMinMonths: 3,
  flowersFullPct: 20,
  bramblesFullMonths: 3,
  bramblesMinPct: 25,
  cabinSteps: [20, 40, 60, 80],
};

const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
};
/** Liste croissante de longueur fixe ; toute liste invalide (non croissante, mauvaise longueur) → défaut. */
function ascending<T extends number[]>(v: unknown, d: T, min: number, max: number): T {
  if (!Array.isArray(v) || v.length !== d.length) return d;
  const out = v.map((x, i) => num(x, d[i], min, max));
  return out.every((x, i) => i === 0 || x > out[i - 1]) ? (out as T) : d;
}

export function mergeGardenRules(raw: unknown): GardenRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const D = DEFAULT_GARDEN_RULES;
  const g = (r.growthByProfile && typeof r.growthByProfile === 'object') ? r.growthByProfile : {};
  const growthByProfile = Object.fromEntries(CLASSED_PROFILES.map((p) => [p, num(g[p], D.growthByProfile[p], 0, 1)])) as GardenRules['growthByProfile'];
  const fruitSteps = ascending(r.fruitSteps, D.fruitSteps, 0, 600);
  const harvestSmallMonths = num(r.harvestSmallMonths, D.harvestSmallMonths, 0.5, 600);
  return {
    growthByProfile,
    growthSavingsMonths: num(r.growthSavingsMonths, D.growthSavingsMonths, 0.5, 60),
    branchesFullMonths: num(r.branchesFullMonths, D.branchesFullMonths, 1, 600),
    rootsMarks: ascending(r.rootsMarks, D.rootsMarks, 0.5, 60),
    fruitSteps: fruitSteps[0] === 0 ? fruitSteps : D.fruitSteps,
    harvestSmallMonths,
    harvestBigMonths: Math.max(harvestSmallMonths + 0.5, num(r.harvestBigMonths, D.harvestBigMonths, 1, 1200)),
    goldenGainMonths: num(r.goldenGainMonths, D.goldenGainMonths, 0.5, 1200),
    goldenDoubledMinMonths: num(r.goldenDoubledMinMonths, D.goldenDoubledMinMonths, 0, 1200),
    flowersFullPct: num(r.flowersFullPct, D.flowersFullPct, 1, 100),
    bramblesFullMonths: num(r.bramblesFullMonths, D.bramblesFullMonths, 0.5, 60),
    bramblesMinPct: num(r.bramblesMinPct, D.bramblesMinPct, 0, 100),
    cabinSteps: ascending(r.cabinSteps, D.cabinSteps, 1, 99),
  };
}
