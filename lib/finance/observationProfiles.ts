/**
 * Profils d'OBSERVATION — fabrique les deux séries journalières que `confidenceEngine` attend
 * (`variableSpentByDay`, `activityDays`) à partir de trois réglages lisibles.
 *
 * À quoi ça sert : pour juger un cas de fiabilité (« et si l'utilisateur avait tout saisi sauf la
 * dernière semaine ? »), il faudrait sinon saisir des dizaines de transactions de test. Ici, trois
 * curseurs suffisent — et comme les écrans d'administration passent ces séries aux VRAIS moteurs,
 * l'aperçu suit automatiquement toute évolution du calcul.
 *
 * ⚠️ Ce module ne fabrique QUE des entrées de simulation. Il n'est jamais utilisé par le tableau de
 * bord réel, qui construit ces mêmes séries à partir des vraies transactions (pilotageEngine).
 */

/** Comment les dépenses saisies se répartissent dans le temps — c'est ce qui sépare les profils. */
export type SpendPattern =
  | 'even'                // un peu chaque jour (suivi régulier)
  | 'batched'             // par lots, tous les 3 jours (saisie du week-end)
  | 'early_then_silence'  // assidu au début de la période, plus rien ensuite
  | 'recent_only'         // rien pendant longtemps, puis rattrapage récent
  | 'single_day';         // tout sur une seule journée (achat exceptionnel)

export interface ObservationProfile {
  /** Part de l'enveloppe attendue réellement saisie sur la période (100 = pile l'enveloppe). */
  honoredPct: number;
  /** Répartition de ces montants dans le temps. */
  pattern: SpendPattern;
  /** Part des jours portant au moins une saisie manuelle (assiduité, 0 → 100). */
  entryDaysPct: number;
}

/** Jours moyens dans un mois — même conversion que le moteur de confiance. */
const DAYS_PER_MONTH = 30.44;

/** Clé de jour LOCALE (jamais toISOString, qui bascule d'un jour selon le fuseau). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Jours PORTEURS de dépenses, du plus récent au plus ancien, selon la répartition choisie.
 * L'ordre compte : c'est lui qui décide où tombe le silence, et donc quelle tranche du moteur
 * restera muette.
 */
function carrierIndexes(days: number, pattern: SpendPattern): number[] {
  const all = Array.from({ length: days }, (_, i) => i); // 0 = aujourd'hui
  switch (pattern) {
    case 'even':
      return all;
    case 'batched':
      return all.filter((i) => i % 3 === 0);
    case 'early_then_silence':
      // La moitié la plus ANCIENNE de la période porte tout ; les jours récents restent vides.
      return all.filter((i) => i >= Math.ceil(days / 2));
    case 'recent_only':
      return all.filter((i) => i < Math.max(1, Math.round(days / 7)));
    case 'single_day':
      return [0];
    default:
      return all;
  }
}

export interface ObservationSignals {
  variableSpentByDay: Record<string, number>;
  activityDays: string[];
}

/**
 * Construit les signaux d'observation d'un profil.
 *
 * @param today   date de référence (jour 0)
 * @param days    profondeur simulée — au moins la période douteuse, sinon les tranches les plus
 *                anciennes du moteur seront muettes et le doute restera entier
 * @param variableMonthly enveloppe variable mensuelle (0 → aucune dépense fabriquée : sans
 *                enveloppe, le moteur ne peut de toute façon rien juger sur les montants)
 */
export function buildObservationSignals(
  today: Date,
  days: number,
  variableMonthly: number,
  profile: ObservationProfile,
): ObservationSignals {
  const span = Math.max(1, Math.round(days));
  const keyOf = (i: number) =>
    dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));

  const variableSpentByDay: Record<string, number> = {};
  const carriers = carrierIndexes(span, profile.pattern);
  const total = Math.max(0, (variableMonthly / DAYS_PER_MONTH) * span * (profile.honoredPct / 100));
  if (total > 0 && carriers.length > 0) {
    const perCarrier = total / carriers.length;
    for (const i of carriers) variableSpentByDay[keyOf(i)] = perCarrier;
  }

  /* Jours de SAISIE : pris d'abord parmi les jours porteurs (on saisit là où on dépense), puis
     complétés par les autres si l'assiduité demandée dépasse le nombre de jours porteurs. Sans ce
     complément, « saisit tous les jours » serait impossible à simuler avec une répartition par lots. */
  const wanted = Math.round(span * Math.min(100, Math.max(0, profile.entryDaysPct)) / 100);
  const ordered = [...carriers, ...Array.from({ length: span }, (_, i) => i).filter((i) => !carriers.includes(i))];
  const activityDays = ordered.slice(0, wanted).map(keyOf);

  return { variableSpentByDay, activityDays };
}

/**
 * SCÉNARIOS complets — un profil de saisie ET la situation de vérification qui va avec.
 * C'est ce qu'on veut charger d'un geste dans le simulateur : « quelqu'un qui n'a jamais vérifié »
 * n'a pas la même histoire que « quelqu'un qui suit tout depuis trois semaines », et régler les deux
 * séparément à chaque essai est le meilleur moyen de tester des cas qui n'existent pas.
 */
