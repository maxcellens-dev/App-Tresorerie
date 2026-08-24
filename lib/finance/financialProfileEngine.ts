/**
 * Moteur de profils financiers P0-P9
 * ────────────────────────────────────
 * • Calcul du profil à partir des données réelles
 * • Évaluation automatique mensuelle (montée/descente)
 * • Règles exceptionnelles (chute de revenus)
 */

import type { FinancialProfileId } from '../../types/database';
import { computeSecurityCushion } from './securityCushion';

// ── Référentiel des profils ────────────────────────────────────
//
// DIX PALIERS PLUTÔT QUE CINQ, ET POURQUOI
// ────────────────────────────────────────
// Cinq paliers ne décrivaient personne correctement aux deux extrémités :
//   • en bas, il n'existait aucun profil pour quelqu'un de STRUCTURELLEMENT déficitaire — il
//     recevait les mêmes conseils que quelqu'un qui commence tout juste à épargner ;
//   • en haut, un seul « P5 » devait couvrir de 20 000 € à plusieurs millions, avec les mêmes
//     pourcentages de répartition ;
//   • et au milieu — là où se trouve la grande majorité des gens — trois paliers seulement pour
//     tout l'écart entre « un mois de réserve » et « six mois plus un portefeuille ».
// La granularité suit donc la réalité : resserrée là où la population est dense (P2–P5), plus
// large là où elle se raréfie (P7–P9).
//
// LES DEUX AXES
// ─────────────
//   1. le MATELAS DE SÉCURITÉ (épargne disponible ÷ DÉPENSES essentielles) — il gouverne P1 à P6 ;
//   2. le PATRIMOINE BANCAIRE (courant + épargne + investissement) — il gouverne P7 à P9.
// L'app ne connaît ni l'immobilier, ni l'assurance-vie hors app, ni les parts d'entreprise : on ne
// parle donc jamais de « patrimoine » tout court, mais de ce qui est sur les comptes suivis.
//
// P0 (Découverte) N'EST PAS UN JUGEMENT : c'est l'absence de données. Avant lui, tout nouvel
// arrivant tombait en « épargne critique » faute de revenu constaté — on lui annonçait une
// situation préoccupante alors qu'on ne savait rien de lui.
//
// ── QUATRE QUESTIONS, DANS CET ORDRE, ET RIEN D'AUTRE ───────────────────────────────────────────
//   1. la situation est-elle VIABLE ?          revenu vs dépenses essentielles      → sinon P1
//   2. combien de temps tient-il ?             épargne ÷ dépenses essentielles      → P2 … P5
//   3. investit-il RÉELLEMENT ?                oui / non                            → P6
//   4. quelle est la taille du patrimoine ?    30k / 100k / 300k                    → P7 … P9
//
// Le TAUX D'ÉPARGNE a été retiré du calcul, et c'est un correctif, pas une simplification. Il
// mesurait un MÉRITE là où le profil décrit un ÉTAT : la règle « 1 mois de réserve + 20 % mis de
// côté → P4 » mettait dans le même palier quelqu'un avec cinq mois d'avance et quelqu'un avec un
// mois — deux situations sans rapport, un seul conseil. Il était en outre mesuré sur les seuls
// VIREMENTS sortants vers un compte d'épargne : qui épargne autrement (apports saisis à la main,
// compte hors app, virement fait à la banque) lisait 0 %. Ce n'était pas un signal, c'était un
// artefact de saisie. La trajectoire se célèbre ailleurs (Pouls, succès, série) — pas dans un
// diagnostic.
//
// CONSÉQUENCE À GARDER EN TÊTE : toute la classification P2→P5 repose désormais sur UNE mesure, le
// matelas. C'est pour cela que son dénominateur est protégé (cf. `recurringExpensesKnown` dans
// lib/finance/securityCushion) et que la FIABILITÉ du profil est affichée à part
// (cf. lib/finance/profileReliability).

/**
 * VERSION DE L'ÉCHELLE — sert à reclasser tout le monde EN SILENCE après un changement de règles.
 *
 * Le profil est journalisé à chaque changement, et chaque ligne non lue ouvre une fenêtre « ton
 * profil a changé ». Modifier la cascade reclasse donc la base entière à la première ouverture :
 * des milliers de fenêtres, pour un changement que personne n'a provoqué. Le pire moment pour
 * expliquer quoi que ce soit.
 *
 * On horodate donc l'échelle. Quand la version stockée est plus ancienne que celle-ci, la
 * réévaluation qui suit est une RECLASSIFICATION : le nouveau palier est écrit et journalisé (les
 * statistiques d'administration restent justes), mais la notification est marquée comme déjà vue.
 * L'utilisateur retrouve simplement son profil à jour.
 *
 * ⚠️ À incrémenter à CHAQUE modification des règles de classement, jamais pour un simple
 * recalibrage de seuils (celui-là est un vrai changement de situation, il doit se voir).
 *   1 → échelle à dix paliers avec taux d'épargne (migrations 182/194)
 *   2 → cascade viabilité → matelas → placements → patrimoine, sans taux d'épargne
 */
export const PROFILE_LADDER_VERSION = 2;

/** Ordre canonique. Toute liste de profils dans l'app doit partir d'ici, jamais d'un littéral. */
export const FINANCIAL_PROFILE_IDS: FinancialProfileId[] = [
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9',
];

/** Profils réellement « classants » (P0 exclu : il dit qu'on ne sait pas encore). */
export const RANKED_PROFILE_IDS: FinancialProfileId[] = FINANCIAL_PROFILE_IDS.filter((p) => p !== 'P0');

const KNOWN_PROFILE_IDS = new Set<string>(FINANCIAL_PROFILE_IDS);

/**
 * Ramène une valeur lue en base sur le référentiel COURANT.
 *
 * ⚠️ Un identifiant de profil vient de la base, donc d'un monde que le code ne contrôle pas : une
 * migration s'applique à la base AVANT que la nouvelle version n'atteigne les appareils, et un
 * client encore sur l'ancien bundle lit alors un palier qu'il ne connaît pas. Les tables indexées
 * par profil (`PROFILE_INFO`, `PROFILE_ALLOCATIONS`, `DEFAULT_PULSE_SIGNALS`…) rendaient `undefined`
 * pour ces valeurs, et l'écran tombait — l'état des lieux plantait sur un `.filter` de `undefined`,
 * chez tout le monde en même temps.
 *
 * On CLAMPE donc plutôt que de faire confiance : `P12` devient le palier le plus haut connu, une
 * valeur illisible devient `P0` (« on ne sait pas »), ce qui est exactement ce qu'elle signifie.
 * Aucun écran ne peut plus être mis à terre par un identifiant inattendu.
 */
