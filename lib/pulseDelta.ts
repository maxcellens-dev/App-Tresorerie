/**
 * LE « LIVE » — ce qui bouge quand l'utilisateur enregistre une opération.
 * ──────────────────────────────────────────────────────────────────────────────
 * Après chaque saisie (dépense, recette, virement), on lui montre :
 *   1. l'EFFET DIRECT de son geste (« Épargne : +200 € ») — affiché immédiatement, sans attendre ;
 *   2. l'impact sur son RELYKA (la métrique n°1 de l'app) ;
 *   3. son solde de FIN DE MOIS recalculé.
 *
 * Rien ne disparaît tout seul : l'utilisateur ferme au tap ou en balayant vers le haut.
 */

export type PulseAccountType = 'checking' | 'savings' | 'investment' | string;

/**
 * Teinte d'une pastille de confirmation. Elle décrit le GESTE qu'on vient d'enregistrer
 * (de l'argent entre, de l'argent sort, le compte passerait dans le rouge) — ce n'est PAS un
 * jugement de l'état des lieux, qui lui n'a plus ni statut ni couleur.
 */
export type PulseTone = 'positive' | 'neutral' | 'caution' | 'negative';

export interface PulseOp {
  kind: 'expense' | 'income' | 'transfer';
  /** Montant POSITIF de l'opération. */
  amount: number;
  /** Dépense / recette : type du compte touché. */
  accountType?: PulseAccountType;
  /** Virement : types des comptes source et destination. */
  fromType?: PulseAccountType;
  toType?: PulseAccountType;
  /** Opération datée dans le futur (planifiée) — le solde d'aujourd'hui ne bouge pas encore. */
  isFuture?: boolean;
  /** Date de l'opération (YYYY-MM-DD) — pour savoir si elle tombe dans le mois courant. */
  date?: string;
  /**
   * L'opération est DÉJÀ comprise dans une régularisation de solde du même jour (réponse « oui,
   * déjà incluse » — cf. useAddTransaction / regul_covered). Le solde du compte NE BOUGE PAS :
   * annoncer « −750 € sur ta fin de mois » était alors totalement faux.
   */
  regulCovered?: boolean;
  /**
   * Dépense qui CONSOMME l'enveloppe variable du mois (dépense du quotidien, non récurrente, sur un
   * compte courant). Son effet sur la fin de mois est ABSORBÉ par l'enveloppe restante : le solde
   * projeté retirait déjà ces dépenses « à venir », les réaliser ne le change donc pas.
   */
  hitsVariableEnvelope?: boolean;
}

export interface PulseDeltaChip {
  key: string;
  text: string;
  tone: PulseTone;
}

export interface PulseFeedback {
  chips: PulseDeltaChip[];
  /** Solde projeté au 1er du mois suivant, recalculé PAR ARITHMÉTIQUE (cf. computeEndOfMonth). */
  endOfMonth: EndOfMonthPreview | null;
}

export interface EndOfMonthPreview {
  /** Nouveau solde projeté au 1er du mois suivant. */
  amount: number;
  /** Ce que l'opération vient de lui faire (0 = elle ne le déplace pas). */
  delta: number;
  /** Le solde projeté passe-t-il sous la marge de sécurité ? (marge > 0 uniquement) */
  belowMargin: boolean;
  /** Le solde projeté passe-t-il dans le rouge ? */
  negative: boolean;
  /**
   * L'opération CONCERNE-t-elle ce solde (mois courant + au moins une jambe sur un compte courant) ?
   * Sépare « ça ne me concerne pas » (→ pas de ligne) de « ça me concerne mais l'écart est nul »
   * (dépense absorbée par l'enveloppe, opération déjà comprise dans la régul du jour…) : dans ce
   * second cas le CHIFFRE reste utile, c'est le « (−750 €) » qui serait faux.
   */
  concerns: boolean;
  /** Le chiffre est-il le solde RECALCULÉ (exact) plutôt que l'estimation arithmétique immédiate ? */
  exact: boolean;
}

