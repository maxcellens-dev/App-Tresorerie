/**
 * Moteur de l'arbre : traduit une situation financière en ce que l'arbre MONTRE.
 *
 * Fonction PURE. Elle ne calcule aucune notion financière nouvelle : elle reçoit des valeurs déjà
 * produites par les moteurs existants (matelas de sécurité, comptes, crédits, placements, série,
 * récurrentes, recommandations) et décide seulement de leur dessin. Le rendu (lib/garden/scene3dLayout)
 * ne lit que ce résultat.
 *
 * ── RÈGLES DE LA REFONTE ─────────────────────────────────────────────────────────────────────────
 * - L'arbre ne tombe JAMAIS malade : ni maladie, ni feuilles mortes, ni fruits qui tombent, ni arbre
 *   qui penche. On aide à faire pousser, on ne fait pas peur. Un mois serré se lit dans l'arrosoir
 *   (moins d'eau), rien d'autre.
 * - Chaque élément dessiné correspond à une donnée réelle et nommable :
 *     taille de l'arbre ← épargne de secours + placements ;
 *     racines           ← mois de dépenses couverts par l'épargne de secours (traits 1, 3, 6 mois,
 *                         puis une nappe au-delà de 6 mois : de l'argent qui pourrait être placé) ;
 *     fruits            ← la VALEUR des placements, en mois de dépenses (0 à 6 fruits, puis un
 *                         panier de récolte) ; leur couleur ← la PLUS-VALUE : jeunes sans gain,
 *                         mûrs en gain, dorés quand le gain est important — jamais de branches nues.
 *                         Le nombre de placements n'y entre pas : on ne récompense pas l'éparpillement ;
 *     fleurs            ← le montant « pour te faire plaisir » du mois ;
 *     eau de l'arrosoir ← comptes courants au-dessus du minimum à garder ;
 *     cabane            ← un crédit sain, construite à mesure qu'il est remboursé ; une fois soldé,
 *                         elle est À TOI (fanion sur le toit) et reste dans le jardin ;
 *     ronces            ← un crédit cher (renouvelable, découvert) ;
 *     anneaux           ← la série (ne recule jamais).
 */

export interface GardenCredit {
  id: string;
  /** Sain (immobilier, auto, travaux…) → cabane ; cher (renouvelable, découvert) → ronces. */
  kind: 'healthy' | 'expensive';
  /** Capital restant dû (€). */
  remaining: number;
  /** Capital emprunté au départ (€). 0/absent → avancement inconnu. */
  borrowed?: number;
}

export interface GardenInputs {
  /** Total des comptes courants (€), part de l'utilisateur. */
  currentBalance: number;
  /** Minimum à garder sur les comptes courants (marge de sécurité, €). */
  minimumToKeep: number;
  /** Le Relyka du mois (l'eau libre de l'arrosoir, €). Connu → c'est lui qui remplit l'arrosoir. */
  relyka?: number;
  /** Référence mensuelle du matelas (dépenses essentielles, à défaut revenu) — cf. computeSecurityCushion. */
  monthlyReference: number;
  /** Mois couverts par l'épargne de secours (computeSecurityCushion().months) ; null = inconnu. */
  securityMonths: number | null;
  /** Valeur actuelle des placements (€). */
  investedValue: number;
  /** Total versé sur ces placements (€) : gains = valeur − versements. */
  investedContributed: number;
  /** Nombre de placements (comptes d'investissement non vides). Absent → 1 s'il y a des placements. */
  investmentCount?: number;
  /** Montant « pour te faire plaisir » du mois (reco Confort, €). */
  enjoyThisMonth: number;
  /** Investissement programmé chaque mois (récurrentes vers les placements, €). */
  recurringInvestMonthly: number;
  /** Série en semaines (anneaux). */
  streakWeeks: number;
  credits: GardenCredit[];
}

/**
 * UNE seule cabane pour TOUS les crédits sains (décision produit) : un achat immobilier compte
 * souvent plusieurs prêts, cinq cabanes n'auraient plus rien d'un arbre.
 */
