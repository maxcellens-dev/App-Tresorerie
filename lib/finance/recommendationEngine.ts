/**
 * Moteur de recommandations intelligentes
 * ─────────────────────────────────────────
 * Analyse la santé financière et propose 2 à 4 recommandations
 * dont la somme = 100 % du « Ce qu'il te reste ce mois-ci ».
 *
 * Types de recommandations :
 *   1. Épargner    → renforcer l'épargne de sécurité
 *   2. Investir    → alimenter un compte d'investissement
 *   3. Confort     → marge en plus dispo une fois les dépenses variables habituelles couvertes
 *   4. Conserver   → garder en réserve pour le mois suivant
 */

import type { PilotageData } from '../../hooks/pilotage/usePilotageData';
import type { FinancialProfile, FinancialProfileId } from '../../types/database';
import { PROFILE_TO_TIER, resolveProfileId } from './financialProfileEngine';
import { computeSecurityCushion, securityMonthsLabel } from './securityCushion';
import { appliedAllocation } from './recoMode';
import { floorToTen, CURRENCY_SYMBOL } from './currency';

/* ── Types ───────────────────────────────────────────────── */

export type RecoType = 'save' | 'invest' | 'enjoy' | 'keep';

export interface SmartRecommendation {
  type: RecoType;
  /** Titre complet affiché dans la carte */
  title: string;
  /** Libellé court pour la légende de la barre */
  shortTitle: string;
  /** Description contextuelle */
  description: string;
  /** Montant en euros */
  amount: number;
  /**
   * Montant « actionnable » : borne basse (« minimum sûr ») quand les montants sont affichés en
   * fourchette, sinon = amount. C'est LUI qui est interpolé dans les textes et pré-rempli dans les
   * actions (virement / réservation / cumul) — on ne pousse jamais à déplacer de l'argent incertain.
   */
  actionAmount: number;
  /** Pourcentage du safe_to_spend (0-100) */
  percentage: number;
  /** Couleur d'accent */
  color: string;
  /** Nom d'icône Ionicons */
  icon: string;
  /** Route expo-router à ouvrir, ou null si informationnel */
  actionRoute: string | null;
  /** Libellé du bouton d'action */
  actionLabel: string;
  /** Garde-fou marge × projection — message tout prêt (cas « tout conserver » : trajectoire déjà sous la marge). */
  guardNote?: string;
  /**
   * Garde-fou marge × projection — cas « reco RÉDUITE » (épargne/invest plafonnés). Donnée STRUCTURÉE :
   * `addMore` = ce qu'on pourrait ajouter en plus, `total` = le total possible sans le garde-fou.
   * Le TEXTE est composé côté écran (RecommendationCard) → un seul message combiné si épargne + invest
   * sont tous deux plafonnés.
   */
  guard?: { addMore: number; total: number };
  /**
   * Tenue du montant en VIREMENT RÉCURRENT sur 6 mois. Donnée STRUCTURÉE (pas une phrase) : le texte
   * est composé avec la projection dans un seul bloc (lib/recoContext) — on ne veut pas 3 messages.
   */
  recurringFit?: RecurringFit;
  /**
   * État FACTUEL rattaché à la reco, sans son montant (il est déjà lu sur la tuile). Aujourd'hui
   * seul « Épargner » en a un : le niveau du matelas de sécurité. Le tableau de bord le met en
   * préambule du message de la décision — c'est la seule chose que la description apportait et que
   * la projection ne dit pas.
   */
  stateNote?: string;
}

/**
 * Le montant est-il tenable chaque mois sans entamer la marge de sécurité ?
 *  • sustainable : oui, à `monthly` €/mois ;
 *  • capped      : non — le maximum tenable en récurrent est `monthly` €/mois ;
 *  • month_only  : rien n'est tenable en récurrent (à gérer mois par mois).
 * `null`/absent = trajectoire indisponible (pas de conclusion possible).
 */
export type RecurringFit =
  | { kind: 'sustainable'; monthly: number }
  | { kind: 'capped'; monthly: number }
  | { kind: 'month_only' };

export type SavingsTier = 'critical' | 'below_optimal' | 'healthy' | 'p4_dynamic' | 'comfortable';

/* ── Couleurs par type ───────────────────────────────────── */

const RECO_COLORS: Record<RecoType, string> = {
  save:   '#34d399',
  invest: '#a78bfa',
  enjoy:  '#f59e0b',
  keep:   '#60a5fa',
};

const RECO_ICONS: Record<RecoType, string> = {
  save:   'shield-outline',
  invest: 'trending-up-outline',
  enjoy:  'sparkles-outline',
  keep:   'hourglass-outline',
};

/* ── Ordre de consommation des recos (cascade de dépassement) ──────────────
 * Quand l'enveloppe des dépenses variables est épuisée, tout dépassement grignote
 * les recos une par une dans cet ordre (1er = réduit en premier). « Confort » d'abord,
 * puis les autres selon la prudence du budget. Les % d'allocation ne sont alors plus
 * exactement respectés : c'est voulu.
 */
export type ConsumptionMode = 'prudent' | 'equilibre' | 'dynamique';

export const CONSUMPTION_MODE_LABELS: Record<ConsumptionMode, string> = {
  prudent:   'Prudent',
  equilibre: 'Équilibré',
  dynamique: 'Dynamique',
};

export const DEFAULT_CONSUMPTION_ORDERS: Record<ConsumptionMode, RecoType[]> = {
  prudent:   ['enjoy', 'invest', 'save', 'keep'],
  equilibre: ['enjoy', 'invest', 'keep', 'save'],
  dynamique: ['enjoy', 'save', 'keep', 'invest'],
};

/**
 * Mode « Auto » : le mode de consommation du budget est dérivé du profil financier (P0–P9).
 * Prudent tant que le matelas n'est pas fait, équilibré une fois la réserve constituée, dynamique
 * quand l'investissement est en place. P0 (Découverte) reste prudent : on ne sait rien.
 */
export const DEFAULT_AUTO_PROFILE_MAP: Record<FinancialProfileId, ConsumptionMode> = {
  P0: 'prudent',
  P1: 'prudent', P2: 'prudent', P3: 'prudent',
  P4: 'equilibre', P5: 'equilibre', P6: 'equilibre',
  P7: 'dynamique', P8: 'dynamique', P9: 'dynamique',
};

/**
 * Résout le mode de consommation depuis le réglage de prudence du budget.
 * `prudenceLevel` (profiles.prudence_level) : null = Auto (dérive du profil),
 * sinon 75 ≈ Prudent, 50 ≈ Équilibré, 25 ≈ Dynamique.
 */