/** Clé de mois `YYYY-MM` d'une date locale. */
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * L'opération CONCERNE-t-elle le solde courant projeté de fin de mois ? (mois courant + au moins une
 * jambe sur un compte courant). Indépendant de l'ÉCART : une dépense variable du jour ne déplace pas
 * ce solde (elle était déjà provisionnée dans l'enveloppe) mais le chiffre reste ce que
 * l'utilisateur veut voir après sa saisie.
 */
export function touchesEndOfMonth(op: PulseOp, today: Date): boolean {
  if (!op.date || op.date.slice(0, 7) !== monthKeyOf(today)) return false;
  if (op.kind === 'transfer') return op.fromType === 'checking' || op.toType === 'checking';
  return op.accountType === 'checking';
}

/**
 * FIN DE MOIS — ESTIMATION immédiate, par arithmétique.
 *
 * Sert uniquement le temps que le Pouls se recalcule : dès que les données fraîches arrivent, c'est
 * le solde RECALCULÉ qui s'affiche (cf. computeOpFeedback). L'estimation existe parce que la carte
 * apparaît à l'instant de la saisie : elle doit être PROCHE, sinon le chiffre saute sous les yeux.
 *
 * Le solde projeté vaut `point bas − virements épargne/invest à venir − enveloppe variable restante`
 * (cf. hooks/usePulse). D'où les deux corrections, longtemps absentes, qui rendaient le chiffre
 * « totalement faux » :
 *
 *  1. RÉGULARISATION DU MÊME JOUR. Répondre « oui, déjà incluse » pose `regul_covered` : le solde du
 *     compte ne bouge PAS (la régul l'a déjà absorbée). Seule l'enveloppe variable est consommée.
 *  2. ENVELOPPE VARIABLE. Une dépense du quotidien déjà ÉCHUE creuse le solde ET consomme
 *     l'enveloppe restante, qui était justement déduite du solde projeté : les deux s'annulent tant
 *     qu'il reste de l'enveloppe. Annoncer « −100 € » à chaque course était l'erreur la plus visible
 *     — le vrai chiffre ne bougeait pas.
 *
 * Reste inchangé : recette/dépense hors compte courant → 0 ; virement courant → ailleurs → −
 * montant, l'inverse → + montant ; courant → courant → 0 ; hors du mois courant → 0.
 */
export function computeEndOfMonthDelta(op: PulseOp, today: Date, variableEnvelopeRemaining = 0): number {
  // Sans date connue, on ne présume rien plutôt que d'annoncer un chiffre faux.
  if (!op.date) return 0;
  if (op.date.slice(0, 7) !== monthKeyOf(today)) return 0;

  const amount = Math.abs(op.amount);

  // Part de la dépense ABSORBÉE par l'enveloppe variable restante (dépense échue uniquement : une
  // dépense datée plus tard n'est pas encore « consommée », elle s'ajoute au creux projeté).
  const absorbed = op.kind === 'expense' && op.hitsVariableEnvelope && !op.isFuture
    ? Math.min(amount, Math.max(0, variableEnvelopeRemaining))
    : 0;

  // Effet sur le solde lui-même — nul si l'opération est déjà comprise dans la régul du jour.
  let balanceDelta = 0;
  if (!op.regulCovered) {
    if (op.kind === 'income') balanceDelta = op.accountType === 'checking' ? amount : 0;
    else if (op.kind === 'expense') balanceDelta = op.accountType === 'checking' ? -amount : 0;
    else {
      const fromChecking = op.fromType === 'checking';
      const toChecking = op.toType === 'checking';
      balanceDelta = fromChecking && !toChecking ? -amount : !fromChecking && toChecking ? amount : 0;
    }
  }

  return balanceDelta + absorbed;
}

const eur = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('fr-FR')} €`;

/** Libellé du compte touché — une plus-value saisie sur un compte d'investissement ne doit pas
 *  s'annoncer « Compte courant » (cas réel : saisie gain/perte depuis le détail de compte). */
const ACCOUNT_LABEL: Record<string, string> = {
  checking: 'Compte courant',
  savings: 'Épargne',
  investment: 'Investissement',
};

/** Effet direct : la phrase que l'utilisateur attend juste après avoir validé. */
function directChip(op: PulseOp): PulseDeltaChip {
  const amount = Math.abs(op.amount);
  const accountLabel = ACCOUNT_LABEL[op.accountType ?? ''] ?? 'Compte courant';

  if (op.kind === 'income') {
    return {
      key: 'direct',
      text: op.isFuture ? `Recette prévue : +${eur(amount)}` : `${accountLabel} : +${eur(amount)}`,
      tone: 'positive',
    };
  }

  if (op.kind === 'expense') {
    // Sortie directe sur l'épargne ou l'invest (moins-value, retrait) : on nomme le compte.
    if (op.accountType === 'savings' || op.accountType === 'investment') {
      return { key: 'direct', text: `${accountLabel} : −${eur(amount)}`, tone: 'caution' };
    }
    // Constat : une dépense normale n'a pas à s'afficher en orange.
    return {
      key: 'direct',
      text: op.isFuture ? `Dépense prévue : −${eur(amount)}` : `Dépense : −${eur(amount)}`,
      tone: 'neutral',
    };
  }

  // Virement : ce qui compte, c'est OÙ va l'argent.
  if (op.toType === 'savings') return { key: 'direct', text: `Épargne : +${eur(amount)}`, tone: 'positive' };
  if (op.toType === 'investment') return { key: 'direct', text: `Investi : +${eur(amount)}`, tone: 'positive' };
  if (op.fromType === 'savings' || op.fromType === 'investment') {
    return {
      key: 'direct',
      text: `${eur(amount)} repris sur ton ${op.fromType === 'savings' ? 'épargne' : 'investissement'}`,
      tone: 'caution',
    };
  }
  // Courant → courant : l'argent ne quitte pas le budget du quotidien.
  return { key: 'direct', text: `${eur(amount)} déplacés — ton budget ne change pas`, tone: 'neutral' };
}

/**
 * Le Relyka, TOUJOURS affiché (c'est LA métrique que l'utilisateur suit) — juste sa nouvelle valeur,
 * sans l'écart (qui ferait doublon avec le montant de la transaction affiché à côté).
 * On l'affiche même si le montant n'a pas bougé : une dépense dans l'enveloppe variable ne change
 * pas le Relyka (elle était déjà budgétée), mais le voir stable est rassurant, pas déroutant.
 */
function relykaChip(before: number | null, after: number | null): PulseDeltaChip | null {
  // Chiffres pas encore sûrs → on garde la pastille avec un tiret : la carte a sa forme définitive
  // dès l'ouverture et se remplit sans rien déplacer.
  if (after == null) return { key: 'relyka', text: 'Ton Relyka : —', tone: 'neutral' };
  const diff = before != null ? Math.round(after) - Math.round(before) : 0;
  return {
    key: 'relyka',
    text: `Ton Relyka : ${eur(after)}`,
    tone: after <= 0 ? 'negative' : diff < 0 ? 'caution' : 'positive',
  };
}

const MAX_CHIPS = 3;

/**
 * Retour à afficher pour une opération : l'effet direct (toujours exact, affiché sans attendre),
 * le Relyka recalculé, et le solde de fin de mois.
 * `relykaAfter` null = chiffres recalculés pas encore sûrs → la pastille garde un tiret et se
 * remplit dès qu'ils arrivent (la carte a sa forme définitive dès l'ouverture).
 */
export function computeOpFeedback(
  op: PulseOp,
  relykaBefore: number | null,
  relykaAfter: number | null,
  /** Solde projeté au 1er du mois suivant : AVANT la saisie, APRÈS recalcul (null tant que
   *  les données ne sont pas fraîches), marge de sécurité et enveloppe variable restante d'avant. */
  endOfMonth?: {
    before: number | null;
    after?: number | null;
    margin: number;
    variableEnvelopeRemaining?: number;
    today?: Date;
  },
): PulseFeedback {
  const chips: PulseDeltaChip[] = [directChip(op)];

  const relyka = relykaChip(relykaBefore, relykaAfter);
  if (relyka) chips.push(relyka);

  // Fin de mois : estimée sur place (jamais attendue), puis REMPLACÉE par le solde recalculé dès
  // qu'il est frais — c'est lui qui fait foi, quelle que soit la situation de saisie (régularisation
  // du jour, enveloppe variable, projet, crédit…). L'écart affiché se déduit du chiffre retenu :
  // jamais un « (−750 €) » qui ne correspond pas au solde annoncé juste à côté.
  // Rien si on ne connaît pas le solde projeté d'AVANT : on préfère ne rien dire à un tiret.
  let endOfMonthPreview: EndOfMonthPreview | null = null;
  if (endOfMonth && endOfMonth.before != null) {
    const today = endOfMonth.today ?? new Date();
    const estimated = endOfMonth.before + computeEndOfMonthDelta(op, today, endOfMonth.variableEnvelopeRemaining ?? 0);
    const exact = endOfMonth.after != null;
    const amount = exact ? endOfMonth.after! : estimated;
    endOfMonthPreview = {
      amount,
      delta: amount - endOfMonth.before,
      belowMargin: endOfMonth.margin > 0 && amount < endOfMonth.margin,
      negative: amount < 0,
      concerns: touchesEndOfMonth(op, today),
      exact,
    };
  }

  return { chips: chips.slice(0, MAX_CHIPS), endOfMonth: endOfMonthPreview };
}
