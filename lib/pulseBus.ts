/**
 * POULS — bus d'événements de saisie.
 *
 * Les mutations (ajout de transaction, virement) émettent ICI, quel que soit l'écran d'où
 * l'utilisateur a validé. Un hôte unique monté au niveau racine (components/PulseDeltaHost) écoute
 * et affiche les pastilles. Conséquence : aucun écran de saisie n'a à connaître le Pouls.
 *
 * L'événement porte des IDENTIFIANTS de comptes, pas des types : c'est l'hôte qui connaît les
 * comptes (il les a déjà en cache) — les mutations n'ont pas à aller les chercher.
 */

export interface PulseOpEvent {
  kind: 'expense' | 'income' | 'transfer';
  /** Montant POSITIF de l'opération. */
  amount: number;
  /** Dépense / recette : le compte touché. */
  accountId?: string;
  /** Virement : comptes source et destination. */
  fromAccountId?: string;
  toAccountId?: string;
  /** Opération datée dans le futur : le solde d'aujourd'hui ne bouge pas encore. */
  isFuture?: boolean;
  /**
   * Date de l'opération (YYYY-MM-DD). Sert à savoir si elle tombe DANS le mois courant : c'est la
   * condition pour qu'elle déplace le solde projeté de fin de mois (une dépense datée du mois
   * prochain ne change rien au 1er du mois qui vient).
   */
  date?: string;
}

type Listener = (event: PulseOpEvent) => void;

const listeners = new Set<Listener>();

export function emitPulseOp(event: PulseOpEvent): void {
  for (const listener of listeners) {
    try { listener(event); } catch { /* un écouteur ne doit jamais faire échouer une saisie */ }
  }
}

export function subscribePulseOp(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