export function resolveConsumptionMode(
  prudenceLevel: number | null | undefined,
  profileId: FinancialProfileId | undefined,
  /* PARTIEL exprès : la table vient de la base (réglage admin) et a été écrite quand il n'existait
     que cinq profils. Un profil ajouté depuis n'y figure pas — on retombe alors sur le défaut du
     code, jamais sur `undefined`. */
  autoMap: Partial<Record<FinancialProfileId, ConsumptionMode>> = DEFAULT_AUTO_PROFILE_MAP,
): ConsumptionMode {
  if (prudenceLevel == null) {
    const id = resolveProfileId(profileId);
    return autoMap[id] ?? DEFAULT_AUTO_PROFILE_MAP[id] ?? 'equilibre';
  }
  if (prudenceLevel >= 63) return 'prudent';
  if (prudenceLevel >= 38) return 'equilibre';
  return 'dynamique';
}

/** Ordre complet (les 4 types) pour un mode, complété par les défauts si la config est partielle. */
export function getConsumptionOrder(
  mode: ConsumptionMode,
  orders: Partial<Record<ConsumptionMode, RecoType[]>> = DEFAULT_CONSUMPTION_ORDERS,
): RecoType[] {
  const order = orders[mode] ?? DEFAULT_CONSUMPTION_ORDERS[mode];
  const seen = new Set(order);
  return [...order, ...DEFAULT_CONSUMPTION_ORDERS[mode].filter((t) => !seen.has(t))];
}


export const PROFILE_LABELS: Record<FinancialProfile, string> = {
  economiser: 'Économiser',
  suivi: 'Suivi',
  optimiser: 'Optimiser',
  investir: 'Investir',
};

/* ── L'ANCIENNE ÉCHELLE PAR MONTANT D'ÉPARGNE A ÉTÉ RETIRÉE ────────────────────────────────────
 *
 * `TIER_ALLOCATIONS`, `determineTier` et `applyUserAllocationPreferences` déduisaient une
 * répartition du seul MONTANT d'épargne, comparé à trois seuils. Ce chemin se présentait comme un
 * repli « le temps que le profil soit calculé » — mais il était INATTEIGNABLE : `buildRecoOptions`
 * passe toujours un identifiant de profil (`x.financialProfileId ?? 'P0'`), et P0 est une valeur.
 *
 * Personne n'a donc jamais reçu ces pourcentages… sauf les TESTS, qui les exerçaient à longueur de
 * cas. On validait une échelle que la production n'emprunte pas, pendant que celle qui décide
 * vraiment (les répartitions par profil, réglées en administration) n'était couverte qu'ailleurs.
 *
 * C'était surtout une SECONDE réponse à « quelle répartition s'applique ? », avec ses propres
 * seuils — exactement ce que `lib/finance/recoMode` documente comme la chose à ne pas laisser
 * traîner. Faute de profil, on répond désormais P0 (« on ne sait pas encore »), qui a sa propre
 * ligne dans la table : une seule échelle, la même pour tout le monde.
 */

/* ── Seuil minimum pour afficher une recommandation ──────── */
const MIN_PERCENT_THRESHOLD = 5;

/**
 * Montant minimal d'une reco de REPLI (quand aucun poste n'atteint son seuil d'affichage).
 * En dessous, il n'y a vraiment plus rien à proposer et on n'affiche aucune reco.
 */
const MIN_FALLBACK_AMOUNT = 10;

/**
 * FIN DE PÉRIODE — jours restants avant la prochaine rentrée d'argent en deçà desquels « Conserver »
 * se PRÉSENTE comme un report sur la période suivante.
 *
 * ⚠️ Ce seuil ne sert plus qu'au LIBELLÉ. Une bascule automatique déversait progressivement la part
 * « Confort » dans « Conserver » sur les sept derniers jours ; elle a été retirée avec les autres
 * modificateurs contextuels — les pourcentages du profil sont désormais appliqués tels quels, et
 * l'utilisateur reste libre de dépenser son Confort la veille de sa paie s'il le souhaite.
 *
 * « PÉRIODE », PAS « MOIS CALENDAIRE » : la rentrée d'argent est une donnée réelle
 * (cf. `daysLeftInPeriod` dans lib/recoInputs), le 31 du mois est une supposition.
 */
const PERIOD_END_LABEL_DAYS = 5;

/**
 * Allocation (%) par poste — LA source unique des pourcentages de répartition, partagée entre le
 * moteur de recos et le Pouls (capacité d'investissement) : profil P0–P9 (ou réglage manuel), puis
 * normalisation à 100 %. Sans ça, deux écrans peuvent annoncer des montants « plaçables »
 * différents pour le même mois.
 *
 * Sans profil financier connu (tout premier chargement, avant que `LiveProfileSync` n'écrive la
 * ligne), on applique P0 « Découverte » — le palier qui dit précisément qu'on ne sait pas encore.
 * Il n'y a plus de seconde échelle de repli (cf. le bloc sur l'ancienne échelle par montant
 * d'épargne, plus haut).
 */
