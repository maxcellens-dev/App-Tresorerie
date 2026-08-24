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
  /**
   * PLAFOND de jours comptés depuis la dernière vérif (le doute sature au lieu d'exploser).
   * Sert aussi d'ancienneté présumée quand aucune date n'est connue, et de plafond à
   * l'amorçage de calibration à la 1ʳᵉ régul (useRecalibrateReliability).
   */
  coldStartDays: number;
  /** Plancher absolu de la base (évite division par ~0). */
  absoluteFloor: number;
  /* ⚠️ `upBias` (pondération de la borne HAUTE) A ÉTÉ RETIRÉ. La fourchette est désormais purement
     DESCENDANTE : son haut est le Relyka lui-même. Un réglage qui ouvrait la fourchette VERS LE HAUT
     annonçait un montant supérieur au chiffre affiché — l'inverse d'un garde-fou. Une valeur restée
     en base est simplement ignorée (cf. resolveReliabilityConfig, qui ne recopie que les clés
     connues). */
  /**
   * PLANCHER de la borne basse quand elle sert de montant ACTIONNABLE (part du montant proposé).
   * Le doute est calculé sur la BASE (revenu / enveloppe), pas sur le Relyka : dès qu'une fourchette
   * apparaît, il vaut au moins highMax × base — donc il écrase entièrement un petit Relyka et la
   * borne basse tombe à 0. Sans ce plancher, toutes les actions étaient pré-remplies à 0 €
   * (« Réserver 0 € », virement d'épargne à 0 €) alors qu'un montant était affiché.
   * 1 = plancher désactivé (le montant actionnable est toujours le montant plein).
   */
  minActionRatio: number;
  /** Pas d'arrondi des fourchettes (centaine par défaut). */
  roundStep: number;
  /**
   * AMORTISSEUR D'ACTIVITÉ : facteur appliqué au doute quand le user a saisi une transaction
   * (mois courant) AUJOURD'HUI, interpolé linéairement vers 1 jusqu'à activityWindowDays.
   * Saisir ≠ vérifier (des oublis restent possibles) mais c'est un signal de suivi actif →
   * la fourchette se resserre. 1 = désactivé. Ne permet JAMAIS de repasser en confiance haute
   * (« À jour » reste réservé à une vraie vérification).
   */
  activityDampening: number;
  /** Fenêtre (jours) au-delà de laquelle la dernière saisie manuelle n'amortit plus le doute. */
  activityWindowDays: number;
}

export const RELIABILITY_DEFAULTS: ReliabilityConfig = {
  highMax: 0.05,
  lowMin: 0.20,
  coldStartWeeklyFraction: 0.10,
  coldStartDays: 21,
  absoluteFloor: 100,
  minActionRatio: 0.4,
  roundStep: 100,
  activityDampening: 0.5,
  activityWindowDays: 7,
};

/**
 * Fusionne les réglages admin (app_config.reliability) avec les défauts.
 *
 * ⚠️ ON NE RECOPIE QUE DES NOMBRES FINIS. La colonne est un JSON libre : une clé posée à `null` en
 * SQL, une chaîne restée telle quelle, ou un `NaN` sérialisé écrasait le défaut — et le doute se
 * propageait ensuite dans toute la chaîne (`net - NaN`, `roundTo(v, NaN)`), jusqu'à afficher
 * « NaN € » à la place du chiffre le plus important de l'app. Un réglage illisible vaut mieux
 * ignoré : on garde le défaut, l'écran reste juste.
 */