export interface GardenCabin {
  /** Part déjà remboursée de l'ensemble, 0 → 1, pondérée par les montants empruntés. */
  progress: number;
  /** Nombre de crédits sains qu'elle représente (en cours, ou tous soldés). */
  count: number;
  /** Tous ces crédits sont remboursés : la cabane est à toi. */
  owned: boolean;
}

export interface TreeState {
  /** Taille de l'arbre, 0 (pousse) → 1 (grand arbre). */
  growth: number;
  /** Stade nommable (pour les libellés et l'accessibilité). */
  stage: 'sprout' | 'young' | 'tree' | 'fruiting' | 'grand';
  roots: {
    /** Mois de secours (≥ 0) ; 0 quand inconnu. */
    months: number;
    /** Profondeur dessinée, 0 → 1 (1 = trait des 6 mois). */
    depth: number;
    /** Traits franchis. */
    marks: { one: boolean; three: boolean; six: boolean };
    /** Au-delà de 6 mois : la nappe, et combien de mois en plus. */
    beyondSix: boolean;
    extraMonths: number;
  };
  /** Ampleur des placements, 0 → 1 (taille de l'arbre et des fruits). */
  branches: number;
  /** Fruits sur l'arbre (0 à 6), selon la VALEUR des placements en mois de dépenses. */
  fruits: number;
  /** Panier de récolte au pied de l'arbre : dès 12 mois de dépenses placés (petit), 36 mois (grand). */
  harvest: 'none' | 'small' | 'big';
  /** Couleur des fruits (et du panier), selon la PLUS-VALUE — jamais de fruit abîmé. */
  maturity: 'young' | 'ripe' | 'golden';
  /** Raccourci : les placements sont en gain (mûrs ou dorés). */
  ripe: boolean;
  /** Nombre réel de placements (pour les mots, pas pour le dessin). */
  investments: number;
  flowers: number;
  /** Eau de l'arrosoir, 0 → 1 (0 = au minimum à garder ou en dessous : arrosoir vide, sans drame). */
  water: number;
  /** `null` sans crédit sain en cours. */
  cabin: GardenCabin | null;
  /** Densité des ronces, 0 → 1. */
  brambles: number;
  rings: number;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Placements équivalant à 24 mois de dépenses = branches au maximum (grand arbre). */
const BRANCHES_FULL_MONTHS = 24;
/** Crédit cher équivalant à 3 mois de dépenses = ronces au plus dense. */
const BRAMBLES_FULL_MONTHS = 3;
/** Valeur des placements (en mois de dépenses) à partir de laquelle on a 1, 2, 3, 4 puis 6 fruits. */
const FRUIT_STEPS: [number, number][] = [[0, 1], [1, 2], [3, 3], [6, 4], [12, 6]];
/** Panier de récolte : petit puis grand (en mois de dépenses placés). */
const HARVEST_SMALL_MONTHS = 12;
const HARVEST_BIG_MONTHS = 36;
/** Fruits dorés : une plus-value d'au moins 12 mois de dépenses… */
const GOLDEN_GAIN_MONTHS = 12;
/** …ou des placements qui ont DOUBLÉ (gain ≥ versements), dès 3 mois de dépenses de gain. */
const GOLDEN_DOUBLED_MIN_MONTHS = 3;
/** Référence mensuelle de repli quand les dépenses sont encore inconnues (€). */
const FALLBACK_REFERENCE = 2000;

export function computeTreeState(i: GardenInputs): TreeState {
  const ref = pos(i.monthlyReference);
  const months = pos(i.securityMonths ?? 0);
  const invested = pos(i.investedValue);

  const branches = ref > 0 ? clamp01(Math.sqrt(invested / (ref * BRANCHES_FULL_MONTHS))) : invested > 0 ? 0.2 : 0;
  const growth = clamp01(0.16 + 0.34 * Math.min(months / 3, 1) + 0.5 * branches);
  const stage: TreeState['stage'] = growth < 0.27 ? 'sprout' : growth < 0.55 ? 'young' : branches < 0.15 ? 'tree' : growth < 0.85 ? 'fruiting' : 'grand';

  const gains = pos(i.investedValue - i.investedContributed);
  const investments = Math.max(0, Math.floor(i.investmentCount ?? (invested > 0 ? 1 : 0)));
  // Fruits : la valeur placée et la plus-value, rapportées au mois de dépenses (le même montant ne
  // pèse pas pareil selon le train de vie).
  const unit = ref > 0 ? ref : FALLBACK_REFERENCE;
  const valueMonths = invested / unit, gainMonths = gains / unit;
  const fruits = invested > 0 ? FRUIT_STEPS.reduce((n, [m, k]) => (valueMonths >= m ? k : n), 0) : 0;
  const harvest: TreeState['harvest'] = valueMonths >= HARVEST_BIG_MONTHS ? 'big' : valueMonths >= HARVEST_SMALL_MONTHS ? 'small' : 'none';
  const contributed = pos(i.investedContributed);
  const golden = gainMonths >= GOLDEN_GAIN_MONTHS || (contributed > 0 && gains >= contributed && gainMonths >= GOLDEN_DOUBLED_MIN_MONTHS);
  const maturity: TreeState['maturity'] = gains <= 0 ? 'young' : golden ? 'golden' : 'ripe';
  const ripe = maturity !== 'young';

  const enjoy = pos(i.enjoyThisMonth);
  const flowers = enjoy > 0 ? Math.min(5, Math.max(1, Math.round(ref > 0 ? (enjoy / (ref * 0.2)) * 5 : 1))) : 0;

  /* L'arrosoir montre l'eau LIBRE : la part des comptes courants qui reste à utiliser ce mois-ci (le
     Relyka), pas le solde entier — sinon il était toujours plein. Tout prévu → arrosoir vide, sans
     drame. Relyka inconnu → repli sur le solde au-dessus du minimum à garder. */
  const water = i.relyka != null && Number.isFinite(i.relyka)
    ? (i.currentBalance > 0 ? clamp01(pos(i.relyka) / i.currentBalance) : 0)
    : ref > 0 ? clamp01((i.currentBalance - pos(i.minimumToKeep)) / ref) : i.currentBalance > pos(i.minimumToKeep) ? 0.5 : 0;

  /* Avancement global = remboursé ÷ emprunté, crédits sains EN COURS confondus : le gros prêt pèse
     plus que le petit. Un crédit sans montant emprunté connu compte pour moitié remboursé (repli).
     Plus aucun crédit en cours, mais un crédit sain soldé (montant emprunté connu) : la cabane est
     terminée et À TOI — elle reste, c'est la récompense du remboursement. */
  const healthyAll = i.credits.filter((c) => c.kind === 'healthy');
  const healthy = healthyAll.filter((c) => pos(c.remaining) > 0);
  const repaid = healthyAll.filter((c) => pos(c.remaining) === 0 && pos(c.borrowed ?? 0) > 0);
  let borrowedSum = 0;
  let remainingSum = 0;
  for (const c of healthy) {
    const rem = pos(c.remaining);
    remainingSum += rem;
    borrowedSum += Math.max(rem, pos(c.borrowed ?? 0) > 0 ? pos(c.borrowed ?? 0) : rem * 2);
  }
  const cabin: GardenCabin | null = healthy.length
    ? { progress: borrowedSum > 0 ? clamp01(1 - remainingSum / borrowedSum) : 0.5, count: healthy.length, owned: false }
    : repaid.length ? { progress: 1, count: repaid.length, owned: true } : null;

  const expensive = i.credits.filter((c) => c.kind === 'expensive').reduce((s, c) => s + pos(c.remaining), 0);
  const brambles = expensive > 0 ? (ref > 0 ? Math.max(0.25, clamp01(expensive / (ref * BRAMBLES_FULL_MONTHS))) : 0.5) : 0;

  return {
    growth,
    stage,
    roots: {
      months,
      depth: clamp01(months / 6),
      marks: { one: months >= 1, three: months >= 3, six: months >= 6 },
      beyondSix: months > 6,
      extraMonths: months > 6 ? months - 6 : 0,
    },
    branches,
    fruits,
    harvest,
    maturity,
    ripe,
    investments,
    flowers,
    water,
    cabin,
    brambles,
    rings: Math.max(0, Math.floor(pos(i.streakWeeks))),
  };
}