export function deriveRecoAllocations(
  opts: {
    financialProfileId?: FinancialProfileId;
    /** Jours restants avant la prochaine rentrée d'argent — LIBELLÉS uniquement (aucun montant). */
    daysLeftInPeriod?: number | null;
    /**
     * RÉPARTITION MANUELLE (mode manuel, cf. lib/finance/recoMode) : remplace la table du palier,
     * et rien d'autre — plus rien ne la réécrit ensuite.
     * Absente / `null` → le profil décide.
     */
    manualAllocation?: Record<RecoType, number> | null;
    /** Répartitions par palier réglées en administration (cf. allocationsFromRows). */
    profileAllocations?: Record<FinancialProfileId, Record<RecoType, number>> | null;
  } = {},
): { tier: SavingsTier; alloc: Record<RecoType, number> } {
  /* ── LA RÉPARTITION VIENT DU PROFIL, OU DU RÉGLAGE MANUEL. POINT. ────────────────────────────
     Un étage « priorité du mois » s'intercalait ici : il classait la situation en sept cas écrits
     en dur et imposait des bornes qui ÉCRASAIENT les pourcentages du profil. Retiré. Le profil
     financier détermine les pourcentages ; c'est sa raison d'être, et l'utilisateur les voit tels
     quels sur son écran de profil.

     Ce que ces bornes prétendaient protéger est déjà assuré plus bas, sur des MONTANTS RÉELS
     plutôt que sur des pourcentages : cascade de l'enveloppe variable dépassée (étape 8),
     garde-fou « point bas de la projection − marge » qui rabote l'investissement en premier et
     reverse l'excédent sur « Conserver » (étape 8bis), puis seuils d'affichage et réconciliation
     Σ(recos) = Relyka (étapes 9 à 10). Ces règles-là mesurent la FAISABILITÉ ; les priorités,
     elles, portaient un jugement sur des pourcentages, et rendaient à l'utilisateur des chiffres
     qu'il n'avait choisis nulle part. */
  // Identifiant venu de la base : ramené sur le référentiel de CE bundle (cf. resolveProfileId).
  // Absent ⇒ P0 « Découverte », le palier qui dit qu'on ne sait pas encore.
  const pid = resolveProfileId(opts.financialProfileId);
  // Table de l'administration si elle est fournie, celle du code sinon (repli hors-ligne).
  // `appliedAllocation` est LE point d'entrée partagé avec les écrans : ils ne peuvent pas
  // annoncer une répartition différente de celle qui est appliquée ici.
  const alloc = appliedAllocation(pid, opts.manualAllocation, opts.profileAllocations);
  /* Le PALIER reste celui du profil réel, même en manuel : il ne choisit plus de pourcentages
     (ils viennent d'être posés), il ne sert qu'au VOCABULAIRE des conseils. Le déduire des
     pourcentages choisis ferait parler l'app à quelqu'un d'autre — « ta réserve est confortable »
     à qui a simplement demandé plus d'investissement. */
  const tier = PROFILE_TO_TIER[pid];

  /* ⚠️ PLUS AUCUN « MODIFICATEUR CONTEXTUEL » ICI.
     Quatre fonctions déplaçaient encore ces pourcentages de 5 à 15 points chacune — rythme de
     dépenses variables, santé du compte courant, ratio investi/épargné, fin de période — avec des
     seuils et des amplitudes écrits en dur. Comme l'étage « priorité du mois » retiré juste avant,
     elles rendaient à l'utilisateur des pourcentages qu'il n'avait choisis nulle part, et que son
     écran de profil ne montrait pas.
     Les pourcentages sont donc EXACTEMENT ceux du profil (ou du réglage manuel). Ce qui peut encore
     faire varier les MONTANTS se joue plus bas, sur des faits mesurés et non sur un jugement :
     cascade de l'enveloppe variable dépassée, garde-fou du point bas de projection, seuils
     d'affichage, réconciliation Σ(recos) = Relyka. */
  normalizeAllocations(alloc);
  return { tier, alloc };
}

/* ── Moteur principal ────────────────────────────────────── */

/** Seuils minimums de reste disponible pour afficher chaque type de reco. */
export interface RecoThresholds {
  seuil_reco_epargne: number;
  seuil_reco_invest: number;
  seuil_reco_plaisir: number;
  seuil_reco_conserver: number;
}

export interface ComputeRecoOptions {
  financialProfileId?: FinancialProfileId;
  /**
   * Répartition CHOISIE par l'utilisateur (mode manuel, cf. lib/finance/recoMode). Elle remplace la
   * table du palier au tout début du calcul ; tout le reste (modificateurs contextuels, seuils,
   * garde-fous de faisabilité) se déroule ensuite sans changement.
   */
  manualAllocation?: Record<RecoType, number> | null;
  /**
   * Répartitions par palier réglées depuis l'administration (table `profile_allocations`).
   * Absentes → celles du code. Elles remplacent la BASE, avant les modificateurs contextuels.
   */
  profileAllocations?: Record<FinancialProfileId, Record<RecoType, number>> | null;
  /** Budget de référence (= reste disponible). Défaut : data.safe_to_spend. */
  budget?: number;
  /** Seuils min de reste pour afficher chaque reco (§9). */
  thresholds?: RecoThresholds;
  /** Montants déjà alloués par catégorie (déduits du % théorique de chaque reco). */
  alreadyAllocated?: Partial<Record<RecoType, number>>;
  /**
   * Dépassement de l'enveloppe variable (€) : montant dépensé au-delà des dépenses variables
   * habituelles estimées. Quand > 0, il est grignoté sur les recos une par une dans
   * `consumptionOrder` (cascade), au lieu de réduire toutes les recos au prorata.
   * Le `budget` doit alors être le budget « enveloppe juste atteinte » (= budget courant + overspend).
   */
  overspend?: number;
  /** Ordre de consommation des recos quand `overspend > 0` (1er = réduit en premier). */
  consumptionOrder?: RecoType[];
  /**
   * Garde-fou MARGE × PROJECTION 6 MOIS : soldes courants projetés en fin de mois (index 0 = mois
   * courant), trajectoire partagée avec l'écran Projection (lib/tresoProjection). Épargner/Investir
   * sont plafonnés pour que le POINT BAS des 6 mois reste au-dessus de la marge (invest réduit en
   * premier, excédent → « Conserver »). Ignoré si margin ≤ 0 ou balances vide.
   */
  projectionGuard?: {
    balances: number[];
    margin: number;
    /**
     * Trajectoire LONGUE (12 mois) servant à juger la DURABILITÉ d'un virement récurrent
     * (cf. computeRecurringFit). Le garde-fou, lui, reste sur les 6 mois de  — c'est
     * l'horizon annoncé dans ses messages. Absente → repli sur .
     */
    sustainBalances?: number[];
  };
  /**
   * Plafond absolu du montant d'une reco (= reste réellement disponible « Ton Relyka », arrondi à
   * la dizaine). Appliqué AVANT la construction des textes → montant affiché, description, conseils
   * et CTA partagent la même valeur (pas de clamp après coup côté écran).
   */
  maxAmount?: number;
  /**
   * Montant « actionnable » pour les textes et CTA : borne basse « minimum sûr » quand les montants
   * sont affichés en fourchette (confiance moyenne/basse), sinon identité. Fourni par l'écran
   * (useReliability.actionable) pour rester alignée sur la fourchette du titre de la reco.
   * Le `type` est passé car le DOUTE EST DIRECTIONNEL : la borne basse protège les gestes qui
   * SORTENT l'argent du compte (épargner / investir, irréversibles) ; « Conserver » ne sort rien du
   * compte, donc en cas de doute il faut en garder PLUS, pas moins → montant plein.
   */
  actionAmountFor?: (amount: number, type: RecoType) => { value: number; isRange: boolean };
  /**
   * Jours restants avant la PROCHAINE RENTRÉE D'ARGENT (fin de la période d'argent réelle, pas du
   * mois calendaire) : « Conserver » se présente alors comme un report sur la période suivante.
   * Absent / `null` = libellés normaux (cf. lib/recoInputs). N'agit plus sur aucun montant.
   */
  daysLeftInPeriod?: number | null;
  /**
   * COLLECTEUR (optionnel) : le moteur y consigne les écarts qu'il a RÉELLEMENT appliqués.
   *
   * Depuis le retrait des priorités et des modificateurs contextuels, les pourcentages affichés sur
   * l'écran de profil sont exactement ceux du profil. Mais les MONTANTS peuvent encore s'en écarter,
   * pour des raisons factuelles : de l'argent déjà mis de côté ce mois-ci, un dépassement du budget
   * variable, un point bas de trajectoire trop bas… L'utilisateur voit alors des recommandations
   * qui ne collent pas à ses pourcentages, et il n'a aucun moyen de savoir pourquoi.
   *
   * Ce tableau est ce moyen. Chaque marqueur est posé À L'ENDROIT où l'écart se produit — jamais
   * re-déduit après coup par un écran, ce qui finirait par expliquer autre chose que ce qui a eu
   * lieu. Passer un tableau vide, le lire après l'appel.
   */
  trace?: RecoAdjustmentKind[];
}