export function resolveReliabilityConfig(admin?: Partial<ReliabilityConfig> | null): ReliabilityConfig {
  const out: ReliabilityConfig = { ...RELIABILITY_DEFAULTS };
  if (!admin || typeof admin !== 'object') return out;
  for (const key of Object.keys(RELIABILITY_DEFAULTS) as (keyof ReliabilityConfig)[]) {
    const v = (admin as any)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
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
  /**
   * Dernière SAISIE MANUELLE d'une transaction du mois courant (date de saisie, pas la date de la
   * transaction ; hors réguls / occurrences matérialisées / brouillons), ou null. Amortit le doute
   * (voir activityDampening) : un user qui saisit suit activement → chiffres plus fiables.
   */
  lastActivityAt?: string | null;
  /** Calibration par user, ou null (cold start). */
  calibration: DriftCalibration | null;
  /** Relyka net (resteDisponible). */
  relyka: number;
  /** Base plancher stable (ex. max(revenu mensuel moyen, enveloppe variable)). */
  floorBase: number;
  /**
   * Enveloppe de dépenses VARIABLES du mois (référence unifiée). Sert de base au COLD START : ce
   * qu'on « perd de vue » faute de saisie, ce sont les dépenses variables — pas le loyer prélevé ni
   * le salaire. Adosser la méfiance de départ au revenu entier surestimait le doute (jusqu'à 30 %
   * du revenu), au point d'écraser tout petit Relyka. 0/absent → repli sur la base globale.
   */
  variableBase?: number;
  config: ReliabilityConfig;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  doubtRatio: number;
  /** Doute exprimé en euros (largeur d'incertitude). */
  uncertaintyEur: number;
  /**
   * Jours retenus pour le CALCUL — plafonnés à `coldStartDays` (le doute sature au lieu d'exploser).
   * ⚠️ À ne pas utiliser pour PARLER de l'ancienneté : plafonné à 21 j par défaut, il fait dire
   * « vérifié il y a un moment » à quelqu'un qui n'a rien vérifié depuis huit mois. Pour une phrase,
   * c'est `rawDaysSinceVerification` (l'ancienneté réelle) qu'il faut lire.
   */
  daysSinceVerification: number;
  /**
   * Ancienneté RÉELLE de la dernière vérification, sans plafond — `null` si aucune vérification n'a
   * jamais eu lieu. Sert aux formulations affichées, jamais au calcul.
   */
  rawDaysSinceVerification: number | null;
  /**
   * Aucune vérification connue (ni régularisation, ni solde de départ d'un compte courant). À
   * distinguer de `coldStart`, vrai aussi pour un utilisateur qui vient de vérifier mais n'a pas
   * encore de calibration : afficher « Vérifié il y a un moment » à quelqu'un qui n'a JAMAIS vérifié
   * est une affirmation fausse.
   */
  neverVerified: boolean;
  /** Dérive journalière retenue (calibrée ou cold start). */
  dailyDrift: number;
  /** true si le doute repose sur le cold start (pas encore de vérif réelle). */
  coldStart: boolean;
  /** true si le doute a été amorti par une saisie manuelle récente (suivi actif). */
  activityDamped: boolean;
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
  const { today, lastVerifiedAt, lastActivityAt, calibration, relyka, floorBase, variableBase, config } = input;

  const base = Math.max(Math.abs(relyka), Math.abs(floorBase), config.absoluteFloor);

  let daysSinceVerification: number;
  let rawDaysSinceVerification: number | null = null;
  let coldStart = false;
  let neverVerified = false;
  if (lastVerifiedAt) {
    const d = new Date(lastVerifiedAt.slice(0, 10) + 'T00:00:00');
    if (Number.isNaN(d.getTime())) {
      // Date illisible : on ne peut RIEN affirmer sur l'ancienneté → même traitement qu'une absence.
      daysSinceVerification = config.coldStartDays;
      neverVerified = true;
    } else {
      rawDaysSinceVerification = daysBetween(today, d);
      // Plafonné : au-delà de coldStartDays sans vérif, le doute sature au lieu de croître sans fin.
      daysSinceVerification = Math.min(rawDaysSinceVerification, config.coldStartDays);
    }
  } else {
    daysSinceVerification = config.coldStartDays;
    coldStart = true;
    neverVerified = true;
  }

  let dailyDrift: number;
  if (calibration && calibration.sampleCount > 0 && calibration.medianDaysBetween > 0) {
    dailyDrift = calibration.medianAbsGap / calibration.medianDaysBetween;
  } else {
    // Cold start : dérive prudente proportionnelle à ce qui peut RÉELLEMENT être perdu de vue —
    // les dépenses variables du mois quand on les connaît, sinon la base globale (repli).
    const driftBase = Math.max(
      variableBase && variableBase > 0 ? Math.min(variableBase, base) : base,
      config.absoluteFloor,
    );
    dailyDrift = (driftBase * config.coldStartWeeklyFraction) / 7;
    coldStart = true;
  }

  // AMORTISSEUR D'ACTIVITÉ : saisie manuelle récente (mois courant) → le doute est réduit,
  // interpolation linéaire (saisie du jour = plein amortissement, puis retour à 1 sur la fenêtre)
  // pour éviter un effet falaise à l'expiration.
  let activityDamp = 1;
  if (lastActivityAt && config.activityDampening < 1 && config.activityWindowDays > 0) {
    const d = new Date(lastActivityAt.slice(0, 10) + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) {
      const daysSinceActivity = daysBetween(today, d);
      if (daysSinceActivity <= config.activityWindowDays) {
        const t = daysSinceActivity / config.activityWindowDays;
        activityDamp = config.activityDampening + (1 - config.activityDampening) * t;
      }
    }
  }

  // PLAFOND ABSOLU : le doute ne peut pas dépasser la base de référence (revenu / enveloppe /
  // Relyka). Au-delà, il ne mesure plus une incertitude mais une anomalie de calibration — et il
  // produisait des affichages intenables : un Relyka de 1 266 € annoncé « jusqu'à 10 300 € ».
  // Le plafond ne corrige pas la cause (cf. lib/reliabilityCalib) ; il garantit qu'aucune donnée
  // aberrante ne puisse à nouveau rendre le chiffre principal incohérent avec son propre détail.
  const rawUncertainty = Math.min(dailyDrift * daysSinceVerification, base);
  const uncertaintyEur = rawUncertainty * activityDamp;
  const doubtRatio = base > 0 ? uncertaintyEur / base : 0;
  const rawRatio = base > 0 ? rawUncertainty / base : 0;

  let level: ConfidenceLevel;
  if (doubtRatio < config.highMax) level = 'high';
  else if (doubtRatio < config.lowMin) level = 'medium';
  else level = 'low';
  // L'activité resserre la fourchette et peut faire remonter bas → moyen, mais JAMAIS → haut :
  // « À jour » (chiffres nets) reste réservé à une vraie vérification du solde.
  if (level === 'high' && activityDamp < 1 && rawRatio >= config.highMax) level = 'medium';

  return {
    level, doubtRatio, uncertaintyEur, daysSinceVerification, rawDaysSinceVerification,
    neverVerified, dailyDrift, coldStart,
    activityDamped: activityDamp < 1,
  };
}

// ── Formulations VAGUES de l'ancienneté de vérification ──────────────────────
// On n'affiche JAMAIS un compteur de jours précis (peu fiable : un compte neuf, jamais vérifié,
// démarre à `coldStartDays` → « 21 j » n'a aucun sens). On préfère un terme flou et rassurant.

/** « depuis quelques jours » / « depuis un moment »… pour « Solde non vérifié {…} ». */
export function unverifiedSincePhrase(days: number): string {
  if (!Number.isFinite(days) || days <= 4) return 'depuis quelques jours';
  if (days <= 14) return 'depuis plusieurs jours';
  if (days <= 45) return 'depuis un moment';
  return 'depuis longtemps';
}

/** « récemment » / « il y a un moment »… pour « Vérifié {…} ». */
export function verifiedAgoPhrase(days: number): string {
  if (!Number.isFinite(days) || days <= 2) return 'récemment';
  if (days <= 14) return 'il y a quelques jours';
  if (days <= 45) return 'il y a un moment';
  return 'il y a longtemps';
}

/**
 * Transforme un montant net en fourchette selon le doute courant.
 *
 * ── LA FOURCHETTE NE MONTE JAMAIS AU-DESSUS DU RELYKA ───────────────────────────────────────────
 * Une fourchette sert à PROTÉGER, pas à faire espérer. Le doute vient de ce qui n'a pas été saisi,
 * et ce qui n'est pas saisi fait presque toujours BAISSER le solde. La fourchette est donc purement
 * descendante : [net − doute ; net]. Le haut de la fourchette, c'est le Relyka lui-même — « voilà
 * ce que tu as si tout est bien à jour », et rien de plus.
 *
 * Avant, la borne haute valait `net + doute × upBias` : elle annonçait un montant SUPÉRIEUR au
 * chiffre affiché (jusqu'à plusieurs fois sa valeur quand le doute est mesuré sur un revenu bien
 * plus gros que le Relyka du moment) — exactement l'inverse du but recherché. `upBias` n'a donc plus
 * de raison d'être et a été retiré des réglages.
 *
 * Doute sous le seuil « chiffres nets » (highMax) → un seul chiffre. Cette décision repose sur le
 * RATIO de doute (pas sur le niveau ni sur l'arrondi) : quand une saisie récente réduit fortement le
 * doute, le NIVEAU peut rester « moyen » (« À jour » réservé à une vraie vérif) mais on ne veut
 * surtout pas d'une fausse fourchette « 750–750 ». Deuxième garde-fou : si le pas d'arrondi écrase
 * l'écart, un seul chiffre aussi — quel que soit l'arrondi choisi par l'admin.
 */
export function toRange(net: number, conf: ConfidenceResult, config: ReliabilityConfig): Range {
  if (conf.doubtRatio < config.highMax || conf.uncertaintyEur <= 0) {
    return { low: net, high: net, isRange: false };
  }
  /* RIEN À FOURCHER À ZÉRO. Le Relyka est planché à 0 : au-dessous, sa vraie valeur est NÉGATIVE.
     Fourcher autour de ce 0 fabriquait une borne haute à partir de rien — quelqu'un à −900 € lisait
     « minimum sûr 0 € · jusqu'à 100 € si tout est à jour » juste sous un « 0 € » rouge et un message
     de budget dépassé. Trois affirmations contradictoires sur la même ligne. À 0, on n'annonce que
     le chiffre : l'incertitude ne peut pas rendre de l'argent qui n'existe pas. */
  if (net <= 0) {
    return { low: net, high: net, isRange: false };
  }
  const step = config.roundStep > 0 ? config.roundStep : 1;
  /* DOUTE INVISIBLE À L'ÉCHELLE CHOISIE → un seul chiffre. Sous un demi-pas d'arrondi, montrer une
     fourchette reviendrait à afficher une incertitude fabriquée par l'arrondi lui-même : avec un pas
     de 100 €, un doute de 10 € donnerait « 700 € – 720 € », soit 20 € d'écart annoncé pour 10 € de
     doute réel. */
  if (conf.uncertaintyEur < step / 2) {
    return { low: net, high: net, isRange: false };
  }
  /* Borne basse : arrondie vers le BAS, jamais vers le haut. Un « minimum sûr » remonté par
     l'arrondi annoncerait une garantie qu'on n'a pas — c'est le seul sens dans lequel il ne faut
     pas se tromper sur un montant de sécurité. Et jamais négative : le Relyka est déjà planché à 0. */
  const low = Math.max(0, Math.floor((net - conf.uncertaintyEur) / step) * step);
  // Le haut de la fourchette EST le Relyka : on ne promet jamais plus que le chiffre affiché.
  const high = net;
  // Doute écrasé par l'arrondi (les deux bornes se rejoignent) → un seul chiffre.
  if (low >= high) {
    return { low: net, high: net, isRange: false };
  }
  return { low, high, isRange: true };
}

/**
 * Fourchettes des SOUS-MONTANTS (recommandations), dérivées de celle du Relyka.
 *  • `proportional` — pour l'AFFICHAGE : même proportion de doute que le Relyka
 *    (invariant : Σ des bornes basses des recos = borne basse du Relyka) ;
 *  • `actionable`   — pour les ACTIONS (virement, cumul, réservation pré-remplis) : identique, mais
 *    la borne basse ne descend jamais sous `minActionRatio × montant`. Le doute est mesuré sur la
 *    BASE (revenu / enveloppe) et non sur le Relyka : dès qu'une fourchette apparaît il vaut au
 *    moins `highMax × base`, donc il écrase entièrement un petit Relyka et la borne basse tombait à
 *    0 → toutes les actions étaient pré-remplies à 0 € sous un montant affiché non nul.
 */
export function makeSubRanges(
  relyka: number,
  relykaRange: Range,
  conf: ConfidenceResult,
  config: ReliabilityConfig,
): { proportional: (amount: number) => Range; actionable: (amount: number) => Range } {
  /* Ratio calculé sur la borne BRUTE (doute non arrondi) — pas sur relykaRange, arrondi au
     roundStep : sinon l'erreur d'arrondi du Relyka se propage ×ratio à toutes les sous-fourchettes.
     Comme celle du Relyka, une sous-fourchette est purement DESCENDANTE : son haut est le montant
     recommandé lui-même, jamais davantage. */
  const lowRatio = relyka > 0 ? Math.max(0, relyka - conf.uncertaintyEur) / relyka : 1;

  const proportional = (amount: number): Range => {
    if (!relykaRange.isRange) return { low: amount, high: amount, isRange: false };
    const low = Math.round(amount * lowRatio);
    // Bornes confondues (montant nul, ou doute négligeable devant lui) → un seul chiffre. Une
    // « fourchette » 300–300 fait afficher une légende d'incertitude qui ne recouvre rien.
    if (low >= amount) return { low: amount, high: amount, isRange: false };
    return { low, high: amount, isRange: true };
  };

  const actionable = (amount: number): Range => {
    const r = proportional(amount);
    if (!r.isRange || amount <= 0) return r;
    const floor = Math.round(amount * config.minActionRatio);
    return { ...r, low: Math.min(Math.max(r.low, floor), r.high) };
  };

  return { proportional, actionable };
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
