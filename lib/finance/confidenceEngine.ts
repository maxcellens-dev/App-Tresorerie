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
//
// ── LE DOUTE MESURE CE QUI PEUT ENCORE ÉCHAPPER, PAS L'HORLOGE ──────────────────────────────────
// Ce calcul, seul, ne dépendait QUE du temps écoulé : rien n'y bougeait quand l'utilisateur saisissait
// ses dépenses. Le 28 du mois, quelqu'un ayant tout noté portait le même doute que le 8 — et l'écran
// lui répétait « saisis tes dépenses pour actualiser », un geste que le moteur ne pouvait pas
// entendre. Deux mesures corrigent ça, en amont du calcul du niveau :
//
//   A. L'ENVELOPPE HONORÉE EFFACE LE DOUTE — le doute est réduit par le TAUX D'HONORATION de
//      l'enveloppe variable : `min(1, variable saisi ÷ variable attendu)`. Il reste de l'enveloppe →
//      des dépenses attendues manquent peut-être à l'appel, le doute tient ; elle est consommée →
//      tout ce qui était prévu est là, le doute tombe. Le taux est mesuré PAR TRANCHES et c'est la
//      plus faible qui compte : sinon un seul gros jour, ou dix jours assidus suivis de quinze de
//      silence, suffisaient à effacer tout le doute. Dans chaque tranche, l'assiduité de saisie vaut
//      preuve au même titre que les montants — sans quoi un budget SUR-estimé maintiendrait en
//      « estimation » quelqu'un qui note pourtant tout. Ne rien noter laisse le calcul strictement
//      identique à celui d'avant. Ne s'applique jamais sans une vérification passée
//      (`neverVerified`) : un point de départ jamais constaté ne se rattrape pas à coups de saisies.
//      ⚠️ À ne pas confondre avec l'enveloppe RESTANTE du Relyka (pilotageEngine), volontairement
//      NON proratisée sur les jours écoulés. Les deux usages sont opposés et tous deux prudents :
//      le Relyka refuse de promettre un argent peut-être déjà dépensé ; le doute, lui, cherche
//      justement ce qui manque à l'appel — et le prorata est la seule façon de le chiffrer.
//
//   B. COUVERTURE DE SAISIE — l'amortisseur d'activité ne récompense plus la RÉCENCE (« as-tu
//      saisi aujourd'hui ? », qu'une seule dépense suffisait à satisfaire) mais l'ASSIDUITÉ : la
//      part des jours de la fenêtre portant au moins une saisie. Une couverture forte lève le verrou
//      qui interdisait la confiance haute — non par indulgence, mais parce que la vérification sert
//      à retrouver ce qui n'a pas été saisi : quand tout l'a été, il n'y a rien à retrouver.

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
   * AMORTISSEUR D'ACTIVITÉ : facteur appliqué au doute à COUVERTURE PLEINE (une saisie chaque jour
   * de la fenêtre). Entre 0 et 1 : le facteur réel est interpolé depuis 1 selon la couverture
   * (`1 − (1 − activityDampening) × couverture`). 1 = désactivé.
   *
   * ⚠️ Il récompensait auparavant la seule RÉCENCE : une dépense saisie aujourd'hui valait le même
   * demi-doute que trente jours de suivi quotidien, et six jours de silence derrière n'y changeaient
   * rien. Un tap isolé ne prouve pas qu'on suit ses dépenses — l'assiduité, si.
   */
  activityDampening: number;
  /** Fenêtre (jours) sur laquelle la couverture de saisie est mesurée. */
  activityWindowDays: number;
  /**
   * Couverture (part des jours de la fenêtre portant une saisie) à partir de laquelle l'assiduité
   * donne DROIT à la confiance haute. En dessous, le verrou historique s'applique : un doute
   * seulement amorti ne fait pas passer « À jour ». Jamais appliqué sans vérification passée.
   * 1 = verrou permanent (comportement d'avant la couverture).
   */
  activityHighCoverage: number;
}