export interface SimulationScenario {
  key: string;
  label: string;
  hint: string;
  profile: ObservationProfile;
  /** Jours depuis la dernière vérification (ignoré si `neverVerified`). */
  daysSinceVerification: number;
  neverVerified?: boolean;
  /** Dérive déjà calibrée par les vérifications passées, ou cold start. */
  calibrated?: boolean;
}

export const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    key: 'verified', label: 'Vient de vérifier', hint: 'régularisation du jour → doute quasi nul, chiffres nets',
    profile: { honoredPct: 100, pattern: 'even', entryDaysPct: 60 }, daysSinceVerification: 0,
  },
  {
    key: 'silent', label: 'Ne saisit rien', hint: 'trois semaines sans vérif ni saisie → fourchette',
    profile: { honoredPct: 0, pattern: 'even', entryDaysPct: 0 }, daysSinceVerification: 21,
  },
  {
    key: 'daily', label: 'Suit tout, chaque jour', hint: 'enveloppe honorée sans jamais toucher au solde → chiffres nets',
    profile: { honoredPct: 110, pattern: 'even', entryDaysPct: 100 }, daysSinceVerification: 21,
  },
  {
    key: 'batched', label: 'Suit tout, par lots', hint: 'même montant, saisi tous les 3 jours',
    profile: { honoredPct: 110, pattern: 'batched', entryDaysPct: 35 }, daysSinceVerification: 21,
  },
  {
    key: 'half', label: 'Moitié de l’enveloppe', hint: 'il en reste → le doute tient en partie',
    profile: { honoredPct: 50, pattern: 'even', entryDaysPct: 100 }, daysSinceVerification: 21,
  },
  {
    key: 'forgot', label: 'Assidu puis oubli', hint: 'tout saisi au début, silence depuis → doute maintenu',
    profile: { honoredPct: 140, pattern: 'early_then_silence', entryDaysPct: 45 }, daysSinceVerification: 21,
  },
  {
    key: 'big', label: 'Un seul gros achat', hint: 'un jour ne couvre pas trois semaines',
    profile: { honoredPct: 300, pattern: 'single_day', entryDaysPct: 5 }, daysSinceVerification: 21,
  },
  {
    key: 'catchup', label: 'Rattrapage récent', hint: 'rien pendant des semaines, tout saisi ces jours-ci',
    profile: { honoredPct: 110, pattern: 'recent_only', entryDaysPct: 15 }, daysSinceVerification: 21,
  },
  {
    key: 'never', label: 'Jamais vérifié', hint: 'cold start : les saisies ne rattrapent pas un point de départ inconnu',
    profile: { honoredPct: 110, pattern: 'even', entryDaysPct: 100 },
    daysSinceVerification: 21, neverVerified: true, calibrated: false,
  },
  {
    key: 'old', label: 'Vérif très ancienne', hint: 'quatre mois : le doute a saturé au plafond d’ancienneté',
    profile: { honoredPct: 0, pattern: 'even', entryDaysPct: 0 }, daysSinceVerification: 120,
  },
];

/** Cas de référence — ceux qui ont réellement fait bouger le moteur, gardés sous la main. */
export const OBSERVATION_PRESETS: { key: string; label: string; hint: string; profile: ObservationProfile }[] = [
  {
    key: 'none', label: 'Ne saisit rien', hint: 'aucune dépense, aucune saisie → doute entier',
    profile: { honoredPct: 0, pattern: 'even', entryDaysPct: 0 },
  },
  {
    key: 'daily', label: 'Suit tout, chaque jour', hint: 'enveloppe honorée et saisies quotidiennes',
    profile: { honoredPct: 110, pattern: 'even', entryDaysPct: 100 },
  },
  {
    key: 'batched', label: 'Suit tout, par lots', hint: 'même montant, saisi tous les 3 jours',
    profile: { honoredPct: 110, pattern: 'batched', entryDaysPct: 35 },
  },
  {
    key: 'half', label: 'Moitié de l’enveloppe', hint: 'il reste de l’enveloppe → le doute tient en partie',
    profile: { honoredPct: 50, pattern: 'even', entryDaysPct: 100 },
  },
  {
    key: 'forgot', label: 'Assidu puis oubli', hint: 'tout saisi au début, silence depuis → doute maintenu',
    profile: { honoredPct: 140, pattern: 'early_then_silence', entryDaysPct: 45 },
  },
  {
    key: 'big', label: 'Un seul gros achat', hint: 'un jour à lui seul ne couvre pas la période',
    profile: { honoredPct: 300, pattern: 'single_day', entryDaysPct: 5 },
  },
  {
    key: 'catchup', label: 'Rattrapage récent', hint: 'rien pendant des semaines, tout saisi ces jours-ci',
    profile: { honoredPct: 110, pattern: 'recent_only', entryDaysPct: 15 },
  },
];
