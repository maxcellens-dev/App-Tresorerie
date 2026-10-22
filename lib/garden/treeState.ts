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
 *     taille de l'arbre ← l'étape du profil financier (P1 → P9, cf. lib/garden/gardenRules) ;
 *                         étape pas encore connue : épargne + placements ;
 *     racines           ← mois de dépenses couverts par l'épargne (trois traits, 1, 3 et
 *                         6 mois par défaut, puis une nappe au-delà : de l'argent qui pourrait être placé) ;
 * Tous les seuils viennent des RÈGLES (lib/garden/gardenRules, réglables en admin).
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
import type { FinancialProfileId } from '../../types/database';
import { DEFAULT_GARDEN_RULES, type GardenRules } from './gardenRules';

/** Fruits sur l'arbre à chaque seuil de `fruitSteps`. */
const FRUIT_COUNTS = [1, 2, 3, 4, 6];

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
  /** Mois couverts par l'épargne (computeSecurityCushion().months) ; null = inconnu. */
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
  /** Étape du profil financier : elle décide de la taille de l'arbre (P0 / inconnue → calculée). */
  profileId?: FinancialProfileId | null;
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
  /** Étape dessinée : 1 l'échelle, 2 plancher et garde-corps, 3 ossature, 4 toit, 5 cabane habitée. */
  stage: 1 | 2 | 3 | 4 | 5;
}

export interface TreeState {
  /** Taille de l'arbre, 0 (pousse) → 1 (grand arbre). */
  growth: number;
  /** Stade nommable (pour les libellés et l'accessibilité). */
  stage: 'sprout' | 'young' | 'tree' | 'fruiting' | 'grand';
  roots: {
    /** Mois de secours (≥ 0) ; 0 quand inconnu. */
    months: number;
    /** Profondeur dessinée, 0 → 1 (1 = 3ᵉ trait, 6 mois par défaut : les racines au plus profond). */
    depth: number;
    /** Traits franchis (1, 3, 6 et 12 mois par défaut). */
    marks: { one: boolean; three: boolean; six: boolean; twelve: boolean };
    /** Les mois des quatre traits (règles). */
    markMonths: [number, number, number, number];
    /** 4ᵉ trait franchi : la couche DORÉE apparaît sous les racines. */
    golden: boolean;
    /** Au-delà du 4ᵉ trait, et combien de mois en plus (de quoi faire pousser des fruits). */
    beyondLast: boolean;
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

/** Référence mensuelle de repli quand les dépenses sont encore inconnues (€). */
const FALLBACK_REFERENCE = 2000;

export function computeTreeState(i: GardenInputs, R: GardenRules = DEFAULT_GARDEN_RULES): TreeState {
  const ref = pos(i.monthlyReference);
  const months = pos(i.securityMonths ?? 0);
  const invested = pos(i.investedValue);

  const branches = ref > 0 ? clamp01(Math.sqrt(invested / (ref * R.branchesFullMonths))) : invested > 0 ? 0.2 : 0;
  /* Taille : l'étape du profil quand elle est connue (même échelle que « Mon parcours ») ; sinon,
     l'épargne et les placements. */
  const byProfile = i.profileId && i.profileId !== 'P0' ? R.growthByProfile[i.profileId] : undefined;
  const growth = clamp01(byProfile ?? (0.16 + 0.34 * Math.min(months / R.growthSavingsMonths, 1) + 0.5 * branches));
  const stage: TreeState['stage'] = growth < 0.27 ? 'sprout' : growth < 0.55 ? 'young' : branches < 0.15 ? 'tree' : growth < 0.85 ? 'fruiting' : 'grand';

  const gains = pos(i.investedValue - i.investedContributed);
  const investments = Math.max(0, Math.floor(i.investmentCount ?? (invested > 0 ? 1 : 0)));
  // Fruits : la valeur placée et la plus-value, rapportées au mois de dépenses (le même montant ne
  // pèse pas pareil selon le train de vie).
  const unit = ref > 0 ? ref : FALLBACK_REFERENCE;
  const valueMonths = invested / unit, gainMonths = gains / unit;
  const fruits = invested > 0 ? R.fruitSteps.reduce((n, m, k) => (valueMonths >= m ? FRUIT_COUNTS[k] : n), 0) : 0;
  const harvest: TreeState['harvest'] = valueMonths >= R.harvestBigMonths ? 'big' : valueMonths >= R.harvestSmallMonths ? 'small' : 'none';
  const contributed = pos(i.investedContributed);
  const golden = gainMonths >= R.goldenGainMonths || (contributed > 0 && gains >= contributed && gainMonths >= R.goldenDoubledMinMonths);
  const maturity: TreeState['maturity'] = gains <= 0 ? 'young' : golden ? 'golden' : 'ripe';
  const ripe = maturity !== 'young';

  const enjoy = pos(i.enjoyThisMonth);
  const flowers = enjoy > 0 ? Math.min(5, Math.max(1, Math.round(ref > 0 ? (enjoy / (ref * R.flowersFullPct / 100)) * 5 : 1))) : 0;

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
  const cabinOf = (progress: number, count: number, owned: boolean): GardenCabin => ({
    progress, count, owned,
    stage: (1 + R.cabinSteps.filter((pct) => progress * 100 >= pct).length) as GardenCabin['stage'],
  });
  const cabin: GardenCabin | null = healthy.length
    ? cabinOf(borrowedSum > 0 ? clamp01(1 - remainingSum / borrowedSum) : 0.5, healthy.length, false)
    : repaid.length ? cabinOf(1, repaid.length, true) : null;

  const expensive = i.credits.filter((c) => c.kind === 'expensive').reduce((s, c) => s + pos(c.remaining), 0);
  const brambles = expensive > 0 ? (ref > 0 ? Math.max(R.bramblesMinPct / 100, clamp01(expensive / (ref * R.bramblesFullMonths))) : 0.5) : 0;

  return {
    growth,
    stage,
    roots: {
      months,
      depth: clamp01(months / R.rootsMarks[2]),
      marks: { one: months >= R.rootsMarks[0], three: months >= R.rootsMarks[1], six: months >= R.rootsMarks[2], twelve: months >= R.rootsMarks[3] },
      markMonths: R.rootsMarks,
      golden: months >= R.rootsMarks[3],
      beyondLast: months > R.rootsMarks[3],
      extraMonths: months > R.rootsMarks[3] ? months - R.rootsMarks[3] : 0,
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