/**
 * Ce qui peut faire s'écarter les MONTANTS recommandés des pourcentages du profil.
 * (Les écarts d'arrondi — moins de 10 € — ne sont volontairement pas tracés : ce serait du bruit.)
 */
export type RecoAdjustmentKind =
  /** Solde courant sous la marge de sécurité → tout en « Conserver ». */
  | 'margin_freeze'
  /** Trajectoire de trésorerie sous la marge → tout en « Conserver ». */
  | 'projection_freeze'
  /** Épargner/Investir plafonnés par le point bas de la projection ; l'excédent va en « Conserver ». */
  | 'projection_guard'
  /** Budget variable dépassé (ou allocation volontaire au-delà de sa part) : les recos sont grignotées. */
  | 'cascade'
  /** Ce qui a déjà été épargné/investi/réservé ce mois-ci est déduit de la reco correspondante. */
  | 'already_allocated'
  /** Un poste passe sous son seuil d'affichage : son montant rejoint un autre poste. */
  | 'crumbs'
  /** Aucun poste n'atteint son seuil : une seule reco, « tout conserver ». */
  | 'single_fallback';

export function computeRecommendations(
  data: PilotageData,
  opts: ComputeRecoOptions = {},
): SmartRecommendation[] {
  const { financialProfileId, thresholds } = opts;
  const budget = opts.budget ?? data.safe_to_spend;
  const types: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];
  /** Consigne un écart RÉELLEMENT appliqué (cf. `ComputeRecoOptions.trace`). Sans collecteur : rien. */
  const mark = (kind: RecoAdjustmentKind) => { if (opts.trace && !opts.trace.includes(kind)) opts.trace.push(kind); };

  /**
   * FREINS DE SÉCURITÉ : tout le reste en « Conserver ».
   * Deux garde-fous par rapport à l'ancienne version, qui proposait 100 % du budget BRUT :
   *  • on déduit ce qui est DÉJÀ alloué (virements exécutés/prévus, cumuls, réservations) — comme
   *    le fait le chemin normal — sinon on repropose de conserver de l'argent déjà engagé ;
   *  • on n'émet RIEN si le montant retombe à 0 une fois plafonné au Relyka (plus de carte « 0 € »).
   */
  const keepEverything = (guardNote?: string): SmartRecommendation[] => {
    const allocated = types.reduce((s, t) => s + Math.max(0, opts.alreadyAllocated?.[t] ?? 0), 0);
    const net = Math.round(Math.max(0, budget - allocated));
    if (net <= 0) return [];
    const reco = buildRecommendation('keep', 100, net, 'critical', data, opts);
    if (reco.amount <= 0) return [];
    return [guardNote ? { ...reco, guardNote } : reco];
  };

  /* ── UN FREIN DOIT TOUJOURS DIRE POURQUOI ─────────────────────────────────────────────────────
     Trois chemins réduisent le Relyka à un seul « Conserver ». Un seul portait son explication :
     les deux autres rendaient une carte unique, sans un mot, et l'utilisateur voyait la répartition
     de son profil disparaître sans savoir ce qui l'avait décidée — le pire moment pour se taire,
     puisque c'est là que l'app s'écarte le plus de ce qu'elle a promis.
     Ces phrases commencent en minuscule : `composeGuardMessage` les capitalise (lib/recoMessages). */
  const margin = Math.round(data.safety_margin_amount ?? 0);
  const marginLabel = `${margin.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  // Garde-fou marge de sécurité : si le solde courant est sous la marge, on ne
  // recommande que "Conserver" (tout le budget disponible, s'il en reste).
  if (
    (data.safety_margin_amount ?? 0) > 0 &&
    data.total_checking < (data.safety_margin_amount ?? 0)
  ) {
    mark('margin_freeze');
    return keepEverything(
      `ton solde courant (${Math.round(data.total_checking).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}) est déjà sous ta marge de sécurité (${marginLabel}) : on te recommande de tout conserver ce mois-ci, le temps de la reconstituer.`,
    );
  }

  // Garde-fou PROJECTION (moyen terme) : si la trajectoire de trésorerie plonge sous le coussin
  // dans les N prochains mois, on FREINE → on ne recommande que "Conserver" (renforcer le coussin),
  // quel que soit le profil. La répartition du profil n'est PAS modifiée : c'est un frein de sécurité,
  // comme le garde-fou marge ci-dessus (n'agit qu'en situation de danger projeté).
  if (data.projection_in_danger) {
    mark('projection_freeze');
    return keepEverything(
      margin > 0
        ? `ta trajectoire de trésorerie passe sous ta marge de sécurité (${marginLabel}) dans les prochains mois : on te recommande de tout conserver ce mois-ci.`
        : 'ta trajectoire de trésorerie passe dans le rouge dans les prochains mois : on te recommande de tout conserver ce mois-ci.',
    );
  }

  // Garde-fou MARGE × PROJECTION 6 MOIS : point bas de la trajectoire (écran Projection). S'il est
  // déjà sous la marge SANS toucher aux recos → tout « Conserver » (comme les freins ci-dessus).
  const guard = opts.projectionGuard;
  const guardTrough = guard && guard.margin > 0 && guard.balances.length > 0
    ? Math.min(...guard.balances)
    : null;
  if (guardTrough != null && guardTrough <= guard!.margin) {
    mark('projection_freeze');
    return keepEverything(
      `ton solde projeté passe sous ta marge de sécurité (${Math.round(guard!.margin).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}) dans les 6 prochains mois : il vaut mieux conserver ton Relyka ce mois-ci.`,
    );
  }

  // Pas de budget → pas de recommandation
  if (budget <= 0) return [];

  const { tier, alloc } = deriveRecoAllocations({
    financialProfileId, daysLeftInPeriod: opts.daysLeftInPeriod,
    manualAllocation: opts.manualAllocation,
    profileAllocations: opts.profileAllocations,
  });

  // 5. Filtrer les recommandations trop petites (< seuil minimum)
  const filtered = types.filter(t => alloc[t] >= MIN_PERCENT_THRESHOLD);

  // Redistribuer les miettes
  if (filtered.length < types.length) {
    const removed = types.filter(t => !filtered.includes(t));
    const removedTotal = removed.reduce((s, t) => s + alloc[t], 0);
    const share = removedTotal / filtered.length;
    for (const t of filtered) alloc[t] += share;
    for (const t of removed) alloc[t] = 0;
    normalizeAllocations(alloc);
  }

  // 6. Montant net par catégorie = (% × budget) − déjà alloué réellement ce mois.
  const alreadyAllocated = opts.alreadyAllocated ?? {};
  const th = thresholds ?? { seuil_reco_epargne: 50, seuil_reco_invest: 100, seuil_reco_plaisir: 50, seuil_reco_conserver: 50 };
  const thresholdByType: Partial<Record<RecoType, number>> = {
    save: th.seuil_reco_epargne,
    invest: th.seuil_reco_invest,
    enjoy: th.seuil_reco_plaisir,
    keep: th.seuil_reco_conserver,
  };

  // 7. Montant net par catégorie = (% × budget) − déjà alloué réellement ce mois (clampé ≥ 0).
  // Si l'alloué dépasse la part théorique d'une catégorie (ex. on a déjà viré plus vers l'épargne
  // que sa part recommandée), l'excédent (`overflow`) n'est pas perdu : il est répercuté en cascade
  // ci-dessous, comme le dépassement. Sans ça, Σ(recos) dépasserait le Relyka (un segment saturerait
  // toute la jauge). Invariant visé : Σ(recos) = Relyka.
  const nets: Partial<Record<RecoType, number>> = {};
  let overflow = 0;
  for (const type of filtered) {
    const afterAlloc = (alloc[type] / 100) * budget - (alreadyAllocated[type] ?? 0);
    if (afterAlloc < 0) overflow += -afterAlloc;
    // La déduction est la 1ʳᵉ raison, et de loin, pour laquelle un montant ne tombe pas sur son
    // pourcentage : avoir déjà viré 200 € vers l'épargne réduit la reco « Épargner » d'autant.
    if ((alreadyAllocated[type] ?? 0) > 0) mark('already_allocated');
    nets[type] = Math.round(Math.max(0, afterAlloc));
  }
  // Allocations volontaires fléchées sur une catégorie NON recommandée (ex. épargne déjà engagée
  // alors que la part « épargne » est à 0 % pour ce profil → reco filtrée) : ce montant réduit bien
  // le Relyka, donc il doit aussi être répercuté en cascade. Sinon Σ(recos) dépasse le Relyka.
  for (const type of types) {
    if (filtered.includes(type)) continue;
    if ((alreadyAllocated[type] ?? 0) > 0) mark('already_allocated');
    overflow += Math.max(0, alreadyAllocated[type] ?? 0);
  }

  // 8. Cascade : le dépassement de l'enveloppe variable + l'excédent d'allocation volontaire
  // grignotent les recos une par une dans l'ordre choisi (selon la prudence) — « Confort » d'abord,
  // jusqu'à passer sous son seuil d'affichage, puis les suivantes. Les % d'allocation ne sont alors
  // plus exactement respectés : c'est voulu, et Σ(recos) reste égal au Relyka.
  let toConsume = Math.round(Math.max(0, (opts.overspend ?? 0) + overflow));
  if (toConsume > 0) {
    const order = opts.consumptionOrder ?? DEFAULT_CONSUMPTION_ORDERS.equilibre;
    for (const type of order) {
      if (toConsume <= 0) break;
      const cur = nets[type] ?? 0;
      const take = Math.min(cur, toConsume);
      if (take > 0) mark('cascade'); // une reco a RÉELLEMENT été grignotée
      nets[type] = cur - take;
      toConsume -= take;
    }
  }

  // 8bis. Garde-fou marge × projection : Épargner + Investir plafonnés au « headroom » (point bas
  // des 6 mois − marge) pour qu'exécuter les recos ne fasse pas plonger la trajectoire sous la marge.
  // Invest réduit en PREMIER (illiquide), épargne ensuite ; l'excédent file vers « Conserver »
  // (Σ recos = Relyka préservé). Réduit sous son seuil d'affichage → tout le reste part en réserve.
  const guardInfo: Partial<Record<RecoType, { addMore: number; total: number }>> = {};
  /**
   * Le garde-fou a-t-il RÉELLEMENT plafonné quelque chose ?
   *
   * ⚠️ Sans ce drapeau, les deux étapes suivantes défaisaient son travail. Les miettes (§9) et le
   * reliquat d'arrondi (§10) sont versés au poste « le mieux protégé » — c'est-à-dire `save` en
   * mode équilibré et `invest` en mode dynamique, soit précisément les deux postes que le garde-fou
   * vient de raboter. Épargner + Investir repassaient donc au-dessus du point bas projeté, de
   * quelques dizaines à quelques centaines d'euros, après coup et sans que rien ne le signale.
   */
  let guardCapped = false;
  if (guardTrough != null) {
    const headroom = Math.max(0, Math.round(guardTrough - guard!.margin));
    let remaining = Math.max(0, (nets.save ?? 0) + (nets.invest ?? 0) - headroom);
    let moved = 0;
    for (const type of ['invest', 'save'] as RecoType[]) {
      if (remaining <= 0) break;
      const cur = nets[type] ?? 0;
      if (cur <= 0) continue;
      let take = Math.min(cur, remaining);
      let rest = cur - take;
      const minTh = thresholdByType[type] ?? 0;
      if (rest > 0 && rest < minTh) { take = cur; rest = 0; }
      remaining = Math.max(0, remaining - take);
      moved += take;
      nets[type] = rest;
      // Donnée structurée seulement si la reco reste visible et que la réduction est significative (> 10 €).
      // `total` = ce qui était possible AVANT le garde-fou (rest visible + ce qu'on a retiré).
      if (rest > 0 && take > 10) {
        guardInfo[type] = { addMore: take, total: rest + take };
      }
    }
    if (moved > 0) {
      mark('projection_guard');
      guardCapped = true;
      nets.keep = (nets.keep ?? 0) + moved;
      if (!filtered.includes('keep')) filtered.push('keep');
      // (Cas B) Pas de message orange sur « Conserver » ici : la mise en réserve est déjà reflétée
      // par le montant, et le message « Dont X € mis en réserve… » n'apportait rien.
    }
  }

  // 9. MIETTES : un poste sous son seuil d'affichage ne disparaît plus AVEC son montant — celui-ci
  // rejoint le poste le MIEUX PROTÉGÉ (dernier de la cascade, celui qu'on grignote en dernier).
  // Avant, chaque poste sous son seuil était simplement jeté : un petit Relyka voyait ses 4 postes
  // filtrés un à un et l'écran annonçait « tout est traité ✨ » alors qu'il restait de l'argent.
  const consumption = opts.consumptionOrder ?? DEFAULT_CONSUMPTION_ORDERS.equilibre;
  const protection = (t: RecoType) => consumption.indexOf(t); // plus grand = mieux protégé
  /**
   * Où déverser un reliquat (miettes, arrondis) : le poste le mieux protégé — MAIS jamais un poste
   * que le garde-fou de projection vient de plafonner, sans quoi on lui rendrait d'une main ce qu'on
   * lui a retiré de l'autre. Quand tous les candidats sont plafonnés, « Conserver » recueille :
   * c'est le seul poste que le garde-fou ne cherche jamais à réduire.
   */
  const CAPPED_BY_GUARD: RecoType[] = ['save', 'invest'];
  const mostProtected = (list: RecoType[]): RecoType => {
    const eligible = guardCapped ? list.filter((t) => !CAPPED_BY_GUARD.includes(t)) : list;
    const pool = eligible.length > 0 ? eligible : list;
    return pool.reduce((a, b) => (protection(a) >= protection(b) ? a : b));
  };
  const shown = filtered.filter((t) => (nets[t] ?? 0) > 0 && (nets[t] ?? 0) >= (thresholdByType[t] ?? 0));
  if (shown.length > 0) {
    let crumbs = 0;
    for (const type of filtered) {
      if (shown.includes(type)) continue;
      crumbs += Math.max(0, nets[type] ?? 0);
      nets[type] = 0;
    }
    if (crumbs > 0) {
      mark('crumbs');
      const host = mostProtected(shown);
      nets[host] = (nets[host] ?? 0) + crumbs;
    }
  }

  // 9bis. REPLI « une seule reco » : aucun poste n'atteint son seuil (Relyka trop petit pour être
  // découpé en 4). On ne prétend pas que tout est traité : on propose de TOUT conserver — le seul
  // geste qui ait du sens en dessous des seuils d'action, et celui que l'utilisateur attend.
  if (shown.length === 0) {
    mark('single_fallback');
    const rest = types.reduce((s, t) => s + Math.max(0, nets[t] ?? 0), 0);
    const reco = buildRecommendation('keep', 100, Math.round(rest), tier, data, opts);
    if (reco.amount < MIN_FALLBACK_AMOUNT) return [];
    /* Ici aussi, la carte unique doit dire pourquoi elle est unique : la répartition du profil n'a
       pas changé, c'est le MONTANT qui ne se découpe pas — sans cette phrase, l'utilisateur voit un
       « Conserver » solitaire et croit que son profil a basculé. */
    return [{
      ...reco,
      guardNote: 'ton Relyka est trop petit pour être partagé entre plusieurs gestes : le garder est le seul qui ait du sens ce mois-ci.',
    }];
  }

  // 10. RÉCONCILIATION avec le Relyka AFFICHÉ. Deux dérives à corriger, dans les deux sens :
  //  • chaque montant est arrondi à la dizaine inférieure (jusqu'à 9 € perdus par poste) → Σ(recos)
  //    passait sous le Relyka ; le reliquat va au poste le MIEUX protégé ;
  //  • le plafond `maxAmount` (= Relyka arrondi) s'applique poste par poste, jamais à la somme →
  //    Σ(recos) pouvait le DÉPASSER (jauge annonçant plus que le Relyka) ; l'excédent est repris
  //    sur le poste le MOINS protégé, comme la cascade de dépassement.
  const capAmount = (v: number) => Math.max(0, floorToTen(opts.maxAmount != null ? Math.min(v, opts.maxAmount) : v));
  const target = capAmount(shown.reduce((s, t) => s + (nets[t] ?? 0), 0));
  const rounded = shown.reduce((s, t) => s + capAmount(nets[t] ?? 0), 0);
  const delta = target - rounded;
  if (delta >= 10) {
    const host = mostProtected(shown);
    nets[host] = (nets[host] ?? 0) + floorToTen(delta);
  } else if (delta <= -10) {
    let excess = floorToTen(-delta);
    for (const type of consumption) {
      if (excess <= 0) break;
      if (!shown.includes(type)) continue;
      const take = Math.min(nets[type] ?? 0, excess);
      nets[type] = (nets[type] ?? 0) - take;
      excess -= take;
    }
  }

  // 11. Construire les recommandations retenues.
  const result: SmartRecommendation[] = shown.map((type) =>
    buildRecommendation(type, alloc[type], Math.round(nets[type] ?? 0), tier, data, opts));

  // 12. Notes du garde-fou + conseil « virement récurrent » (tenable ou non en répétant le montant
  // chaque mois : au mois k, le solde projeté porte k+1 exécutions). Le conseil n'est affiché que si
  // la reco n'a PAS été réduite (sinon le message de réduction suffit). Basé sur le montant
  // ACTIONNABLE (borne basse en fourchette) : c'est lui qu'on propose en virement.
  if (guardTrough != null) {
    for (const reco of result) {
      const info = guardInfo[reco.type];
      if (info) reco.guard = info;
      if ((reco.type === 'save' || reco.type === 'invest') && !info) {
        // Durabilité jugée sur la trajectoire LONGUE quand elle est fournie : un mois atypique
        // pèse moins sur la pente, et un comportement qui ne casse qu'au 10ᵉ mois est vu.
        reco.recurringFit = computeRecurringFit(
          reco.actionAmount, guard!.sustainBalances?.length ? guard!.sustainBalances : guard!.balances, guard!.margin,
        );
      }
    }
  }
  return result;
}

/**
 * Pente mensuelle du solde projeté = SURPLUS STRUCTUREL (ce que le mois type dégage réellement,
 * virements récurrents déjà déduits puisqu'ils sont dans la trajectoire).
 *
 * Le mois 0 est PARTIEL (on est au milieu du mois courant : il ne porte que la fin du mois) — il
 * fausserait la pente vers le haut ou le bas selon le jour où on regarde. On part donc du mois 1.
 * Renvoie `null` quand la série est trop courte pour conclure.
 */
function monthlySurplus(balances: number[]): number | null {
  if (balances.length >= 3) return (balances[balances.length - 1] - balances[1]) / (balances.length - 2);
  if (balances.length === 2) return balances[1] - balances[0];
  return null;
}

/**
 * Le montant est-il tenable en le répétant chaque mois ?
 *
 * DEUX conditions, et il faut les deux :
 *
 *  1. TRANSITION — ne pas passer sous la marge pendant l'horizon projeté. Au mois k, le solde
 *     projeté supporte (k+1) exécutions cumulées → montant ≤ min sur k de (solde_k − marge) ÷ (k+1).
 *
 *  2. DURABILITÉ — le solde ne doit pas DÉCLINER. C'est la condition qui manquait : la 1ʳᵉ n'est
 *     qu'un test d'épuisement sur horizon FINI, qui répond toujours « oui » si l'horizon est assez
 *     court, puisqu'elle autorise à grignoter le matelas lentement. Un montant qui ne casse rien à
 *     6 mois pouvait mettre l'utilisateur dans le rouge au 15ᵉ. On borne donc aussi par le surplus
 *     mensuel structurel : au-delà, chaque mois retire plus que le mois ne rapporte.
 *
 * Surplus ≤ 0 → RIEN n'est tenable en récurrent : le geste ne peut être que ponctuel.
 */
export function computeRecurringFit(amount: number, balances: number[], margin: number): RecurringFit | undefined {
  if (amount <= 0 || balances.length === 0) return undefined;

  // 1) Transition : jamais sous la marge sur l'horizon projeté.
  let maxHorizon = Infinity;
  for (let k = 0; k < balances.length; k++) {
    maxHorizon = Math.min(maxHorizon, (balances[k] - margin) / (k + 1));
  }
  if (!Number.isFinite(maxHorizon)) return undefined;

  // 2) Durabilité : ne pas retirer plus que ce que le mois dégage.
  const surplus = monthlySurplus(balances);
  const maxSustainable = surplus == null ? maxHorizon : Math.min(maxHorizon, surplus);

  if (maxSustainable <= 0) return { kind: 'month_only' };
  if (amount <= maxSustainable) return { kind: 'sustainable', monthly: amount };
  const maxMonthly = Math.max(0, floorToTen(maxSustainable));
  return maxMonthly > 0 ? { kind: 'capped', monthly: maxMonthly } : { kind: 'month_only' };
}

/* `getCurrentTier` (palier déduit du MONTANT d'épargne) est parti avec le reste de l'ancienne
   échelle : plus aucun appelant, et le palier d'un utilisateur se lit désormais sur son profil
   financier (PROFILE_TO_TIER). */

/** Labels français pour les paliers */
export const TIER_LABELS: Record<SavingsTier, string> = {
  critical:      'Épargne critique',
  below_optimal: 'Épargne à renforcer',
  healthy:       'Stabilité à améliorer',
  p4_dynamic:    'Bonne dynamique',
  comfortable:   'Confortable',
};

/** Couleurs pour les paliers */
export const TIER_COLORS: Record<SavingsTier, string> = {
  critical:      '#ef4444',
  below_optimal: '#f59e0b',
  healthy:       '#3b82f6',
  p4_dynamic:    '#8b5cf6',
  comfortable:   '#34d399',
};

/** Descriptions par type pour l'admin. « Réserver » = le mot d'affichage (cf. shortTitle). */
export const RECO_TYPE_LABELS: Record<RecoType, string> = {
  save: 'Épargner',
  invest: 'Investir',
  enjoy: 'Confort',
  keep: 'Réserver',
};

export { RECO_COLORS, RECO_ICONS };

/* ── Normalisation ───────────────────────────────────────── */

function normalizeAllocations(alloc: Record<RecoType, number>) {
  const total = alloc.save + alloc.invest + alloc.enjoy + alloc.keep;
  if (total <= 0) return;
  const factor = 100 / total;
  alloc.save = Math.round(alloc.save * factor);
  alloc.invest = Math.round(alloc.invest * factor);
  alloc.enjoy = Math.round(alloc.enjoy * factor);
  alloc.keep = Math.round(alloc.keep * factor);

  // Corriger les arrondis pour que ça tombe juste à 100
  const diff = 100 - (alloc.save + alloc.invest + alloc.enjoy + alloc.keep);
  if (diff !== 0) {
    // Ajouter/retirer au poste le plus gros
    const max = Math.max(alloc.save, alloc.invest, alloc.enjoy, alloc.keep);
    if (alloc.save === max) alloc.save += diff;
    else if (alloc.invest === max) alloc.invest += diff;
    else if (alloc.enjoy === max) alloc.enjoy += diff;
    else alloc.keep += diff;
  }
}

/* ── Construction de chaque recommandation ────────────────── */

/** Montant « actionnable » interpolé dans les textes : « 90 € » ou « au moins 90 € » (minimum sûr). */
interface ActionAmount { value: number; isRange: boolean }

function amountPhrase(a: ActionAmount): string {
  return `${a.isRange ? 'au moins ' : ''}${a.value.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
}