export function resolveProfileId(raw: string | null | undefined): FinancialProfileId {
  if (raw && KNOWN_PROFILE_IDS.has(raw)) return raw as FinancialProfileId;
  const n = Number(String(raw ?? '').replace(/^P/i, ''));
  if (!Number.isFinite(n)) return 'P0';
  const clamped = Math.max(0, Math.min(RANKED_PROFILE_IDS.length, Math.round(n)));
  return `P${clamped}` as FinancialProfileId;
}

export const PROFILE_INFO: Record<FinancialProfileId, {
  name: string;
  emoji: string;
  tier: string;
  description: string;
  color: string;
}> = {
  P0: {
    name: 'Découverte',
    emoji: '🧭',
    tier: 'Découverte',
    /* Pas de « sans questionnaire » : il n'y en a pas, donc l'utilisateur n'a aucune raison d'y
       penser. On ne rassure pas sur une contrainte qui n'existe pas — on dit quoi faire. */
    description: 'On apprend à te connaître. Ajoute tes comptes et tes rentrées d\'argent : ton profil se calculera tout seul.',
    color: '#94a3b8',
  },
  P1: {
    name: 'Fragile',
    emoji: '🌧️',
    tier: 'Situation à rétablir',
    description: 'Ce qui sort dépasse ce qui rentre : le mois ne peut pas se boucler tout seul. Une seule priorité, remettre l\'équation à l\'endroit — tout le reste attend.',
    color: '#dc2626',
  },
  P2: {
    name: 'Premiers repères',
    emoji: '🌱',
    tier: 'Sans filet',
    description: 'Tu tiens le mois, mais sans filet : moins d\'un mois de dépenses de côté. L\'objectif est d\'en constituer un premier.',
    color: '#ef4444',
  },
  P3: {
    name: 'Réserve à construire',
    emoji: '🌿',
    tier: 'Épargne à renforcer',
    description: 'Un à trois mois de dépenses de côté : le filet existe. Renforce-le jusqu\'à trois mois avant toute autre ambition.',
    color: '#f59e0b',
  },
  P4: {
    name: 'Équilibre trouvé',
    emoji: '⚖️',
    tier: 'Stabilité',
    description: 'Trois à six mois de réserve et une épargne régulière. Tu peux commencer à faire travailler ce qui dépasse.',
    color: '#3b82f6',
  },
  P5: {
    name: 'Sécurité acquise',
    emoji: '🛡️',
    tier: 'Sécurité acquise',
    description: 'Plus de six mois de dépenses couverts : ton matelas est fait. Continuer à empiler du liquide ne rapporte plus rien.',
    color: '#0ea5e9',
  },
  P6: {
    name: 'Premiers placements',
    emoji: '🌍',
    tier: 'Investisseur débutant',
    description: 'Réserve solide ET premiers investissements en place. L\'enjeu devient la régularité des versements, pas leur montant.',
    color: '#8b5cf6',
  },
  P7: {
    name: 'Patrimoine en construction',
    emoji: '🚀',
    tier: 'Patrimoine en construction',
    description: 'Le patrimoine sur tes comptes dépasse 30 000 €. L\'investissement prend le pas sur l\'épargne de précaution, déjà pleine.',
    color: '#a855f7',
  },
  P8: {
    name: 'Patrimoine établi',
    emoji: '🏛️',
    tier: 'Patrimoine établi',
    description: 'Au-delà de 100 000 € sur tes comptes : une minorité de la population. L\'objectif n\'est plus d\'accumuler mais de faire fructifier.',
    color: '#22c55e',
  },
  P9: {
    name: 'Patrimoine d\'exception',
    emoji: '💎',
    tier: 'Patrimoine d\'exception',
    description: 'Plus de 300 000 € sur tes comptes bancaires — et au-delà du million, une fraction de pour cent des ménages. Presque tout doit travailler ; le liquide immobilisé coûte cher.',
    color: '#14b8a6',
  },
};

/**
 * RÉPARTITION DU RELYKA entre les quatre décisions (Épargner / Investir / Confort / Conserver).
 * Somme = 100 pour chaque profil — c'est un invariant, vérifié en test.
 *
 * La courbe est lisible d'un bloc : l'épargne de précaution s'efface à mesure que le matelas se
 * remplit, l'investissement prend sa place, le confort progresse doucement (on ne « mérite » pas
 * de dépenser plus parce qu'on est riche : on se le permet plus sereinement), et « Conserver »
 * reste haut aux deux extrémités — par nécessité en bas (le mois est tendu), par choix en haut
 * (le patrimoine se pilote, il ne se dépense pas).
 */
export const PROFILE_ALLOCATIONS: Record<FinancialProfileId, {
  save: number; invest: number; enjoy: number; keep: number;
}> = {
  // Rien n'est mesuré : on ne pousse ni à épargner ni à investir, on garde.
  P0: { save: 25, invest:  0, enjoy: 20, keep: 55 },
  // Déficitaire : le liquide est vital. Épargner un peu quand même — sinon on ne sort jamais du cycle.
  P1: { save: 30, invest:  0, enjoy:  5, keep: 65 },
  P2: { save: 55, invest:  0, enjoy: 10, keep: 35 },
  P3: { save: 45, invest:  5, enjoy: 15, keep: 35 },
  P4: { save: 30, invest: 20, enjoy: 20, keep: 30 },
  P5: { save: 20, invest: 30, enjoy: 22, keep: 28 },
  P6: { save: 12, invest: 40, enjoy: 25, keep: 23 },
  P7: { save:  8, invest: 47, enjoy: 25, keep: 20 },
  P8: { save:  5, invest: 55, enjoy: 25, keep: 15 },
  P9: { save:  0, invest: 62, enjoy: 28, keep: 10 },
};

/**
 * Correspondance profil → palier d'allocation historique (table `recommendation_tier_allocations`).
 *
 * Les cinq paliers de la base sont conservés : ils portent les réglages admin et les libellés du
 * moteur de recommandations. Dix profils s'y projettent, deux ou trois par palier — ce qui n'ôte
 * rien à la finesse, puisque les POURCENTAGES viennent de PROFILE_ALLOCATIONS, profil par profil.
 * Le palier ne sert plus qu'à choisir le VOCABULAIRE des conseils.
 */
export const PROFILE_TO_TIER: Record<FinancialProfileId, 'critical' | 'below_optimal' | 'healthy' | 'p4_dynamic' | 'comfortable'> = {
  P0: 'below_optimal',   // on ne sait pas : ton neutre, jamais alarmiste
  P1: 'critical',
  P2: 'critical',
  P3: 'below_optimal',
  P4: 'healthy',
  P5: 'healthy',
  P6: 'p4_dynamic',
  P7: 'p4_dynamic',
  P8: 'comfortable',
  P9: 'comfortable',
};

