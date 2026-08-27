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
//   2. le PATRIMOINE BANCAIRE (épargne + investissement) — il gouverne P7 à P9. Le solde COURANT en
//      est exclu : c'est la trésorerie du mois, pas un patrimoine.
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
//   3. investit-il RÉELLEMENT ?                montant placé ≥ 500 €                → P6
//   4. quelle est la taille du patrimoine ?    30k / 100k / 300k (hors courant),    → P7 … P9
//                                              dont ≥ 10 % réellement placés
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
 *   3 → le patrimoine EXCLUT le solde courant (c'est de la trésorerie, pas un patrimoine), et les
 *       seuils de réserve des paliers hauts et de la dispense de viabilité gagnent leur bande
 *       d'hystérésis. Les deux déplacent réellement des gens : sans ce numéro, chacun d'eux
 *       recevrait « ton profil a changé » pour une décision qu'il n'a pas prise.
 *   4 → « investir » cesse d'être un booléen à un euro : un MONTANT minimal ouvre P6
 *       (`investedMin`), et les paliers de patrimoine exigent en plus qu'une PART du patrimoine
 *       soit réellement placée (`wealthInvestedShare`). Avant, 1 € posé sur un compte
 *       d'investissement faisait passer de P5 à P8 quelqu'un qui a 100 000 € sur un livret — trois
 *       paliers et une répartition renversée pour un euro.
 */
export const PROFILE_LADDER_VERSION = 4;

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

/* ── LES LIBELLÉS DISENT LE CRITÈRE, ET LA DESCRIPTION NE PROMET QUE CE QUI EST RECOMMANDÉ ───────
 *
 * Deux règles, tirées de deux incohérences réelles :
 *
 *  1. LE NOM NOMME LE CRITÈRE DE BASCULE, pas une ambiance. « Premiers repères » (P2) évoquait un
 *     début de parcours — c'est le rôle de P0 — alors que le critère est « tu tiens le mois, mais
 *     tu as moins d'un mois devant toi ». Et « Premiers placements » (P6) laissait croire que
 *     l'investissement commence là, alors que c'est en P5 que l'app le propose pour la première
 *     fois : P6 CONSTATE que le geste a été fait. Un nom qui décrit autre chose que son critère
 *     rend l'échelle inexplicable — et c'est précisément ce qu'on demande à un profil d'être.
 *
 *  2. LA DESCRIPTION NE CONTREDIT JAMAIS LA RÉPARTITION affichée trois lignes plus bas. « Continuer
 *     à empiler du liquide ne rapporte plus rien » (P5) se lisait au-dessus d'un « Épargner 50 % ».
 *     Le NOM et le tier viennent du critère, jamais des pourcentages : ceux-ci se règlent en
 *     administration et peuvent changer sans livraison (cf. `profile_allocations`). La description,
 *     elle, dit la SITUATION et l'OBJECTIF — jamais un pourcentage, jamais un geste que la
 *     répartition du palier n'appuie pas.
 *
 * Le `tier` ne redouble plus le `name` : les deux sont affichés l'un sous l'autre (fenêtre de
 * changement de profil, simulateur d'administration), et lire deux fois la même chose n'apprend rien.
 */
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
    /* Pas « Découverte » une seconde fois : le tier est affiché SOUS le nom. Et surtout, il doit
       dire que ce palier n'en est pas un — c'est une absence de données, pas un rang. */
    tier: 'Pas encore classé',
    /* Pas de « sans questionnaire » : il n'y en a pas, donc l'utilisateur n'a aucune raison d'y
       penser. On ne rassure pas sur une contrainte qui n'existe pas — on dit quoi faire. */
    description: 'On apprend à te connaître. Ajoute tes comptes et tes rentrées d\'argent : ton profil se calculera tout seul.',
    color: '#94a3b8',
  },
  P1: {
    name: 'Fragile',
    emoji: '🌧️',
    tier: 'Situation à rétablir',
    /* « Tout le reste attend » a été retiré : la répartition de P1 met une part importante de côté
       (c'est ce qui permet de sortir du cycle), et annoncer le contraire juste au-dessus se voyait. */
    description: 'Ce qui sort dépasse ce qui rentre : le mois ne peut pas se boucler tout seul. Une seule priorité, remettre l\'équation à l\'endroit — rien n\'est engagé ailleurs en attendant.',
    color: '#dc2626',
  },
  P2: {
    /* « Premiers repères » évoquait un début de parcours — c'est P0. Le critère de P2, c'est
       l'absence de réserve chez quelqu'un dont le mois, lui, se boucle. */
    name: 'Sans filet',
    emoji: '🌱',
    tier: 'Réserve à constituer',
    description: 'Tu tiens le mois, mais sans filet : moins d\'un mois de dépenses de côté. Tout l\'effort va à ce premier mois de réserve.',
    color: '#ef4444',
  },
  P3: {
    /* « à construire » disait qu'il n'y a rien — c'est P2. Ici le filet EXISTE, il est mince. */
    name: 'Réserve en construction',
    emoji: '🌿',
    tier: 'Épargne à renforcer',
    description: 'Un à trois mois de dépenses de côté : le filet existe. L\'effort reste sur la réserve, jusqu\'à trois mois puis six.',
    color: '#f59e0b',
  },
  P4: {
    name: 'Équilibre trouvé',
    emoji: '⚖️',
    tier: 'Stabilité',
    /* L'« épargne régulière » ne classe plus depuis le retrait du taux d'épargne : la promettre
       ici décrivait un critère qui n'existe plus. Et « faire travailler ce qui dépasse » annonçait
       de l'investissement à un palier où la répartition n'en recommande pas encore. */
    description: 'Trois à six mois de dépenses de côté : ta situation est stable. Dernière ligne droite avant six mois — l\'investissement vient ensuite.',
    color: '#3b82f6',
  },
  P5: {
    name: 'Sécurité acquise',
    emoji: '🛡️',
    tier: 'Prêt à investir',
    /* C'EST ICI que l'investissement apparaît dans les recommandations, pas en P6 : P6 constate
       qu'il a eu lieu. La description doit donc porter l'invitation, sans prétendre que l'épargne
       n'a plus d'intérêt — la répartition du palier continue d'en recommander. */
    description: 'Plus de six mois de dépenses couverts : ton matelas est fait. Tu peux commencer à en placer une part, sans toucher à ta réserve.',
    color: '#0ea5e9',
  },
  P6: {
    /* « Premiers placements » laissait croire que l'investissement COMMENCE ici — il commence en
       P5, où l'app le propose. Ce palier constate que le geste est fait : c'est son seul critère. */
    name: 'Placements lancés',
    emoji: '🌍',
    tier: 'Investisseur débutant',
    /* Pas de promesse de « régularité » : rien ne la mesure depuis le retrait du taux d'épargne. */
    description: 'Réserve solide et argent réellement placé. L\'investissement peut désormais prendre le pas sur l\'épargne de précaution.',
    color: '#8b5cf6',
  },
  P7: {
    name: 'Patrimoine en construction',
    emoji: '🚀',
    tier: 'Investisseur confirmé',
    description: 'Le patrimoine sur tes comptes dépasse 30 000 €, et une vraie part est placée. L\'épargne de précaution étant pleine, l\'essentiel de ce qui dépasse part à l\'investissement.',
    color: '#a855f7',
  },
  P8: {
    name: 'Patrimoine établi',
    emoji: '🏛️',
    tier: 'Faire fructifier',
    description: 'Au-delà de 100 000 € sur tes comptes : une minorité de la population. L\'objectif n\'est plus d\'accumuler du liquide mais de faire fructifier ce qui est déjà là.',
    color: '#22c55e',
  },
  P9: {
    name: 'Patrimoine d\'exception',
    emoji: '💎',
    tier: 'Optimisation patrimoniale',
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
 *
 * ⚠️ CE N'EST PAS LA TABLE QUI S'APPLIQUE : c'est le REPLI. Ce qui s'applique vient de
 * `profile_allocations` (administration, migration 207), lue à chaque calcul. Ces valeurs ne
 * servent qu'au démarrage à froid, hors-ligne, ou si la lecture échoue.
 *
 * Elles sont donc RECOPIÉES de la table d'administration (état du 2026-08-27) et doivent le rester.
 * Un repli qui dit autre chose que la table appliquée, c'est un utilisateur hors-ligne à qui l'on
 * répartit son Relyka autrement que la veille, sans que rien ne l'explique — exactement ce que
 * `DEFAULT_PROFILE_THRESHOLDS` évite déjà pour les seuils.
 *
 * LA DOCTRINE QUE CES CHIFFRES PORTENT : aucun investissement recommandé tant que la réserve n'est
 * pas pleine (P0–P4 à 0 %), une première part placée dès que le matelas est fait (P5), puis
 * l'investissement qui prend le dessus. Les descriptions de `PROFILE_INFO` disent la même chose —
 * si l'une des deux bouge, l'autre doit suivre.
 */
export const PROFILE_ALLOCATIONS: Record<FinancialProfileId, {
  save: number; invest: number; enjoy: number; keep: number;
}> = {
  // Rien n'est mesuré : on ne pousse pas à investir, on met de côté et on garde.
  P0: { save: 60, invest:  0, enjoy: 10, keep: 30 },
  // Déficitaire : le liquide est vital. Épargner quand même — sinon on ne sort jamais du cycle.
  P1: { save: 40, invest:  0, enjoy: 10, keep: 50 },
  P2: { save: 55, invest:  0, enjoy: 10, keep: 35 },
  P3: { save: 50, invest:  0, enjoy: 15, keep: 35 },
  P4: { save: 50, invest:  0, enjoy: 20, keep: 30 },
  // Matelas fait : la première part placée apparaît ICI (cf. le nom de P5, « Prêt à investir »).
  P5: { save: 50, invest: 10, enjoy: 20, keep: 20 },
  P6: { save: 20, invest: 40, enjoy: 20, keep: 20 },
  P7: { save: 10, invest: 60, enjoy: 15, keep: 15 },
  P8: { save:  0, invest: 70, enjoy: 15, keep: 15 },
  P9: { save:  0, invest: 80, enjoy: 10, keep: 10 },
};

/** Une ligne de `profile_allocations` (réglage admin), telle qu'elle arrive de la base. */
export interface ProfileAllocationRow {
  profile_id: string;
  save_percent?: number | null;
  invest_percent?: number | null;
  enjoy_percent?: number | null;
  keep_percent?: number | null;
}

/**
 * La table de répartition RÉELLEMENT appliquée : celle de l'administration, complétée par le code.
 *
 * Le repli est PALIER PAR PALIER, comme pour les seuils : une ligne absente, une valeur illisible ou
 * une somme qui ne fait pas 100 laissent ce palier sur sa valeur d'origine, sans emporter les neuf
 * autres. C'est ce qui permet de régler l'échelle progressivement — et ce qui garantit qu'un
 * incident de lecture ne distribue jamais un Relyka faux.
 *
 * ⚠️ La somme est vérifiée ICI en plus de la contrainte en base : les pourcentages traversent aussi
 * un cache hors-ligne, et une répartition à 97 % répartirait un Relyka amputé de 3 % sans que rien
 * ne le signale.
 */
export function allocationsFromRows(
  rows: ProfileAllocationRow[] | null | undefined,
): Record<FinancialProfileId, { save: number; invest: number; enjoy: number; keep: number }> {
  const out = { ...PROFILE_ALLOCATIONS };
  for (const row of rows ?? []) {
    const id = row?.profile_id as FinancialProfileId;
    if (!KNOWN_PROFILE_IDS.has(id)) continue;
    const save = Number(row.save_percent);
    const invest = Number(row.invest_percent);
    const enjoy = Number(row.enjoy_percent);
    const keep = Number(row.keep_percent);
    if (![save, invest, enjoy, keep].every((n) => Number.isFinite(n) && n >= 0)) continue;
    if (save + invest + enjoy + keep !== 100) continue;
    out[id] = { save, invest, enjoy, keep };
  }
  return out;
}

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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   LE VOCABULAIRE DU QUESTIONNAIRE A ÉTÉ RETIRÉ D'ICI
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Il ne reste plus rien du questionnaire d'accueil : ni l'écran, ni le moteur qui en tirait un
   profil. Sont donc partis avec lui les sept listes d'options (Q1 à Q7), les jeux de réponses qui
   les interprétaient (Q4_INVEST, Q6_HIGH…), `detectIrregularIncome`, `NEUTRAL_ANSWERS`,
   `estimateWeeklyVariable`, `q3FromMonthlyIncome` et `safetyMarginFromQ8` — plus aucun appelant,
   aucun test, aucun écran.

   Ce n'était pas seulement du code mort. C'était le VOCABULAIRE d'un second système de classement,
   avec ses propres tranches de revenu et ses propres seuils, à côté d'une cascade qui se déduit
   désormais des seules données mesurées. Ce genre de vestige finit toujours par être rebranché « vu
   qu'il est déjà là », et l'app se retrouve avec deux réponses à la question « quel est mon
   profil ? ».

   CE QUI SURVIT, ET POURQUOI :
     • `weeklyVariableFromQ9` + `WEEKS_PER_MONTH` — l'estimation de dépenses variables est toujours
       saisie (page Profil, guide de démarrage) et stockée dans la colonne `q9` ;
   Le repli du matelas sur la tranche de revenu DÉCLARÉE (q3) est parti lui aussi : il ne servait
   que quand aucun revenu n'est constaté — c'est-à-dire le seul cas où le classement, lui, refuse de
   conclure et rend « Découverte ». Deux réponses à la même question, dont une tirée d'une case
   cochée il y a deux ans (cf. lib/finance/securityCushion).
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * La SEULE réponse encore lue quelque part. Les autres colonnes existent toujours en base — l'export
 * de données les restitue, l'utilisateur a le droit de voir ce qu'on détient — mais plus aucun calcul
 * ne s'en sert.
 */
export interface QuestionnaireAnswers {
  /** Estimation hebdomadaire des dépenses variables (€/semaine). Chaîne numérique ou '' (→ 0). */
  q9: string;
}

/** Montant hebdomadaire variable (€/semaine) → nombre. '' → 0. Alimente l'enveloppe variable. */
export function weeklyVariableFromQ9(q9: string): number {
  if (!q9) return 0;
  const v = parseFloat(q9.replace(',', '.'));
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Facteur de conversion hebdomadaire → mensuel (52 semaines / 12 mois). */
export const WEEKS_PER_MONTH = 4.33;

// ── Calcul du profil initial ──────────────────────────────────

/* ── LE PROFIL, À PARTIR DES SEULES DONNÉES RÉELLES ────────────────────────────────────────────
 *
 * Plus aucune réponse déclarée n'entre dans le calcul : ni questionnaire d'accueil, ni « micro-
 * questions ». Tout vient de ce que l'utilisateur a réellement saisi — comptes, revenus, charges.
 * Tant qu'il manque le revenu, le palier est P0 « Découverte » : on dit qu'on ne sait pas, on ne
 * classe pas d'office.
 *
 * ⚠️ Ce bloc décrivait encore l'ANCIENNE matrice (« mois de sécurité × taux d'épargne ×
 * comportement d'investissement », traduite question par question depuis q4/q5/q6) et annonçait un
 * repli en P1. Les trois sont faux depuis la refonte : le taux d'épargne est sorti du classement,
 * le questionnaire n'existe plus, et le repli est P0. Une description périmée d'un calcul financier
 * est plus dangereuse qu'une absence de description : on finit par coder d'après elle.
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
  /* ⚠️ `totalLiquidWealth` A ÉTÉ RETIRÉ DES ENTRÉES. Le patrimoine se DÉDUIT désormais, toujours de
     la même façon : épargne + placements, et rien d'autre.
     Il incluait le solde COURANT — c'est-à-dire l'argent du mois en cours, celui qui va servir au
     loyer et aux courses. Compté comme patrimoine, il faisait entrer en « Patrimoine en
     construction » quelqu'un qui venait simplement d'être payé, et l'en faisait ressortir trois
     semaines plus tard. Un solde courant n'est pas un patrimoine : c'est de la trésorerie.
     C'est aussi la définition qu'employait déjà la priorité du mois (« Faire travailler ton
     patrimoine ») : les deux seuils de 100 000 € comptaient deux choses différentes. */
  /**
   * Dépenses ESSENTIELLES mensuelles (charges récurrentes + enveloppe variable). C'est la base du
   * matelas de sécurité : « combien de temps je tiens » se mesure sur ce qui SORT, pas sur ce qui
   * rentrait (cf. lib/securityCushion). Absent → repli sur le revenu.
   */
  monthlyEssentialExpenses?: number;
}

/* ⚠️ `WEALTH_THRESHOLDS` et `MILLIONAIRE_THRESHOLD` ONT ÉTÉ RETIRÉS. Le premier se disait
   « conservé exporté, l'administration s'en sert comme repères d'affichage » — elle ne l'a jamais
   lu, et les vraies valeurs vivent dans `DEFAULT_PROFILE_THRESHOLDS` (elles-mêmes remplaçables par
   `profile_matrix_config`). Deux tables de seuils dont une seule décide, c'est la garantie qu'on
   recalibrera un jour celle qui ne sert à rien. Le second n'alimentait que `isMillionaire`, appelée
   par un test et par personne d'autre : le million reste une phrase dans la description de P9, pas
   un calcul. */

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
  /** Réserve minimale exigée EN PLUS du montant, pour chaque palier de patrimoine (MONTÉE). */
  wealthMinMonths: { P7: number; P8: number; P9: number };
  /**
   * Réserve sous laquelle on QUITTE un palier de patrimoine. C'était le dernier seuil de l'échelle
   * sans bande d'hystérésis : la même valeur servait à monter et à descendre, si bien qu'un
   * patrimoine constitué dont la réserve oscille autour de six mois — l'enveloppe de dépenses
   * variables bouge à chaque saisie — basculait P6 ⇄ P7 d'une opération à l'autre, avec une
   * notification « ton profil a changé » à chaque passage. Exactement ce que l'hystérésis existe
   * pour empêcher, sur le seul palier qui en était privé.
   */
  wealthMinMonthsDown: { P7: number; P8: number; P9: number };
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
  /**
   * Réserve sous laquelle la dispense CESSE — l'autre moitié de la bande.
   *
   * C'était le dernier seuil de l'échelle à n'avoir qu'une seule valeur, et le pire endroit où le
   * laisser : quelqu'un en déficit qui vit sur son épargne voit son matelas bouger à chaque saisie
   * (l'enveloppe de dépenses variables est au dénominateur). À 5,95 puis 6,05 mois, il basculait
   * « Fragile » ⇄ « Sécurité acquise » — quatre paliers d'un coup, dans les deux sens, avec une
   * fenêtre à chaque passage. C'est le diagnostic le plus dur de l'app : il ne peut pas clignoter.
   */
  viabilityGraceMonthsDown: number;
  /**
   * MONTANT RÉELLEMENT PLACÉ à partir duquel on considère que la personne INVESTIT (ouvre P6).
   *
   * « Investit » était un booléen à un euro (`totalInvested > 0`). C'était la seule falaise de
   * l'échelle : avec six mois de réserve et 100 000 € sur un livret, poser UN EURO sur un compte
   * d'investissement faisait passer de P5 à P8 — trois paliers, et une répartition qui bascule de
   * « Épargner 50 % » à « Investir 70 % ». Pour un euro.
   *
   * Bande comme partout : `investedMinUp` pour franchir, `investedMinDown` pour se maintenir — la
   * valeur d'un portefeuille bouge toute seule avec les marchés, elle ne doit pas faire clignoter
   * un palier.
   */
  investedMinUp: number;
  investedMinDown: number;
  /**
   * PART DU PATRIMOINE réellement placée, exigée EN PLUS par les paliers de patrimoine (P7 → P9).
   *
   * Le montant seul ne suffisait déjà pas (il faut la réserve pleine ET des placements) — mais
   * « des placements » se contentait d'un jeton. Or ces paliers prétendent décrire un patrimoine
   * PILOTÉ : 500 € placés sur 300 000 € qui dorment, ce n'est pas un patrimoine piloté, et lui
   * servir des conseils d'optimisation serait à côté du sujet. À 0, la part n'est pas exigée.
   */
  wealthInvestedShareUp: number;
  wealthInvestedShareDown: number;
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
  /* Même bande que P5/P6 (6 pour monter, 5 pour redescendre) : la chaîne des paliers reste
     cohérente de bout en bout, et un mois de dépenses variables un peu plus lourd ne fait plus
     changer de palier quelqu'un dont le patrimoine n'a pas bougé d'un euro. */
  wealthMinMonthsDown: { P7: 5, P8: 5, P9: 5 },
  chronicOverdraftMonths: CHRONIC_OVERDRAFT_MONTHS,
  /* 95 % / 102 % : il faut une vraie marge pour être déclaré viable, un vrai écart pour ne plus
     l'être. Entre les deux — la zone où le revenu et les charges se frôlent — personne ne bouge. */
  viabilityExitRatio: 0.95,
  viabilityEnterRatio: 1.02,
  viabilityGraceMonths: 6,
  /* Même bande que partout ailleurs (6 pour bénéficier de la dispense, 5 pour la perdre) : un mois
     de dépenses un peu plus lourd ne fait plus basculer quelqu'un en « Fragile ».
     ⚠️ Cette valeur est lue dans la colonne de DESCENTE de la ligne P1_P2. La migration 209 devait
     l'y semer mais se gardait par `IS NULL` — or la 020 y avait laissé 0,5 (un seuil de matelas de
     l'échelle d'alors). Le repli était donc juste et la base fausse, ce qui est le pire des deux
     mondes : les tests passaient. Corrigé par la migration 216. */
  viabilityGraceMonthsDown: 5,
  /* 500 € : assez pour qu'un compte d'investissement ouvert « pour voir » ne fasse pas changer de
     palier, assez bas pour qu'un premier vrai versement compte tout de suite. 250 € pour se
     maintenir : un portefeuille qui perd 20 % ne doit pas coûter un palier. */
  investedMinUp: 500,
  investedMinDown: 250,
  /* 10 % du patrimoine placé pour ENTRER dans les paliers de patrimoine, 5 % pour s'y maintenir.
     C'est bas volontairement : il s'agit de distinguer un patrimoine piloté d'un capital qui dort,
     pas d'imposer une allocation. */
  wealthInvestedShareUp: 0.10,
  wealthInvestedShareDown: 0.05,
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
  /* Part du patrimoine réellement placée (ligne P6_P7 uniquement) — cf. `ProfileThresholds`. */
  invested_share_up?: number | null;
  invested_share_down?: number | null;
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
    /* La colonne existait déjà (`downgrade_months_threshold`) mais n'était lue que pour les paliers
       de matelas : les trois lignes de patrimoine la laissaient vide, et le moteur réutilisait le
       seuil de MONTÉE pour redescendre — d'où le clignotement P6 ⇄ P7. Vide → repli sur la bande
       par défaut, jamais sur le seuil de montée. */
    wealthMinMonthsDown: {
      P7: down('P6_P7', D.wealthMinMonthsDown.P7),
      P8: down('P7_P8', D.wealthMinMonthsDown.P8),
      P9: down('P8_P9', D.wealthMinMonthsDown.P9),
    },
    chronicOverdraftMonths: num(
      by.get('P1_P2')?.chronic_overdraft_months, D.chronicOverdraftMonths,
    ),
    /* La viabilité est portée par la ligne P1_P2 : c'est elle qui gouverne l'entrée et la sortie du
       palier « Fragile ». Trois réglages au même endroit, plutôt qu'un ratio codé en dur. */
    viabilityExitRatio: num(by.get('P1_P2')?.viability_exit_ratio, D.viabilityExitRatio),
    viabilityEnterRatio: num(by.get('P1_P2')?.viability_enter_ratio, D.viabilityEnterRatio),
    viabilityGraceMonths: num(by.get('P1_P2')?.viability_grace_months, D.viabilityGraceMonths),
    /* Portée par la colonne de DESCENTE de la ligne P1_P2 : ses colonnes « mois » n'étaient lues par
       personne (l'échelle du matelas commence à P2_P3), et c'est bien la ligne de la viabilité. */
    viabilityGraceMonthsDown: down('P1_P2', D.viabilityGraceMonthsDown),
    /* MONTANT PLACÉ MINIMAL — porté par les colonnes « patrimoine » de la ligne P5_P6, qui est
       justement le passage « il investit ». Ces deux colonnes n'étaient lues par personne sur cette
       ligne (les paliers de patrimoine commencent à P6_P7) : elles avaient donc un sens libre, et
       c'est le bon. */
    investedMinUp: num(by.get('P5_P6')?.upgrade_wealth_threshold, D.investedMinUp),
    investedMinDown: num(by.get('P5_P6')?.downgrade_wealth_threshold, D.investedMinDown),
    /* PART PLACÉE — portée par la ligne P6_P7, la première des trois lignes de patrimoine, et lue
       une seule fois pour les trois (comme `chronic_overdraft_months` l'est sur P1_P2). */
    wealthInvestedShareUp: num(by.get('P6_P7')?.invested_share_up, D.wealthInvestedShareUp),
    wealthInvestedShareDown: num(by.get('P6_P7')?.invested_share_down, D.wealthInvestedShareDown),
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
  /* ⚠️ MÊME GARDE QUE LE MATELAS, ET C'EST UNE CORRECTION.
     Sans charge récurrente saisie, les « dépenses essentielles » se réduisent à l'enveloppe
     variable : `computeSecurityCushion` REFUSE alors de diviser par elles (le total est amputé du
     loyer). Ce test-ci, lui, s'en servait quand même — donc le même chiffre était jugé trop
     incertain pour mesurer une réserve, mais assez sûr pour déclarer quelqu'un « Fragile ». Une
     enveloppe variable déclarée un peu haute suffisait à servir le diagnostic le plus dur de l'app
     à quelqu'un dont l'app ignore encore le loyer — et donc les charges réelles. */
  const expensesUsable = i.hasRecurringExpenses && essentials > 0;
  if (expensesUsable && i.avgMonthlyIncome > 0 && essentials > i.avgMonthlyIncome * ratio) return true;

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

  /* « Investit » = il a placé un MONTANT qui compte, pas un euro symbolique (cf. `investedMinUp` :
     un euro faisait passer de P5 à P8 quelqu'un qui a 100 000 € sur un livret). Le seuil suit le
     sens du trajet, comme tout le reste — la valeur d'un portefeuille bouge toute seule. */
  const investedMin = bounds === 'up' ? cfg.investedMinUp : cfg.investedMinDown;
  const invested = Math.max(0, i.totalInvested);
  const invests = invested > 0 && invested >= investedMin;
  /* PATRIMOINE = épargne + placements. Le solde COURANT en est exclu : c'est la trésorerie du mois,
     pas un patrimoine. L'inclure faisait entrer en « Patrimoine en construction » quelqu'un qui
     venait d'être payé, et l'en faisait ressortir trois semaines plus tard. */
  const wealth = Math.max(0, i.availableSavings) + invested;
  /* PATRIMOINE PILOTÉ : le montant placé doit peser une PART du patrimoine. Les paliers P7 à P9
     prétendent décrire quelqu'un qui pilote ce qu'il a — 500 € placés sur 300 000 € qui dorment ne
     décrivent pas ça, et les conseils d'optimisation qui vont avec tomberaient à côté. */
  const investedShare = bounds === 'up' ? cfg.wealthInvestedShareUp : cfg.wealthInvestedShareDown;
  const pilotsWealth = invests && (investedShare <= 0 || invested >= wealth * investedShare);

  /* ── QUESTION 1 : LA SITUATION EST-ELLE VIABLE ? ─────────────────────────────────────────────
     Elle passe AVANT tout le reste : tant que ce qui sort dépasse ce qui rentre, aucun palier de
     réserve ni de patrimoine ne décrit correctement la situation — le compte se vide, et c'est la
     seule chose à dire.
     UNE SEULE DISPENSE, et elle est délibérée : une réserve profonde (`viabilityGraceMonths`).
     Quelqu'un qui consomme volontairement deux ans d'épargne — sabbatique, transition, création
     d'entreprise, retraite anticipée — n'est pas « fragile » ce mois-ci. Sans cette dispense, l'app
     servirait son diagnostic le plus dur à des gens qui maîtrisent parfaitement leur trajectoire. */
  /* La DISPENSE suit le sens du trajet, comme tous les autres seuils : il faut plus de réserve pour
     l'obtenir que pour la garder. Sans cette bande, « Fragile » ⇄ « Sécurité acquise » clignotait à
     chaque saisie chez quelqu'un qui vit sur son épargne — quatre paliers, dans les deux sens. */
  const grace = bounds === 'up' ? cfg.viabilityGraceMonths : cfg.viabilityGraceMonthsDown;
  if (months < grace && hasStructuralDeficit(i, cfg, bounds)) return 'P1';

  /* ── QUESTIONS 3 ET 4 : PLACEMENTS, PUIS TAILLE DU PATRIMOINE (P7 → P9) ──────────────────────
     LE MONTANT SEUL NE SUFFIT PAS, et c'est délibéré. Un capital hérité, posé sur un livret, chez
     quelqu'un qui finit ses mois à découvert, n'est pas une « maturité financière » — lui servir
     des conseils d'optimisation patrimoniale serait à côté du sujet, et vaguement insultant.
     Deux conditions cumulatives, en plus du montant :
       • la RÉSERVE PLEINE (même exigence que P5/P6, cf. `wealthMinMonths`) — sans quoi un palier
         « supérieur » serait moins exigeant que ceux qu'il surplombe ;
       • un patrimoine réellement PILOTÉ — un montant placé qui compte (`investedMin`) ET qui pèse
         une part du patrimoine (`wealthInvestedShare`). « De l'argent placé » se contentait
         auparavant d'un euro : c'était la seule falaise de l'échelle.
     À défaut, on redescend sur l'échelle du matelas — exactement le conseil dont cette personne a
     besoin. Le patrimoine reste donc un indicateur, jamais un laissez-passer. */
  /* La RÉSERVE exigée suit le sens du trajet, comme le montant : `wealthMinMonths` pour monter,
     `wealthMinMonthsDown` pour se maintenir. C'était le seul seuil de l'échelle sans bande — la
     même valeur dans les deux sens faisait basculer P6 ⇄ P7 à chaque saisie chez quelqu'un dont la
     réserve frôle six mois, avec une notification de changement de profil à chaque aller-retour. */
  const WM = bounds === 'up' ? cfg.wealthMinMonths : cfg.wealthMinMonthsDown;
  if (pilotsWealth) {
    if (months >= WM.P9 && wealth >= W.P9) return 'P9';
    if (months >= WM.P8 && wealth >= W.P8) return 'P8';
    if (months >= WM.P7 && wealth >= W.P7) return 'P7';
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
 *   • pour MONTER, on lit les seuils de MONTÉE (exigeants) ;
 *   • pour DESCENDRE, ceux de DESCENTE (indulgents), réglés palier par palier en administration.
 *
 * (Ce n'est plus un pourcentage unique appliqué au matelas — cf. `ProfileThresholds` : on peut
 *  vouloir qu'on monte difficilement en P5 et qu'on en redescende très difficilement, ce qu'un
 *  ratio global ne permet pas d'exprimer.)
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