function buildRecommendation(
  type: RecoType,
  percentage: number,
  rawAmount: number,
  tier: SavingsTier,
  data: PilotageData,
  opts?: Pick<ComputeRecoOptions, 'maxAmount' | 'actionAmountFor' | 'daysLeftInPeriod'>,
): SmartRecommendation {
  // Montant « proposition » : plafonné au reste réellement disponible (maxAmount) PUIS arrondi à la
  // dizaine inférieure → le montant affiché, les sous-textes/conseils et l'action validée
  // (virement/conservation) partagent tous cette même valeur.
  const capped = opts?.maxAmount != null ? Math.min(rawAmount, opts.maxAmount) : rawAmount;
  const amount = Math.max(0, floorToTen(capped));
  // Montant actionnable : borne basse « minimum sûr » si les montants sont en fourchette.
  // FILET : une borne basse nulle (doute plus large que le Relyka) produisait des cartes absurdes —
  // « Conserve au moins 0 € », CTA et virements pré-remplis à 0 € — pour un montant affiché non nul.
  // On retombe alors sur le montant proposé lui-même.
  const proposed = opts?.actionAmountFor?.(amount, type);
  const action: ActionAmount = proposed && proposed.value > 0 ? proposed : { value: amount, isRange: false };
  // Fin de PÉRIODE (veille de la prochaine rentrée d'argent) : « Conserver » devient explicitement
  // un report sur la période suivante.
  const periodEnd = opts?.daysLeftInPeriod != null && opts.daysLeftInPeriod <= PERIOD_END_LABEL_DAYS;
  switch (type) {
    case 'save':
      return {
        type,
        title: 'Épargner',
        shortTitle: 'Épargner',
        description: getSaveDescription(tier, action, data),
        stateNote: getSaveStateNote(tier, data),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.save,
        icon: RECO_ICONS.save,
        actionRoute: '/(tabs)/comptes',
        actionLabel: 'Transférer',
      };
    case 'invest':
      return {
        type,
        title: 'Investir',
        shortTitle: 'Investir',
        description: getInvestDescription(tier, action, data),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.invest,
        icon: RECO_ICONS.invest,
        // Investir se fait par un virement vers le compte d'investissement, comme épargner : la
        // page « Objectifs » qui portait ce geste n'existe plus.
        actionRoute: '/(tabs)/comptes',
        actionLabel: 'Transférer',
      };
    case 'enjoy':
      return {
        type,
        title: 'Confort',
        shortTitle: 'Confort',
        description: getEnjoyDescription(action, data),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.enjoy,
        icon: RECO_ICONS.enjoy,
        actionRoute: null,
        actionLabel: 'Compris',
      };
    case 'keep':
      return {
        type,
        // VOCABULAIRE FIGÉ : à l'affichage on dit « Réserver » / « Réservé » — c'est le mot employé
        // partout ailleurs dans l'app (ligne « Réservé » du suivi, montants réservés). « Reporter »
        // introduisait un troisième terme pour la même chose. « Conserver » ne subsiste que dans les
        // explications, pour dire ce que le geste FAIT.
        // « Après ta paie » plutôt que « le mois prochain » : l'horizon est la prochaine rentrée
        // d'argent, qui ne tombe pas le 1ᵉʳ pour tout le monde.
        title: periodEnd ? 'Réserver pour après ta rentrée d’argent' : 'Réserver pour plus tard',
        shortTitle: 'Réserver',
        description: getKeepDescription(action, data, periodEnd),
        amount,
        actionAmount: action.value,
        percentage,
        color: RECO_COLORS.keep,
        icon: RECO_ICONS.keep,
        actionRoute: null,
        actionLabel: 'Compris',
      };
  }
}