// ── Questionnaire — options ───────────────────────────────────

export const Q1_OPTIONS = [
  'Salaire fixe (Mensuel)',
  'Revenu Freelance / Indépendant (Aléatoire)',
  'Retraite (Mensuel)',
  'Loyers et Revenus immobiliers (Mensuel)',
  'Dividendes (Annuel / Ponctuel)',
  'Chômage et Allocations (Mensuel / Temporaire)',
] as const;

export const Q2_OPTIONS = [
  'Tous les mois à date fixe (+/- 5 jours)',
  'Tous les mois à des dates variables',
  'Une ou plusieurs fois par an de manière ponctuelle',
  'De manière totalement imprévisible',
] as const;

export const Q3_OPTIONS = [
  'Moins de 1 500 €',
  'De 1 500 € à 2 500 €',
  'De 2 500 € à 4 000 €',
  'Plus de 4 000 €',
] as const;

export const Q4_OPTIONS = [
  'Rien, je finis souvent le mois à découvert',
  "J'ai de quoi vivre sans trop me priver, mais je n'épargne pas",
  'Une somme que je mets volontairement de côté chaque mois',
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
] as const;

export const Q5_OPTIONS = [
  "Moins d'un mois",
  '1 à 3 mois',
  '3 à 6 mois',
  'Plus de 6 mois',
] as const;

export const Q6_OPTIONS = [
  '0 %',
  'Moins de 10 %',
  'Entre 10 % et 20 %',
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
  'Je ne sais pas',
] as const;

export const Q7_OPTIONS = [
  'Stabiliser mon budget',
  'Mettre de côté',
  'Financer un projet précis à court ou moyen terme',
  'Commencer à investir',
  'Savoir combien épargner et/ou investir',
  'Connaître mon budget plaisir disponible sans culpabiliser',
  'Suivre simplement mes finances',
] as const;

export interface QuestionnaireAnswers {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  /** @deprecated Aucun calcul ne lit cette réponse — conservée pour les comptes existants. */
  q7: string;
  /** Montant minimum conservé sur les comptes courants. Chaîne numérique ou '' pour "je ne sais pas" (→ 0). */
  q8: string;
  /** Estimation hebdomadaire des dépenses variables (€/semaine). Chaîne numérique ou '' (→ 0). */
  q9: string;
}

