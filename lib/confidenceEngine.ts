// Moteur de CONFIANCE — une seule source de vérité pour le « doute » du jour.
//
// Consommé À L'IDENTIQUE par le Relyka, les recommandations et le cône de projection (contrainte :
// une seule fonction de calcul). Ne lit que des données déjà calculées ailleurs.
//
// Principe : plus la dernière VÉRIFICATION est ancienne et plus le user DÉRIVE vite (écarts trouvés
// aux vérifications passées), plus les chiffres sont incertains → on l'affiche en fourchette.
//   • Une « vérification » = une régularisation (même écart 0), une clôture confirmée, ou une
//     confirmation explicite « je suis à jour ».
//   • dérive_journalière (calibrée PAR USER) = médiane(|écarts|) / médiane(jours entre vérifs).
//   • doute_du_jour (€) = dérive_journalière × jours_depuis_dernière_vérif.
//   • doute_ratio = doute_du_jour / base, où base = max(Relyka, plancher) pour rester stable même
//     quand le Relyka est proche de 0.

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ReliabilityConfig {
  /** doute_ratio < highMax → confiance haute (chiffres nets). */
  highMax: number;
  /** doute_ratio < lowMin → confiance moyenne ; au-delà → basse. */
  lowMin: number;
  /** Cold start (aucune vérif passée) : dérive = base × coldStartWeeklyFraction / 7 par jour. */
  coldStartWeeklyFraction: number;
  /** Jours de doute présumés au cold start (pas de date de vérif connue). */
  coldStartDays: number;
  /** Plancher absolu de la base (évite division par ~0). */
  absoluteFloor: number;
  /** Pondération de la borne HAUTE d'une fourchette (le non-saisi tire surtout vers le bas). */
  upBias: number;
  /** Pas d'arrondi des fourchettes (centaine par défaut). */
  roundStep: number;
}

export const RELIABILITY_DEFAULTS: ReliabilityConfig = {
  highMax: 0.05,
  lowMin: 0.20,
  coldStartWeeklyFraction: 0.10,
  coldStartDays: 21,
  absoluteFloor: 100,
  upBias: 0.3,
  roundStep: 100,
};

/** Fusionne les réglages admin (app_config.reliability) avec les défauts. */
export function resolveReliabilityConfig(admin?: Partial<ReliabilityConfig> | null): ReliabilityConfig {
  return { ...RELIABILITY_DEFAULTS, ...(admin ?? {}) };
}

/** Calibration de dérive, persistée sur profiles.reliability_calib. */
export interface DriftCalibration {
  medianAbsGap: number;      // médiane des |écarts| trouvés aux vérifications (mois fiables)
  medianDaysBetween: number; // médiane des jours entre deux vérifications
  sampleCount: number;
}

export interface ConfidenceInput {
  /** Date du jour (locale). */
  today: Date;
  /** Dernière vérification (régul / clôture confirmée / « à jour »), ou null si aucune. */
  lastVerifiedAt: string | null;
  /** Calibration par user, ou null (cold start). */
  calibration: DriftCalibration | null;
  /** Relyka net (resteDisponible). */
  relyka: number;
  /** Base plancher stable (ex. max(revenu mensuel moyen, enveloppe variable)). */
  floorBase: number;
  config: ReliabilityConfig;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  doubtRatio: number;
  /** Doute exprimé en euros (largeur d'incertitude). */
  uncertaintyEur: number;
  daysSinceVerification: number;
  /** Dérive journalière retenue (calibrée ou cold start). */
  dailyDrift: number;
  /** true si le doute repose sur le cold start (pas encore de vérif réelle). */
  coldStart: boolean;
}

export interface Range {
  low: number;
  high: number;
  isRange: boolean;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function roundTo(v: number, step: number): number {
  if (step <= 0) return Math.round(v);
  return Math.round(v / step) * step;
}

/** Calcule le niveau de confiance et le doute du jour. */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { today, lastVerifiedAt, calibration, relyka, floorBase, config } = input;

  const base = Math.max(Math.abs(relyka), Math.abs(floorBase), config.absoluteFloor);

  let daysSinceVerification: number;
  let coldStart = false;
  if (lastVerifiedAt) {
    const d = new Date(lastVerifiedAt.slice(0, 10) + 'T00:00:00');
    daysSinceVerification = Number.isNaN(d.getTime()) ? config.coldStartDays : daysBetween(today, d);
  } else {
    daysSinceVerification = config.coldStartDays;
    coldStart = true;
  }

  let dailyDrift: number;
  if (calibration && calibration.sampleCount > 0 && calibration.medianDaysBetween > 0) {
    dailyDrift = calibration.medianAbsGap / calibration.medianDaysBetween;
  } else {
    // Cold start : dérive prudente proportionnelle à la base.
    dailyDrift = (base * config.coldStartWeeklyFraction) / 7;
    coldStart = true;
  }

  const uncertaintyEur = dailyDrift * daysSinceVerification;
  const doubtRatio = base > 0 ? uncertaintyEur / base : 0;

  let level: ConfidenceLevel;
  if (doubtRatio < config.highMax) level = 'high';
  else if (doubtRatio < config.lowMin) level = 'medium';
  else level = 'low';

  return { level, doubtRatio, uncertaintyEur, daysSinceVerification, dailyDrift, coldStart };
}

/**
 * Transforme un montant net en fourchette selon le doute courant.
 * Confiance haute → pas de fourchette. Sinon [net − doute ; net + doute×upBias], arrondi.
 * Le non-saisi tire surtout le Relyka vers le BAS → borne basse pleine, borne haute atténuée.
 */
export function toRange(net: number, conf: ConfidenceResult, config: ReliabilityConfig): Range {
  if (conf.level === 'high' || conf.uncertaintyEur <= 0) {
    return { low: net, high: net, isRange: false };
  }
  const low = roundTo(net - conf.uncertaintyEur, config.roundStep);
  const high = roundTo(net + conf.uncertaintyEur * config.upBias, config.roundStep);
  return { low: Math.min(low, high), high: Math.max(low, high), isRange: true };
}

/** Médiane d'une liste de nombres (0 si vide). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Calibration de la dérive à partir des vérifications passées (mois fiables uniquement).
 * `samples` = pour chaque vérification : |écart trouvé| et nb de jours depuis la précédente.
 */
export function computeCalibration(
  samples: Array<{ absGap: number; daysBetween: number }>,
): DriftCalibration {
  const valid = samples.filter((s) => s.daysBetween > 0);
  return {
    medianAbsGap: median(valid.map((s) => s.absGap)),
    medianDaysBetween: median(valid.map((s) => s.daysBetween)),
    sampleCount: valid.length,
  };
}