/* ── Descriptions contextuelles ──────────────────────────── */

/**
 * Appréciation du niveau d'épargne, formulée en TITRE (« Épargne à renforcer ») plutôt qu'en
 * suffixe (« … — niveau à renforcer »). Le jugement passe ainsi devant le chiffre, en trois mots,
 * au lieu de rallonger une phrase déjà longue.
 */
const SAVE_LEVEL_LABEL: Record<SavingsTier, string> = {
  critical:      'Épargne à constituer',
  below_optimal: 'Épargne à renforcer',
  healthy:       'Épargne correcte',
  p4_dynamic:    'Épargne solide',
  comfortable:   'Épargne confortable',
};

function getSaveDescription(tier: SavingsTier, action: ActionAmount, data: PilotageData): string {
  // Approche générique : épargne de sécurité totale + nb de mois de sécurité (= mois de DÉPENSES
  // couverts par l'épargne) + appréciation de niveau. Plus parlant qu'un écart à un « seuil » abstrait.
  const savings = Math.max(0, data.current_savings);
  // Mois de sécurité — MÊME définition que partout (lib/securityCushion) : base = les DÉPENSES.
  const months = computeSecurityCushion({
    availableSavings: savings,
    monthlyEssentialExpenses: data.monthly_essential_expenses,
    // Charges inconnues → base « dépenses » écartée (cf. lib/securityCushion) : la même règle
    // partout, sinon deux écrans annoncent deux matelas.
    recurringExpensesKnown: !!data.has_recurring_expenses,
    avgMonthlyIncome: data.avg_monthly_income,
  }).months;

  // Revenu non détecté → on n'affiche pas les « mois de sécurité » (juste le total + l'appréciation).
  const coverage = months != null ? ` (≈ ${securityMonthsLabel(months)} de sécurité)` : '';
  return `${SAVE_LEVEL_LABEL[tier]} : ${savings.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}${coverage}. \nTu peux placer ${amountPhrase(action)} ce mois-ci pour la consolider.`;
}