/**
 * Fenêtre (jours) sur laquelle les signaux JOURNALIERS d'observation sont fournis au moteur
 * (`activityDays`, `variableSpentByDay`). Constante PARTAGÉE avec pilotageEngine, qui les produit :
 * au-delà, le moteur n'a plus rien à opposer au doute et le laisse entier (cf. `unobservedCap`).
 * Choisie plus large que `coldStartDays` (21) pour couvrir la période douteuse dans tous les cas
 * courants, sans faire porter au tableau de bord une série inutilement longue.
 */
export const OBSERVATION_WINDOW_DAYS = 30;

/** Jours moyens dans un mois — convertit l'enveloppe mensuelle en rythme journalier. */
const DAYS_PER_MONTH = 30.44;

/**
 * Part maximale du doute qu'une tranche peut voir effacée par la SEULE assiduité de saisie, sans
 * que les montants attendus soient au rendez-vous. Saisir chaque jour prouve qu'on suit ; ça ne
 * prouve pas qu'on a tout saisi — l'assiduité complète donc les montants, elle ne les remplace pas.
 * (L'assiduité agit par ailleurs sur le doute entier via `activityDampening` et le verrou « À jour ».)
 */
const ACTIVITY_ONLY_MAX_RATE = 0.5;

/**
 * Jours sans LA MOINDRE saisie au-delà desquels on considère le suivi interrompu.
 *
 * ── UNE SEULE RÈGLE, ET ELLE S'EXPLIQUE EN UNE PHRASE ───────────────────────────────────────────
 * Ce drapeau décidait auparavant sur deux signaux du CALCUL : la couverture d'assiduité (≥ 50 % des
 * sept derniers jours portant une saisie) OU le taux d'honoration de l'enveloppe (≥ 50 % sur la
 * tranche la plus faible). Les deux sont bons pour mesurer un doute ; ils sont mauvais pour choisir
 * une phrase, et ils se trompaient dans le sens le plus vexant :
 *
 *   • saisir en trois fois par semaine donne une couverture de 3/7 = 43 % → « suivi interrompu »,
 *     alors qu'on a noté quelque chose la veille ;
 *   • une seule semaine calme (peu de dépenses, donc peu à saisir) écrase le taux d'honoration à
 *     zéro, puisqu'il retient la tranche la PLUS FAIBLE de la période.
 *
 * Résultat : l'app réclamait des saisies à quelqu'un qui venait d'en faire. Pour choisir ce qu'on
 * DIT, la seule question honnête est « a-t-on eu de tes nouvelles récemment ? ». Une date, un seuil.
 *
 * ⚠️ Ne change AUCUN montant ni aucun niveau de confiance — la couverture et le taux d'honoration
 * continuent, eux, de gouverner le doute (cf. `activityDampening` et `observedRelief`).
 */
