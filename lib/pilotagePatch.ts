/**
 * LE TABLEAU DE BORD BOUGE À L'INSTANT DE LA SAISIE.
 * ──────────────────────────────────────────────────────────────────────────────
 * Le Relyka, les soldes et le budget du quotidien ne se mettaient à jour qu'au retour du refetch de
 * `pilotage_data` : onze requêtes, jusqu'à huit mois de transactions jointes, puis le moteur. Sur
 * mobile, plusieurs secondes pendant lesquelles l'écran affichait les ANCIENS chiffres **comme s'ils
 * étaient définitifs** — puis ils sautaient. C'est ce saut qui n'est pas professionnel, pas l'attente.
 *
 * On applique donc l'effet de l'opération au cache TOUT DE SUITE, par la même arithmétique que la
 * carte de confirmation (cf. lib/pulseDelta) : ce sont les mêmes règles, elles doivent donner le même
 * résultat, sinon la carte et l'écran derrière elle se contrediraient. Le refetch, quand il arrive,
 * ne fait plus que confirmer.
 *
 * PÉRIMÈTRE ASSUMÉ — on ne touche QUE les chiffres dont le Relyka et les soldes dépendent
 * directement, et uniquement pour une opération ÉCHUE (datée d'aujourd'hui ou avant) :
 *  • une opération FUTURE déplace le point bas de façon qui dépend de la date du creux — on ne
 *    devine pas, on laisse le refetch trancher ;
 *  • les moyennes, tendances et projections ne sont pas patchées : une opération ne les déplace
 *    que marginalement, et les recalculer de tête serait inventer.
 */

/** Les seuls champs du Pilotage que ce patch touche (structurel : pas de dépendance au hook). */
export interface PilotageBalances {
  /** Point bas du solde courant simulé — la base du Relyka. */
  cashflow_trough: number;
  current_checking_balance: number;
  total_checking: number;
  total_savings: number;
  total_invested: number;
  variable_envelope_initial: number;
  variable_envelope_spent: number;
  variable_envelope_remaining: number;
}

export interface PilotageOp {
  /**
   * Montant SIGNÉ porté sur le compte (négatif = sortie d'argent). À la SUPPRESSION d'une ligne,
   * c'est l'effet inverse de celle-ci : supprimer une dépense de 100 € vaut `+100`.
   */
  amount: number;
  /** Type du compte touché ('checking' | 'savings' | 'investment' | …). */
  accountType?: string;
  /** Date de l'opération (AAAA-MM-JJ). */
  date: string;
  /**
   * Déjà comprise dans une régularisation de solde du même jour : AUCUN solde ne bouge (la régul
   * l'a déjà absorbée). L'enveloppe variable, elle, est bien consommée — comme dans pulseDelta.
   */
  regulCovered?: boolean;
  /** Dépense du quotidien qui consomme l'enveloppe variable du mois. */
  hitsVariableEnvelope?: boolean;
}

/**
 * Renvoie une COPIE du tableau de bord où l'opération est prise en compte. `data` absent (cache
 * vide) → rien à devancer. La référence est conservée si rien ne change, pour ne pas re-rendre
 * tous les écrans abonnés pour rien.
 */
export function applyOpToPilotage<T extends PilotageBalances>(
  data: T | undefined,
  op: PilotageOp,
  todayStr: string,
  /** Mois courant (AAAA-MM) — l'enveloppe variable ne concerne que lui. */
  monthKey = todayStr.slice(0, 7),
): T | undefined {
  if (!data) return data;
  // Opération pas encore échue : elle n'est dans aucun solde, et son effet sur le point bas dépend
  // de la date du creux. On ne présume rien (cf. en-tête).
  if (op.date > todayStr) return data;

  const raw = Number(op.amount) || 0;
  const delta = op.regulCovered ? 0 : raw;
  /* Ce que l'opération prend à l'enveloppe vaut EXACTEMENT l'opposé de son impact sur le compte :
     une dépense variable de 100 € pose −100 sur le compte et +100 de consommé. La suppression de
     cette même dépense pose +100 sur le compte et RECRÉDITE donc 100 € d'enveloppe — c'est la même
     formule, sans cas particulier. On part du montant BRUT et non de `delta` : une opération
     couverte par la régul du jour ne bouge aucun solde mais consomme bel et bien l'enveloppe. */
  const consumed = op.hitsVariableEnvelope && op.date.slice(0, 7) === monthKey ? -raw : 0;
  if (delta === 0 && consumed === 0) return data;

  const next: T = { ...data };

  if (delta !== 0) {
    if (op.accountType === 'savings') next.total_savings = data.total_savings + delta;
    else if (op.accountType === 'investment') next.total_invested = data.total_invested + delta;
    else if (op.accountType === 'checking' || op.accountType === undefined) {
      // Le point bas suit le solde du jour : une opération échue décale TOUTE la trajectoire
      // simulée du même montant, donc le creux aussi — quelle que soit sa date.
      next.cashflow_trough = data.cashflow_trough + delta;
      next.current_checking_balance = data.current_checking_balance + delta;
      next.total_checking = data.total_checking + delta;
    }
  }

  if (consumed !== 0) {
    // Le « dépensé » ne peut pas devenir négatif (suppressions en série d'un mois déjà vidé).
    next.variable_envelope_spent = Math.max(0, data.variable_envelope_spent + consumed);
    next.variable_envelope_remaining = Math.max(0, data.variable_envelope_initial - next.variable_envelope_spent);
  }

  return next;
}