/**
 * État FACTUEL du matelas de sécurité, sans le montant de la reco (il est déjà sur la tuile).
 * Sert de préambule au message d'épargne du tableau de bord : c'est la seule information que la
 * description apporte et que la projection ne dit pas.
 */
function getSaveStateNote(tier: SavingsTier, data: PilotageData): string {
  const savings = Math.max(0, data.current_savings);
  const months = computeSecurityCushion({
    availableSavings: savings,
    monthlyEssentialExpenses: data.monthly_essential_expenses,
    // Charges inconnues → base « dépenses » écartée (cf. lib/securityCushion) : la même règle
    // partout, sinon deux écrans annoncent deux matelas.
    recurringExpensesKnown: !!data.has_recurring_expenses,
    avgMonthlyIncome: data.avg_monthly_income,
  }).months;
  const coverage = months != null ? ` (≈ ${securityMonthsLabel(months)} de sécurité)` : '';
  return `${SAVE_LEVEL_LABEL[tier]} : ${savings.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}${coverage}`;
}

function getInvestDescription(tier: SavingsTier, action: ActionAmount, _data: PilotageData): string {
  if (tier === 'comfortable') {
    return `Ton épargne est confortable. Tu peux placer ${amountPhrase(action)} ce mois-ci sur tes investissements, pour faire fructifier ton patrimoine.`;
  }
  if (tier === 'healthy') {
    return `Bonne santé financière ! Tu peux investir ${amountPhrase(action)} ce mois-ci pour diversifier ton patrimoine.`;
  }
  return `Tu peux investir ${amountPhrase(action)} ce mois-ci pour préparer l'avenir.`;
}