const QUIET_ENTRY_DAYS = 4;

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
  activityHighCoverage: 0.8,
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
   * Jours (ISO local) des `OBSERVATION_WINDOW_DAYS` derniers portant AU MOINS une SAISIE MANUELLE
   * (date de saisie, pas date de la transaction ; hors réguls / occurrences matérialisées /
   * modèles récurrents / brouillons). Mesure l'ASSIDUITÉ (cf. activityDampening).
   *
   * C'est une LISTE DE JOURS et non une simple date : la couverture se mesure sur une fenêtre que
   * seul le moteur connaît (elle dépend des réglages admin). Lui donner les jours bruts évite de
   * proratiser un agrégat calculé sur une autre fenêtre — approximation qui aurait faussé
   * précisément le cas qu'on cherche à traiter, celui du user assidu.
   */
  activityDays?: string[];
  /**
   * Dépenses VARIABLES constatées par jour (ISO local) sur les `OBSERVATION_WINDOW_DAYS` derniers,
   * en net (un remboursement vient en déduction). Alimente le plafond d'observation : ce qui a été
   * saisi ne peut plus être « ce qui a échappé ». Même définition de « variable » que l'enveloppe
   * (pilotageEngine) — sans quoi on comparerait deux périmètres différents.
   */
  variableSpentByDay?: Record<string, number>;
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
  /** true si le doute a été amorti par l'assiduité de saisie (cf. activityCoverage). */
  activityDamped: boolean;
  /** Part des jours de la fenêtre portant au moins une saisie manuelle (0 → 1). */
  activityCoverage: number;
  /**
   * Jours depuis la DERNIÈRE saisie manuelle (0 = aujourd'hui). `null` = aucune sur la fenêtre
   * d'observation, ou signaux absents.
   *
   * ⚠️ N'entre dans aucun calcul — le doute se mesure sur l'ancienneté de la VÉRIFICATION. Cette
   * valeur-ci existe pour ce qu'on DIT : parler à l'utilisateur d'un solde « non vérifié » le
   * renvoie vers son appli bancaire, alors que noter une dépense — le geste le plus simple de
   * l'app — resserre déjà la fourchette (cf. `activityDampening` et le taux d'honoration). Les
   * messages doivent donc pouvoir dater les SAISIES, pas seulement les vérifications.
   */
  daysSinceLastEntry: number | null;
  /**
   * Doute EFFACÉ (€) par les dépenses variables réellement saisies sur la période. `null` quand la
   * mesure ne s'applique pas (jamais vérifié, enveloppe inconnue, signaux journaliers absents).
   * Exposé pour l'aperçu admin et les tests : c'est LUI qui explique qu'un user à jour de ses
   * saisies retrouve des chiffres nets en fin de mois.
   */
  observedRelief: number | null;
  /**
   * Taux d'honoration retenu (0 → 1) : la tranche la plus faible de la période, celle qui décide de
   * `observedRelief`. `null` quand la mesure ne s'applique pas. Exposé parce qu'un montant en euros
   * ne dit pas à lui seul si l'enveloppe a été honorée — c'est ce taux qui le dit.
   */
  observedRate: number | null;
  /**
   * A-t-on eu des nouvelles récemment ? Une saisie dans les `QUIET_ENTRY_DAYS` derniers jours.
   *
   * ⚠️ N'ENTRE DANS AUCUN CALCUL — ni montant, ni niveau, ni bornes affichées. Ce drapeau ne sert
   * qu'à choisir CE QU'ON DIT : réclamer des saisies a du sens quand plus rien n'arrive, aucun
   * quand il y en a eu une hier. Dans ce second cas le doute reste entier — mais il s'explique, il
   * ne se reproche pas.
   */
  entriesKeptUp: boolean;
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