/** Convertit la réponse Q8 en montant numérique. '' ou "je ne sais pas" → 0. */
export function safetyMarginFromQ8(q8: string): number {
  if (!q8 || q8.toLowerCase().includes('sais pas')) return 0;
  const v = parseFloat(q8.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Montant hebdomadaire variable (€/semaine) → € net numérique. '' → 0.
 *  Question 4 du questionnaire (« Dépenses variables hebdo »), stockée en base dans le champ `q9`. */
export function weeklyVariableFromQ9(q9: string): number {
  if (!q9) return 0;
  const v = parseFloat(q9.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Facteur de conversion hebdomadaire → mensuel (52 semaines / 12 mois). */
export const WEEKS_PER_MONTH = 4.33;

/** Revenu mensuel REPRÉSENTATIF d'une tranche Q3 (borne basse prudente de la tranche). */
function representativeIncome(q3: string): number {
  const i = Q3_OPTIONS.indexOf(q3 as any);
  // Bornes basses (prudentes) : <1500→1200, 1500-2500→1800, 2500-4000→2800, >4000→4200.
  return [1200, 1800, 2800, 4200][i] ?? 1800;
}

/**
 * Estimation AUTOMATIQUE des dépenses variables hebdomadaires (€/semaine) quand l'utilisateur
 * ne la renseigne pas (ex. questionnaire passé). On prend ~35 % du revenu mensuel en variable
 * (courses + loisirs), ce qui donne un profil PRUDENT (on ne suppose pas 0 € de dépenses).
 */
export function estimateWeeklyVariable(q3: string): number {
  const monthlyVariable = representativeIncome(q3) * 0.35;
  return Math.round(monthlyVariable / WEEKS_PER_MONTH);
}

/** Estimation mensuelle des dépenses variables à partir de la réponse hebdo Q9. */
export function monthlyVariableFromQ9(q9: string): number {
  return weeklyVariableFromQ9(q9) * WEEKS_PER_MONTH;
}

/* `q5FromSecurityMonths` et `deriveQ5` ont été retirées : elles traduisaient le matelas mesuré en
   tranche déclarative Q5 (« moins d'un mois », « 3 à 6 mois »…) pour alimenter l'ancien moteur de
   profil. Ce moteur est parti, et le questionnaire de démarrage n'existe plus : le profil se déduit
   directement des données. Leur `deriveQ5` mesurait en outre le matelas sur le REVENU — c'était le
   dernier endroit du dépôt à le faire. */

/** Tranche Q3 (revenu) correspondant à un montant mensuel net saisi. */
export function q3FromMonthlyIncome(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return Q3_OPTIONS[0];
  if (amount < 1500) return Q3_OPTIONS[0];
  if (amount < 2500) return Q3_OPTIONS[1];
  if (amount < 4000) return Q3_OPTIONS[2];
  return Q3_OPTIONS[3];
}

/**
 * RÉPONSES NEUTRES pour les questions pas encore posées (profil provisoire).
 *
 * ⚠️ Surtout PAS « la première option de chaque question », qui était l'ancien repli du bouton
 * « Passer le questionnaire » : la 1ʳᵉ option de q4 est « je finis souvent à découvert », qui
 * déclenche un `return 'P1'` immédiat. Tout utilisateur ayant sauté le questionnaire se retrouvait
 * donc classé « Épargne critique », investissement à 0 %, quelles que soient ses autres réponses.
 * Neutre = le cas médian, qui laisse q5 (mesurée) décider du niveau.
 */
export const NEUTRAL_ANSWERS: Readonly<Pick<QuestionnaireAnswers, 'q4' | 'q6'>> = {
  q4: Q4_OPTIONS[1],   // « J'ai de quoi vivre sans trop me priver, mais je n'épargne pas »
  q6: Q6_OPTIONS[6],   // « Je ne sais pas »
};

// ── Détection revenu irrégulier ───────────────────────────────

const IRREGULAR_INCOME_TYPES = new Set([
  'Revenu Freelance / Indépendant (Aléatoire)',
  'Dividendes (Annuel / Ponctuel)',
]);

/**
 * Irrégulier seulement si TOUS les types de revenus sélectionnés sont irréguliers
 * (logique "meilleure réponse" : si le profil a aussi un salaire fixe, il bénéficie
 * de la régularité de ce revenu pour la détermination du profil).
 */
export function detectIrregularIncome(q1: string, q2: string): boolean {
  const q1Values = q1.split('|').filter(Boolean);
  const allIrregular = q1Values.length > 0 && q1Values.every((v) => IRREGULAR_INCOME_TYPES.has(v));
  return allIrregular || q2 === 'De manière totalement imprévisible';
}

// ── Jeux de valeurs pour la matrice ──────────────────────────

const Q6_HIGH = new Set([
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
]);

const Q6_MID = new Set([
  'Entre 10 % et 20 %',
  'Entre 20 % et 30 %',
  'Plus de 30 %',
  "Je n'ai plus besoin d'augmenter mon épargne actuellement",
]);

const Q4_INVEST = new Set([
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
]);

const Q4_SAVING = new Set([
  'Une somme que je mets volontairement de côté chaque mois',
  "Une somme que j'épargne et j'investis équitablement ou occasionnellement",
  "Un montant suffisant que j'investis en priorité",
]);

const Q4_MINIMAL = new Set([
  "J'ai de quoi vivre sans trop me priver, mais je n'épargne pas",
]);

// ── Calcul du profil initial ──────────────────────────────────

/**
 * Retourne le profil P1-P6 selon la matrice du questionnaire (repli historique).
 * Évaluation du plus élevé (P5) au plus bas (P1).
 */
/* ── LE PROFIL, À PARTIR DES SEULES DONNÉES RÉELLES ────────────────────────────────────────────
 *
 * Plus aucune réponse déclarée n'entre dans le calcul : ni questionnaire d'accueil, ni « micro-
 * questions ». Trois mesures suffisent, toutes issues de ce que l'utilisateur a réellement saisi.
 * Conséquence directe : dès qu'il renseigne la dernière donnée manquante (son revenu), son profil
 * apparaît — et tant qu'il manque quelque chose, il reste P1, le profil le plus prudent.
 *
 * La matrice reprend EXACTEMENT les paliers de l'ancienne (mois de sécurité × taux d'épargne ×
 * comportement d'investissement), en remplaçant chaque réponse par sa mesure :
 *   q5 « combien de temps tiendrais-tu ? »  → mois de sécurité (épargne ÷ dépenses essentielles)
 *   q6 « quelle part mets-tu de côté ? »    → taux d'épargne constaté (mis de côté ÷ revenu)
 *   q4 « que fais-tu de ce qui reste ? »    → épargne-t-il / investit-il vraiment ?
 */
export interface ProfileDataInputs {
  /**
   * Épargne disponible = solde des COMPTES D'ÉPARGNE, et eux seuls.
   *
   * Décision produit assumée : ce qui dort sur le compte courant n'est pas une réserve. Il sert au
   * quotidien, il est déjà compté dans le Relyka, et l'appeler « matelas » reviendrait à créditer
   * d'une sécurité quelqu'un qui n'a fait que ne pas encore dépenser sa paie.
   */
  availableSavings: number;
  /** Revenu mensuel moyen CONSTATÉ. 0/absent = donnée manquante → P0 (Découverte). */
  avgMonthlyIncome: number;
  /** Total réellement placé sur des comptes d'investissement. */
  totalInvested: number;
  /**
   * Au moins une dépense RÉCURRENTE saisie — quelle que soit sa forme (y compris un virement de
   * charges vers un compte joint, cf. `has_recurring_expenses` dans lib/finance/pilotageEngine).
   *
   * ⚠️ Ce n'est PAS une porte d'entrée : la complétude des données ne décide jamais si un profil est
   * attribué. Elle décide seulement du DÉNOMINATEUR du matelas — sans charge connue, les « dépenses
   * essentielles » se réduisent à l'enveloppe variable, et on préfère alors diviser par le revenu
   * (prudent) plutôt que par un total amputé du loyer (rassurant à tort).
   * Ce que l'app ne sait pas se DIT, à part, dans la fiabilité du profil — ça ne se traduit pas par
   * un refus de classer (cf. lib/finance/profileReliability).
   */
  hasRecurringExpenses: boolean;
  /**
   * Solde des comptes COURANTS, à l'instant T.
   *
   * ⚠️ NE JAMAIS EN CONCLURE SEUL. Un solde négatif un jour donné ne dit presque rien : on peut
   * attendre une paie dans trois jours, avoir laissé filer le courant en gardant 20 000 € sur un
   * livret, ou être à −5 € la veille du virement. Classer quelqu'un « chroniquement déficitaire »
   * là-dessus, c'est confondre une photo avec une trajectoire. Cette valeur ne sert donc qu'en
   * complément d'un manque de liquidité TOTALE (cf. `hasStructuralDeficit`).
   */
  checkingBalance?: number;
  /**
   * Nombre de mois consécutifs terminés dans le rouge. C'est CELA qu'on veut dire par « découvert
   * chronique » — pas un solde négatif un mardi. Absent = information non disponible : on ne
   * suppose rien.
   */
  consecutiveOverdraftMonths?: number;
  /**
   * Patrimoine BANCAIRE total (courant + épargne + investissement). Il gouverne les paliers hauts :
   * au-delà d'un certain montant, le nombre de mois de réserve ne dit plus rien d'utile (quelqu'un
   * avec 400 000 € a « 200 mois de réserve », ce qui ne le distingue pas de quelqu'un avec 80 000 €
   * et un petit revenu). À défaut, reconstitué depuis l'épargne et l'investissement.
   */
  totalLiquidWealth?: number;
  /**
   * Dépenses ESSENTIELLES mensuelles (charges récurrentes + enveloppe variable). C'est la base du
   * matelas de sécurité : « combien de temps je tiens » se mesure sur ce qui SORT, pas sur ce qui
   * rentrait (cf. lib/securityCushion). Absent → repli sur le revenu.
   */
  monthlyEssentialExpenses?: number;
}

/**
 * Seuils de PATRIMOINE BANCAIRE des paliers hauts (€ sur les comptes suivis par l'app).
 *
 * Calés sur la réalité de la distribution du patrimoine financier des ménages : au-delà de
 * 30 000 € de placements bancaires on quitte déjà la moitié inférieure, 100 000 € correspond
 * grossièrement au dernier quart, et 300 000 € aux quelques pour cent du haut — le million étant
 * une fraction de pour cent. Volontairement ronds : ce sont des repères, pas des mesures.
 *
 * ⚠️ VALEURS DE REPLI uniquement (cf. `DEFAULT_PROFILE_THRESHOLDS`) : la configuration réelle vient
 * de `profile_matrix_config`. Conservées exportées, l'administration s'en sert comme repères
 * d'affichage.
 */
export const WEALTH_THRESHOLDS = { P7: 30_000, P8: 100_000, P9: 300_000 } as const;

/** Au-delà, on le NOMME : c'est le seul palier où le mot a un sens. */
export const MILLIONAIRE_THRESHOLD = 1_000_000;

/** Mois de réserve exigés pour prétendre à un palier de patrimoine (P7+) — valeur de repli. */
const WEALTH_MIN_MONTHS = 6;

/** Découvert « chronique » : mois consécutifs dans le rouge — valeur de repli. */
const CHRONIC_OVERDRAFT_MONTHS = 2;

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   SEUILS DE L'ÉCHELLE — CONFIGURABLES, JAMAIS EN DUR
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Tous les nombres qui décident d'un palier vivent ici, dans une structure unique alimentée par
   `profile_matrix_config` (écran d'administration). Ils étaient jusqu'ici des constantes de module :
   l'administration proposait bien de régler « Montée — mois de dépenses couverts ≥ », mais plus
   rien ne lisait ces valeurs. Un réglage sans effet est pire qu'un réglage absent — on croit avoir
   calibré, et le comportement n'a pas bougé d'un iota.

   DEUX SEUILS PAR PALIER, ET C'EST L'ESSENTIEL. `up` est le niveau à atteindre pour MONTER, `down`
   celui sous lequel on REDESCEND. L'écart entre les deux EST l'hystérésis : elle n'est plus un
   pourcentage appliqué uniformément, mais une bande réglable palier par palier — on peut vouloir
   qu'on monte difficilement en P5 et qu'on en redescende très difficilement, ce qu'un ratio unique
   ne permet pas d'exprimer. */
export interface ProfileThresholds {
  /** Matelas (mois de dépenses couvertes) à ATTEINDRE pour chaque palier. */
  monthsUp: { P3: number; P4: number; P5: number; P6: number };
  /** Matelas sous lequel on REDESCEND de chaque palier. Toujours ≤ `monthsUp`. */
  monthsDown: { P3: number; P4: number; P5: number; P6: number };
  /** Patrimoine bancaire à atteindre pour les paliers hauts, et seuil de sortie. */
  wealthUp: { P7: number; P8: number; P9: number };
  wealthDown: { P7: number; P8: number; P9: number };
  /** Réserve minimale exigée EN PLUS du montant, pour chaque palier de patrimoine. */
  wealthMinMonths: { P7: number; P8: number; P9: number };
  /** Mois consécutifs dans le rouge à partir desquels le découvert est CHRONIQUE. */
  chronicOverdraftMonths: number;
  /**
   * VIABILITÉ — la bande qui décide de l'entrée et de la sortie de P1, en part du revenu.
   *
   * Elle manquait, et c'était le seul endroit de l'échelle sans hystérésis : la comparaison
   * `charges > revenu` était STRICTE, donc un revenu qui oscille de 3 % autour de ses charges
   * faisait basculer P1 ⇄ P2 à chaque saisie — sur le palier le plus lourd à recevoir.
   *   • `viabilityExitRatio` : pour être déclaré viable (donc QUITTER P1), les charges doivent
   *     descendre sous cette part du revenu — une vraie marge, pas un centime d'écart ;
   *   • `viabilityEnterRatio` : pour TOMBER en P1, elles doivent la dépasser franchement.
   */
  viabilityExitRatio: number;
  viabilityEnterRatio: number;
  /**
   * RÉSERVE QUI DISPENSE DE P1, en mois.
   *
   * « Les revenus ne couvrent pas DURABLEMENT les dépenses » : le mot durablement est décisif.
   * Quelqu'un qui pioche volontairement dans deux ans d'épargne (congé sabbatique, transition,
   * retraite anticipée, création d'entreprise) n'est pas en danger ce mois-ci, et lui servir
   * « Fragile » serait faux — c'est même une des rares situations où l'app peut vexer quelqu'un qui
   * maîtrise parfaitement sa trajectoire. Au-dessus de ce matelas, la réserve parle ; en dessous,
   * la non-viabilité domine. À 0, la viabilité l'emporte toujours.
   */
  viabilityGraceMonths: number;
}

/**
 * Valeurs de repli — celles qui étaient codées en dur.
 *
 * Elles servent quand la configuration n'a pas pu être lue (démarrage à froid, hors-ligne) : le
 * profil reste alors calculable, avec le comportement d'avant. Elles ne sont JAMAIS une seconde
 * source de vérité : dès que la configuration arrive, c'est elle qui gouverne.
 */
export const DEFAULT_PROFILE_THRESHOLDS: ProfileThresholds = {
  monthsUp:   { P3: 1,   P4: 3, P5: 6,   P6: 6 },
  /* La bande est ASYMÉTRIQUE, et c'est le cœur du réglage : on monte dès que le but est atteint —
     six mois de réserve, c'est un accomplissement, le dire le lendemain serait mesquin — mais on ne
     redescend que sur une vraie rechute. Un mois difficile ne fait pas perdre son palier.
     Ces valeurs sont celles semées dans `profile_matrix_config` : le code et la base disent la même
     chose, ce qui rend le repli hors-ligne indistinguable du fonctionnement normal. */
  monthsDown: { P3: 0.5, P4: 1, P5: 2.5, P6: 5 },
  wealthUp:   { P7: 30_000, P8: 100_000, P9: 300_000 },
  wealthDown: { P7: 24_000, P8:  85_000, P9: 260_000 },
  /* SIX MOIS POUR LES TROIS PALIERS DE PATRIMOINE, et c'est ce qui rend l'échelle lisible.
     P7 exigeait trois mois quand P5 et P6 en demandent six : un palier « supérieur » était donc
     MOINS exigeant sur la réserve que les deux qu'il surplombe. On pouvait monter en P7 en sautant
     P5 et P6, puis retomber en P3 sans qu'aucune donnée n'ait bougé — et le décompte de paliers
     franchis annonçait des sauts qui ne voulaient rien dire.
     Alignés, les dix paliers forment une chaîne strictement cumulative :
       réserve < 1 → 1–3 → 3–6 → ≥ 6 → + placements → + 30k → + 100k → + 300k.
     Chaque palier AJOUTE une condition à celui d'avant. C'est ce qui permet de l'expliquer en une
     phrase, et c'est ce qui garantit qu'un utilisateur ne peut pas être « en avance » sur un axe et
     « en retard » sur un autre dans le même palier. */
  wealthMinMonths: { P7: WEALTH_MIN_MONTHS, P8: WEALTH_MIN_MONTHS, P9: WEALTH_MIN_MONTHS },
  chronicOverdraftMonths: CHRONIC_OVERDRAFT_MONTHS,
  /* 95 % / 102 % : il faut une vraie marge pour être déclaré viable, un vrai écart pour ne plus
     l'être. Entre les deux — la zone où le revenu et les charges se frôlent — personne ne bouge. */
  viabilityExitRatio: 0.95,
  viabilityEnterRatio: 1.02,
  viabilityGraceMonths: 6,
};

/** Une ligne de `profile_matrix_config`, telle qu'elle arrive de la base. */
export interface MatrixRow {
  transition: string;
  upgrade_months_threshold?: number | null;
  downgrade_months_threshold?: number | null;
  upgrade_wealth_threshold?: number | null;
  downgrade_wealth_threshold?: number | null;
  chronic_overdraft_months?: number | null;
  /* Viabilité (ligne P1_P2 uniquement) — cf. `ProfileThresholds`. */
  viability_exit_ratio?: number | null;
  viability_enter_ratio?: number | null;
  viability_grace_months?: number | null;
}

/* `Number(null)` vaut 0, et 0 est un nombre fini : sans ce test préalable, une colonne VIDE se
   serait lue « seuil à zéro » — c'est-à-dire un palier atteint par tout le monde. Une valeur
   absente doit retomber sur le repli, jamais sur zéro. */
const num = (v: unknown, fallback: number): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Construit les seuils de l'échelle à partir des lignes de `profile_matrix_config`.
 *
 * Chaque champ retombe INDIVIDUELLEMENT sur sa valeur par défaut : une ligne manquante ou une
 * colonne vide ne peut pas emporter tout le reste avec elle. C'est ce qui permet de déployer la
 * configuration progressivement sans jamais casser le calcul.
 */
export function thresholdsFromMatrix(rows: MatrixRow[] | null | undefined): ProfileThresholds {
  const D = DEFAULT_PROFILE_THRESHOLDS;
  const by = new Map((rows ?? []).map((r) => [r.transition, r]));
  const up = (t: string, f: number) => num(by.get(t)?.upgrade_months_threshold, f);
  const down = (t: string, f: number) => num(by.get(t)?.downgrade_months_threshold, f);

  return {
    monthsUp: {
      P3: up('P2_P3', D.monthsUp.P3),
      P4: up('P3_P4', D.monthsUp.P4),
      P5: up('P4_P5', D.monthsUp.P5),
      P6: up('P5_P6', D.monthsUp.P6),
    },
    monthsDown: {
      P3: down('P2_P3', D.monthsDown.P3),
      P4: down('P3_P4', D.monthsDown.P4),
      P5: down('P4_P5', D.monthsDown.P5),
      P6: down('P5_P6', D.monthsDown.P6),
    },
    wealthUp: {
      P7: num(by.get('P6_P7')?.upgrade_wealth_threshold, D.wealthUp.P7),
      P8: num(by.get('P7_P8')?.upgrade_wealth_threshold, D.wealthUp.P8),
      P9: num(by.get('P8_P9')?.upgrade_wealth_threshold, D.wealthUp.P9),
    },
    wealthDown: {
      P7: num(by.get('P6_P7')?.downgrade_wealth_threshold, D.wealthDown.P7),
      P8: num(by.get('P7_P8')?.downgrade_wealth_threshold, D.wealthDown.P8),
      P9: num(by.get('P8_P9')?.downgrade_wealth_threshold, D.wealthDown.P9),
    },
    wealthMinMonths: {
      P7: up('P6_P7', D.wealthMinMonths.P7),
      P8: up('P7_P8', D.wealthMinMonths.P8),
      P9: up('P8_P9', D.wealthMinMonths.P9),
    },
    chronicOverdraftMonths: num(
      by.get('P1_P2')?.chronic_overdraft_months, D.chronicOverdraftMonths,
    ),
    /* La viabilité est portée par la ligne P1_P2 : c'est elle qui gouverne l'entrée et la sortie du
       palier « Fragile ». Trois réglages au même endroit, plutôt qu'un ratio codé en dur. */
    viabilityExitRatio: num(by.get('P1_P2')?.viability_exit_ratio, D.viabilityExitRatio),
    viabilityEnterRatio: num(by.get('P1_P2')?.viability_enter_ratio, D.viabilityEnterRatio),
    viabilityGraceMonths: num(by.get('P1_P2')?.viability_grace_months, D.viabilityGraceMonths),
  };
}

/**
 * DÉFICIT STRUCTUREL — la seule chose qui justifie P1.
 *
 * Un découvert n'est pas un diagnostic, c'est un symptôme, et il a des causes très différentes :
 * on attend une paie, on a laissé filer le compte courant en gardant son épargne intacte, on a
 * payé les impôts d'un coup. Aucun de ces cas n'est un déficit — et servir « tu finis tes mois
 * dans le rouge » à quelqu'un qui a 20 000 € sur un livret est faux, en plus d'être blessant.
 *
 * On ne retient donc que deux situations, qui décrivent l'une et l'autre une trajectoire :
 *
 *   1. LES CHARGES DÉPASSENT LE REVENU. Le mois ne peut pas se boucler, quoi qu'on fasse. C'est le
 *      déficit au sens propre, et il se voit sur les moyennes, pas sur un solde.
 *   2. À SEC ET DANS LE ROUGE. Plus aucune liquidité (courant + épargne ≤ 0) : le découvert n'est
 *      plus un arbitrage puisqu'il n'y a rien pour le combler. On exige en plus, quand
 *      l'information existe, que ça DURE (`consecutiveOverdraftMonths`) — un mois difficile n'est
 *      pas une situation.
 */
export function hasStructuralDeficit(
  i: ProfileDataInputs,
  cfg: ProfileThresholds = DEFAULT_PROFILE_THRESHOLDS,
  /** Sens du trajet : la barre n'est pas au même endroit pour TOMBER en P1 que pour en SORTIR. */
  bounds: 'up' | 'down' = 'up',
): boolean {
  /* La bande de viabilité. `up` = lecture EXIGEANTE (celle qui décide si l'on peut monter, donc
     quitter P1) : il faut une vraie marge. `down` = lecture INDULGENTE (celle qui décide si l'on
     retombe) : il faut un vrai écart. Entre les deux, aucune des deux lectures ne change d'avis, et
     `resolveLiveProfile` ne bouge pas. */
  const ratio = bounds === 'up' ? cfg.viabilityExitRatio : cfg.viabilityEnterRatio;
  const essentials = i.monthlyEssentialExpenses ?? 0;
  if (essentials > 0 && i.avgMonthlyIncome > 0 && essentials > i.avgMonthlyIncome * ratio) return true;

  const checking = i.checkingBalance;
  if (checking == null || checking >= 0) return false;
  // De l'épargne mobilisable ⇒ ce découvert est un choix de trésorerie, pas une impasse.
  if (Math.max(0, i.availableSavings) + checking > 0) return false;
  // Information de durée disponible → on exige la chronicité. Sinon, être à sec ET dans le rouge
  // suffit : il n'y a par définition rien pour rattraper le mois.
  const months = i.consecutiveOverdraftMonths;
  return months == null || months >= cfg.chronicOverdraftMonths;
}

/**
 * Le palier correspondant aux données, selon un JEU DE SEUILS donné.
 *
 * `bounds` choisit quels seuils appliquer : ceux de MONTÉE (exigeants) ou ceux de DESCENTE
 * (indulgents). C'est ce qui produit l'hystérésis dans `resolveLiveProfile` — la même fonction,
 * lue deux fois avec deux barres différentes, au lieu d'un facteur correctif appliqué au matelas.
 */
export function computeProfileFromData(
  i: ProfileDataInputs,
  cfg: ProfileThresholds = DEFAULT_PROFILE_THRESHOLDS,
  bounds: 'up' | 'down' = 'up',
): FinancialProfileId {
  /* ── PORTE 0 : A-T-ON DE QUOI CALCULER ? ────────────────────────────────────────────────────
     Sans revenu constaté, aucun ratio n'a de sens. On ne devine pas — et surtout on ne classe plus
     au profil le plus prudent : « sans filet » est un DIAGNOSTIC, et il était servi à tout nouvel
     arrivant avant même qu'il ait saisi quoi que ce soit.

     ⚠️ C'est la SEULE porte, et elle porte sur la CALCULABILITÉ, pas sur la complétude. Une version
     précédente exigeait en plus un compte d'épargne ou une charge récurrente : elle renvoyait en
     « Découverte » des comptes parfaitement installés — comptes saisis, revenus récurrents,
     enveloppe variable renseignée, c'est-à-dire exactement les trois choses que le démarrage impose.
     Ce que l'app ignore se DIT (cf. lib/finance/profileReliability) ; ça ne se traduit pas par un
     refus de classer. Une donnée manquante rend le profil moins sûr, elle ne le rend pas impossible. */
  if (!(i.avgMonthlyIncome > 0)) return 'P0';

  const rawMonths = computeSecurityCushion({
    availableSavings: Math.max(0, i.availableSavings),
    // Base = ce qu'il faut COUVRIR chaque mois, plus le revenu (cf. lib/securityCushion).
    monthlyEssentialExpenses: i.monthlyEssentialExpenses,
    // Sans charge saisie, le total des « essentielles » n'est pas incomplet : il est FAUX dans le
    // sens qui rassure. On lui préfère le revenu, dénominateur prudent.
    recurringExpensesKnown: i.hasRecurringExpenses,
    avgMonthlyIncome: i.avgMonthlyIncome,
  }).months;
  if (rawMonths == null) return 'P0';
  const months = rawMonths;
  /** Barre de matelas / de patrimoine à appliquer, selon le sens du trajet. */
  const M = bounds === 'up' ? cfg.monthsUp : cfg.monthsDown;
  const W = bounds === 'up' ? cfg.wealthUp : cfg.wealthDown;

  // « Investit » = il a réellement placé de l'argent sur un compte d'investissement.
  const invests = i.totalInvested > 0;
  const wealth = i.totalLiquidWealth
    ?? (Math.max(0, i.availableSavings) + Math.max(0, i.totalInvested));

  /* ── QUESTION 1 : LA SITUATION EST-ELLE VIABLE ? ─────────────────────────────────────────────
     Elle passe AVANT tout le reste : tant que ce qui sort dépasse ce qui rentre, aucun palier de
     réserve ni de patrimoine ne décrit correctement la situation — le compte se vide, et c'est la
     seule chose à dire.
     UNE SEULE DISPENSE, et elle est délibérée : une réserve profonde (`viabilityGraceMonths`).
     Quelqu'un qui consomme volontairement deux ans d'épargne — sabbatique, transition, création
     d'entreprise, retraite anticipée — n'est pas « fragile » ce mois-ci. Sans cette dispense, l'app
     servirait son diagnostic le plus dur à des gens qui maîtrisent parfaitement leur trajectoire. */
  if (months < cfg.viabilityGraceMonths && hasStructuralDeficit(i, cfg, bounds)) return 'P1';

  /* ── QUESTIONS 3 ET 4 : PLACEMENTS, PUIS TAILLE DU PATRIMOINE (P7 → P9) ──────────────────────
     LE MONTANT SEUL NE SUFFIT PAS, et c'est délibéré. Un capital hérité, posé sur un livret, chez
     quelqu'un qui finit ses mois à découvert, n'est pas une « maturité financière » — lui servir
     des conseils d'optimisation patrimoniale serait à côté du sujet, et vaguement insultant.
     Deux conditions cumulatives, en plus du montant :
       • la RÉSERVE PLEINE (même exigence que P5/P6, cf. `wealthMinMonths`) — sans quoi un palier
         « supérieur » serait moins exigeant que ceux qu'il surplombe ;
       • de l'argent RÉELLEMENT PLACÉ — c'est le geste qui distingue un patrimoine piloté d'un
         capital qui dort.
     À défaut, on redescend sur l'échelle du matelas — exactement le conseil dont cette personne a
     besoin. Le patrimoine reste donc un indicateur, jamais un laissez-passer. */
  if (invests) {
    if (months >= cfg.wealthMinMonths.P9 && wealth >= W.P9) return 'P9';
    if (months >= cfg.wealthMinMonths.P8 && wealth >= W.P8) return 'P8';
    if (months >= cfg.wealthMinMonths.P7 && wealth >= W.P7) return 'P7';
  }

  /* ── QUESTION 2 : COMBIEN DE TEMPS TIENT-IL ? (P2 → P6) ──────────────────────────────────────
     Une seule mesure, quatre paliers, aucune condition annexe. C'est ce qui rend l'échelle
     prévisible : à matelas égal, deux utilisateurs sont au même endroit — quoi qu'ils fassent par
     ailleurs, et quelle que soit la façon dont ils saisissent leur épargne. */
  if (months >= M.P6 && invests) return 'P6';   // réserve faite ET passage à l'investissement acquis
  if (months >= M.P5) return 'P5';              // réserve faite, encore tout en liquide
  if (months >= M.P4) return 'P4';              // 3 à 6 mois
  if (months >= M.P3) return 'P3';              // 1 à 3 mois
  return 'P2';                                  // viable, mais moins d'un mois devant soi
}

/**
 * ── PROFIL VIVANT : ÉVALUÉ EN TEMPS RÉEL, PAS UNE FOIS PAR MOIS ────────────────────────────────
 *
 * Le profil décrit une SITUATION. Quand la situation change — on ajoute son épargne, on solde un
 * crédit, on encaisse une prime — le profil doit suivre tout de suite : attendre le 1er du mois
 * suivant, c'est afficher un diagnostic dont on sait déjà qu'il est faux.
 *
 * Le risque d'une évaluation continue est le CLIGNOTEMENT : à 5,99 puis 6,01 mois de réserve, le
 * profil basculerait d'avant en arrière à chaque saisie. On ne le règle pas en ralentissant
 * l'évaluation (c'est ce que faisait la cadence mensuelle, au prix de la justesse) mais par une
 * HYSTÉRÉSIS : le seuil n'est pas au même endroit selon le sens du trajet.
 *
 *   • pour MONTER, la réserve doit dépasser le seuil d'une marge (on évalue à 85 % de sa valeur) ;
 *   • pour DESCENDRE, elle doit passer sous le seuil d'autant (on évalue à 115 %).
 *
 * Entre les deux, on ne bouge pas. Un aller-retour autour d'un seuil ne produit donc aucun
 * changement, alors qu'une vraie évolution en produit un immédiatement.
 *
 * Deux cas passent sans marge, parce qu'ils ne sont pas des franchissements de seuil :
 *   • QUITTER P0 (Découverte) — ce n'est pas un palier mais une absence de données ; dès qu'on en a,
 *     on classe ;
 *   • y RETOURNER — les données ont disparu (plus de revenu constaté), il n'y a plus rien à mesurer.
 */
export interface LiveProfileResult {
  profileId: FinancialProfileId;
  changed: boolean;
  direction: 'up' | 'down' | null;
  /** Nombre de paliers franchis (1 = passage voisin). Sert à choisir le bon message. */
  steps: number;
}

const rankOf = (id: FinancialProfileId): number => FINANCIAL_PROFILE_IDS.indexOf(id);

export function resolveLiveProfile(
  current: FinancialProfileId | null | undefined,
  inputs: ProfileDataInputs,
  cfg: ProfileThresholds = DEFAULT_PROFILE_THRESHOLDS,
): LiveProfileResult {
  const from = current && FINANCIAL_PROFILE_IDS.includes(current) ? current : null;

  /* Deux lectures des MÊMES données, avec deux barres :
       • `withUp`   applique les seuils de MONTÉE — le palier qu'on mérite pour progresser ;
       • `withDown` applique les seuils de DESCENTE — celui sous lequel on est vraiment retombé.
     Entre les deux, on ne bouge pas : c'est la bande d'hystérésis, réglée palier par palier depuis
     l'administration plutôt que par un pourcentage unique appliqué au matelas. */
  const withUp = computeProfileFromData(inputs, cfg, 'up');
  const withDown = computeProfileFromData(inputs, cfg, 'down');

  if (!from) return { profileId: withUp, changed: true, direction: null, steps: 0 };

  // Entrée et sortie de Découverte : immédiates, sans bande — ce n'est pas un franchissement de
  // seuil mais l'arrivée ou la disparition des données (cf. en-tête).
  if (from === 'P0' || withUp === 'P0' || withDown === 'P0') {
    const target = withUp === 'P0' || withDown === 'P0' ? 'P0' : withUp;
    if (target === from) return { profileId: from, changed: false, direction: null, steps: 0 };
    return {
      profileId: target, changed: true,
      direction: rankOf(target) > rankOf(from) ? 'up' : 'down',
      steps: Math.abs(rankOf(target) - rankOf(from)),
    };
  }

  if (rankOf(withUp) > rankOf(from)) {
    return { profileId: withUp, changed: true, direction: 'up', steps: rankOf(withUp) - rankOf(from) };
  }
  if (rankOf(withDown) < rankOf(from)) {
    return { profileId: withDown, changed: true, direction: 'down', steps: rankOf(from) - rankOf(withDown) };
  }
  return { profileId: from, changed: false, direction: null, steps: 0 };
}

/** L'utilisateur dépasse-t-il le million sur ses comptes suivis ? (pour le NOMMER, cf. P9) */
export function isMillionaire(totalLiquidWealth: number): boolean {
  return totalLiquidWealth >= MILLIONAIRE_THRESHOLD;
}

/* ── CE QUI A ÉTÉ RETIRÉ ICI, ET POURQUOI ────────────────────────────────────────────────────────
   • `computeInitialProfile` : le profil déduit des NEUF RÉPONSES du questionnaire d'accueil. Ce
     questionnaire n'existe plus (le profil se déduit des données réelles), la fonction n'était plus
     appelée nulle part — et elle rendait un palier calculé avec des règles que la cascade ci-dessus
     contredit. Du code mort qui donne une SECONDE réponse à la question « quel est mon profil ? »
     est pire que pas de code du tout : il finit par être rebranché.
   • `computeMonthlyMetrics`, `MonthlyMetrics`, `RawTransaction` : ils ne servaient plus qu'à
     mesurer le TAUX D'ÉPARGNE, retiré du classement (cf. l'en-tête). Leur seul appelant les a donc
     perdus avec lui — et avec eux une passe complète de transformation des transactions à chaque
     recalcul de profil.
   Le revenu de référence, lui, vit dans lib/finance/incomeAverage : une seule mesure pour toute
   l'app, c'était déjà la règle. */


/* `MatrixConfig` a été retiré avec le moteur mensuel qui l'utilisait. La forme des lignes de
   `profile_matrix_config` telle que le moteur la LIT est décrite par `MatrixRow` (plus haut), qui
   n'expose que les colonnes réellement consommées — deux descriptions de la même table finissaient
   toujours par diverger. L'écran d'administration, lui, lit le type de la base (ProfileMatrixConfig,
   types/database) : c'est le bon niveau pour un formulaire d'édition. */


/**
 * Toutes les clés de transition, du bas vers le haut (P1_P2 … P8_P9). Elles nomment les SEUILS
 * (`profile_matrix_config`) et les MESSAGES (`profile_notification_messages`) — l'administration et
 * les seeds s'en servent. Générées plutôt qu'écrites à la main : à dix paliers, une table littérale
 * de dix-huit clés se serait désynchronisée au premier ajout de profil.
 *
 * P0 (Découverte) n'en a aucune : on n'en « monte » pas, on en SORT dès qu'une donnée réelle arrive.
 */
export const PROFILE_TRANSITION_KEYS: string[] = RANKED_PROFILE_IDS
  .slice(0, -1)
  .map((id, idx) => `${id}_${RANKED_PROFILE_IDS[idx + 1]}`);