function getEnjoyDescription(action: ActionAmount, _data: PilotageData): string {
  // « Confort » = la marge totalement libre, une fois tes dépenses variables habituelles couvertes.
  // C'est elle qui est entamée en premier si tu dépenses au-delà de ton budget variable.
  //
  // ⚠️ Deux tournures, parce que `amountPhrase` préfixe « au moins » en fourchette : la phrase
  // unique donnait « Fais ce que tu veux des au moins 240 € restants », qui ne se lit pas. C'est le
  // seul texte de reco où le montant est enchâssé dans un groupe nominal.
  const somme = action.isRange
    ? `d'au moins ${action.value.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
    : `des ${action.value.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL} restants`;
  return `Fais ce que tu veux ${somme} : des loisirs, un projet qui te tient à cœur, ou réinvestis-les pour accélérer tes objectifs !`;
}

function getKeepDescription(action: ActionAmount, data: PilotageData, periodEnd = false): string {
  if (periodEnd) {
    // Fin de PÉRIODE : le geste attendu n'est plus « mettre de côté au cas où » mais « ne pas cramer
    // le reste dans les derniers jours avant la paie ». On dit où va l'argent : dans le budget d'après.
    return `Ta prochaine rentrée d'argent approche. Garde ${amountPhrase(action)} sur ton compte plutôt que de les dépenser d'ici là : tu les retrouveras dans ton budget suivant.`;
  }
  if (data.current_checking_balance < data.committed_allocations * 2) {
    return `Ton solde courant est un peu juste. Garde ${amountPhrase(action)} en réserve pour couvrir les imprévus.`;
  }
  return `Conserve ${amountPhrase(action)} sur ton compte courant comme marge de manœuvre pour le mois prochain. Cette somme sera déduite de ton Relyka pour ne pas y toucher.`;
}