/** Clé de jour LOCALE (jamais toISOString, qui bascule d'un jour selon le fuseau). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Les `days` derniers jours (aujourd'hui inclus), du plus récent au plus ancien. */
function lastDayKeys(today: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

function roundTo(v: number, step: number): number {
  if (step <= 0) return Math.round(v);
  return Math.round(v / step) * step;
}

/** Calcule le niveau de confiance et le doute du jour. */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const {
    today, lastVerifiedAt, activityDays, variableSpentByDay,
    calibration, relyka, floorBase, variableBase, config,
  } = input;

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

  /* ── B. COUVERTURE DE SAISIE ────────────────────────────────────────────────────────────────────
     Part des jours de la fenêtre portant au moins une saisie manuelle. La fenêtre ne remonte jamais
     au-delà de la dernière vérification : compter des jours antérieurs diluerait la couverture de
     quelqu'un qui vient de vérifier puis de saisir — il serait puni d'avoir vérifié. */
  const covWindow = Math.max(
    1,
    Math.min(config.activityWindowDays, daysSinceVerification || config.activityWindowDays),
  );
  let activityCoverage = 0;
  if (activityDays && activityDays.length > 0 && config.activityWindowDays > 0) {
    const seen = new Set(activityDays);
    const covered = lastDayKeys(today, covWindow).filter((k) => seen.has(k)).length;
    activityCoverage = Math.min(1, covered / covWindow);
  }
  /* Depuis quand rien n'a été noté ? Cherché sur toute la fenêtre d'observation (et non sur celle,
     plus courte, de l'assiduité) : c'est une DATE pour une phrase, pas un ratio pour un calcul. */
  let daysSinceLastEntry: number | null = null;
  if (activityDays && activityDays.length > 0) {
    const seen = new Set(activityDays);
    const idx = lastDayKeys(today, OBSERVATION_WINDOW_DAYS).findIndex((k) => seen.has(k));
    if (idx >= 0) daysSinceLastEntry = idx;
  }
  // Interpolation depuis 1 (aucune saisie) jusqu'à `activityDampening` (une saisie chaque jour) :
  // pas d'effet falaise, et un tap isolé ne vaut plus le demi-doute d'un suivi quotidien.
  const activityDamp = config.activityDampening < 1
    ? 1 - (1 - config.activityDampening) * activityCoverage
    : 1;

  /* ── A. L'ENVELOPPE HONORÉE EFFACE LE DOUTE ─────────────────────────────────────────────────────
     La question n'est pas « combien d'euros as-tu saisis ? » mais « ton enveloppe est-elle honorée
     ou reste-t-il quelque chose dedans ? ». Les deux situations n'ont rien à voir :
       • il reste de l'enveloppe → une partie de ce qui était attendu n'apparaît nulle part : ces
         dépenses ont peut-être eu lieu sans être saisies. Le doute garde tout son sens.
       • l'enveloppe est consommée (ou dépassée) → tout ce que le budget prévoyait est là, et même
         davantage. L'hypothèse « des dépenses m'ont échappé » n'a plus de support.
     D'où un simple TAUX D'HONORATION, mesuré sur la période douteuse :
         `taux = min(1, variable saisi ÷ variable attendu)` puis `doute effacé = doute × taux`.

     ⚠️ CE N'EST PAS UN PLAFOND EN EUROS. La version précédente bornait l'effacement à l'enveloppe
     proratisée — sur un budget déclaré à 600 € alors que le réel tourne à 2 400 €, elle ne pouvait
     jamais effacer plus de ~414 €, et quelqu'un qui avait saisi 2 048 € de dépenses restait en
     « estimation ». L'enveloppe sert de RÉFÉRENCE au taux, jamais de limite à l'effacement.

     Contrepartie assumée : un doute d'une autre nature (frais bancaires, récurrente dont le montant
     a changé) est effacé lui aussi dès que l'enveloppe est honorée. Il réapparaîtra à la prochaine
     vérification, qui recalibrera la dérive — plutôt que de maintenir en « estimation » quelqu'un
     qui a tout noté.

     Ne s'applique pas quand aucune vérification n'a jamais eu lieu (le point de départ lui-même est
     inconnu : aucune somme de saisies ne le corrige), ni sans enveloppe établie, ni sans signaux
     journaliers. Au-delà de la fenêtre d'observation, rien à opposer au doute : dérive pleine. */
  const observedDays = Math.min(daysSinceVerification, OBSERVATION_WINDOW_DAYS);
  const rawDoubt = dailyDrift * daysSinceVerification;
  let observedRelief: number | null = null;
  let observedRate: number | null = null;
  if (!neverVerified && variableBase && variableBase > 0 && variableSpentByDay && observedDays > 0) {
    /* ── LE TAUX DOIT ÊTRE RÉPARTI, PAS CONCENTRÉ ────────────────────────────────────────────────
       Un taux calculé d'un bloc sur toute la période se laisse saturer par un seul jour, et deux
       profils très différents en sortaient « à jour » à tort :
         • celui qui saisit assidûment les dix premiers jours puis oublie les quinze suivants — le
           montant cumulé honore l'enveloppe alors qu'on ne sait plus rien de lui depuis deux
           semaines ;
         • celui qui saisit UN achat exceptionnel de 2 000 € et rien d'autre — un seul jour couvrait
           trois semaines de doute.
       On découpe donc la période en tranches (la fenêtre d'assiduité), chacune jugée pour elle-même.

       ── CHAQUE TRANCHE RÉPOND DE SES PROPRES JOURS ────────────────────────────────────────────
       On retenait la tranche la PLUS FAIBLE. C'était trop dur, et faux : le doute vaut
       `dérive × jours`, donc il s'accumule JOUR PAR JOUR — une semaine bien suivie efface le doute
       de SES jours, qu'une autre semaine ait été muette ou non. Avec le minimum, une seule semaine
       calme (peu dépensé, donc peu à saisir) ramenait à zéro l'effacement des trois semaines : le
       Relyka restait en estimation chez quelqu'un qui note tout, ce qui est exactement l'inverse de
       ce que cette règle cherche à produire.
       Le taux est donc la MOYENNE des tranches, pondérée par leur nombre de jours — ce qui revient
       à effacer, pour chaque jour, la part de doute réellement observée ce jour-là.

       Les deux profils du début restent traités : le silencieux récent n'efface que les jours qu'il
       a suivis (trois semaines dont deux muettes → un tiers du doute), et l'achat exceptionnel reste
       borné par le plafond `min(1, …)` de SA tranche, qui ne déborde pas sur les autres.

       Dans chaque tranche, deux preuves comptent, mais PAS à parts égales :
         • les MONTANTS : ce que l'enveloppe prévoyait est là — c'est le critère principal ;
         • l'ACTIVITÉ : des saisies jour après jour, plafonnée à `ACTIVITY_ONLY_MAX_RATE`.
       L'activité rattrape deux situations que les montants jugent mal — un budget SUR-estimé
       (2 000 € déclarés pour 500 € réellement dépensés), et une tranche réellement calme (une
       semaine sans aucune dépense) — sans pouvoir effacer le doute à elle seule : saisir tous les
       jours prouve l'assiduité, pas l'exhaustivité. Sans ce plafond, quelqu'un ayant honoré 60 % de
       son enveloppe voyait 100 % de son doute disparaître, ce qui vidait la règle de son sens. */
    const sliceDays = Math.max(1, Math.round(config.activityWindowDays) || 1);
    const keys = lastDayKeys(today, observedDays);           // du plus récent au plus ancien
    const slices: string[][] = [];
    for (let i = 0; i < keys.length; i += sliceDays) slices.push(keys.slice(i, i + sliceDays));
    // Tranche la plus ancienne trop courte → fusionnée : juger deux ou trois jours isolés sur le
    // même barème qu'une semaine ferait tomber le taux à zéro sur un simple effet de découpage.
    if (slices.length > 1 && slices[slices.length - 1].length < sliceDays / 2) {
      const tail = slices.pop() as string[];
      slices[slices.length - 1].push(...tail);
    }

    const seen = new Set(activityDays ?? []);
    let weighted = 0;   // Σ (taux de la tranche × ses jours)
    let counted = 0;    // Σ (jours des tranches)
    for (const slice of slices) {
      const expected = (variableBase / DAYS_PER_MONTH) * slice.length;
      let observed = 0;
      let active = 0;
      for (const k of slice) {
        const v = variableSpentByDay[k];
        if (typeof v === 'number' && Number.isFinite(v)) observed += v;
        if (seen.has(k)) active++;
      }
      const byAmount = expected > 0 ? Math.min(1, Math.max(0, observed) / expected) : 0;
      const byActivity = (active / slice.length) * ACTIVITY_ONLY_MAX_RATE;
      weighted += Math.max(byAmount, byActivity) * slice.length;
      counted += slice.length;
    }
    // Pondération par les JOURS, jamais par le nombre de tranches : la dernière tranche peut avoir
    // été fusionnée (cf. plus haut) et pèserait alors autant qu'une semaine pleine.
    observedRate = counted > 0 ? weighted / counted : 0;
    observedRelief = Math.min(rawDoubt, base) * observedRate;
  }

  // PLAFOND ABSOLU : le doute ne peut pas dépasser la base de référence (revenu / enveloppe /
  // Relyka). Au-delà, il ne mesure plus une incertitude mais une anomalie de calibration — et il
  // produisait des affichages intenables : un Relyka de 1 266 € annoncé « jusqu'à 10 300 € ».
  // Le plafond ne corrige pas la cause (cf. lib/reliabilityCalib) ; il garantit qu'aucune donnée
  // aberrante ne puisse à nouveau rendre le chiffre principal incohérent avec son propre détail.
  const rawUncertainty = Math.max(0, Math.min(rawDoubt, base) - (observedRelief ?? 0));
  const uncertaintyEur = rawUncertainty * activityDamp;
  const doubtRatio = base > 0 ? uncertaintyEur / base : 0;
  const rawRatio = base > 0 ? rawUncertainty / base : 0;

  let level: ConfidenceLevel;
  if (doubtRatio < config.highMax) level = 'high';
  else if (doubtRatio < config.lowMin) level = 'medium';
  else level = 'low';
  /* VERROU : un doute que seul l'amortisseur fait passer sous le seuil ne donne pas « À jour » —
     sinon une poignée de saisies suffirait à annoncer des chiffres nets.
     Il est LEVÉ quand l'assiduité est réelle (couverture ≥ activityHighCoverage) et qu'une
     vérification a déjà eu lieu : vérifier sert à retrouver ce qui n'a pas été saisi, et quand
     chaque jour porte ses saisies, il n'y a plus rien à retrouver. Sans vérification passée, le
     verrou tient quoi qu'il arrive : l'assiduité ne dit rien du solde de départ.
     Noter que le plafond d'observation (A), lui, agit AVANT amortissement : il fait baisser
     `rawRatio` et peut donc légitimement mener à « À jour » sans passer par ce verrou. */
  const assiduous = activityCoverage >= config.activityHighCoverage && !neverVerified;
  if (level === 'high' && activityDamp < 1 && rawRatio >= config.highMax && !assiduous) level = 'medium';

  /* A-t-on eu de ses nouvelles récemment ? Une seule question, une seule date (cf. QUIET_ENTRY_DAYS).
     Jamais sans vérification passée : sans point de départ constaté, aucune somme de saisies ne dit
     où l'on en est (même règle que le plafond d'observation). */
  const entriesKeptUp = !neverVerified
    && daysSinceLastEntry != null
    && daysSinceLastEntry <= QUIET_ENTRY_DAYS;

  return {
    level, doubtRatio, uncertaintyEur, daysSinceVerification, rawDaysSinceVerification,
    neverVerified, dailyDrift, coldStart,
    activityDamped: activityDamp < 1,
    activityCoverage,
    daysSinceLastEntry,
    observedRelief,
    observedRate,
    entriesKeptUp,
  };
}

// ── Formulations VAGUES de l'ancienneté de vérification ──────────────────────
// On n'affiche JAMAIS un compteur de jours précis (peu fiable : un compte neuf, jamais vérifié,
// démarre à `coldStartDays` → « 21 j » n'a aucun sens). On préfère un terme flou et rassurant.

/**
 * « depuis quelques jours » / « depuis un moment »… pour dater une absence.
 *
 * Sert aussi bien à l'ancienneté d'une VÉRIFICATION qu'à celle de la dernière SAISIE : c'est une
 * formulation d'ancienneté, pas un vocabulaire de solde (cf. `daysSinceLastEntry`).
 */
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
