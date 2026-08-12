/**
 * RYTHME de dépenses variables — « à ce train-là, où en serai-je en fin de mois ? »
 *
 * Pourquoi ce module : l'app comparait le CUMUL du mois en cours à l'enveloppe ENTIÈRE du mois
 * (`variable_trend_percentage`). C'est un taux de REMPLISSAGE, pas une tendance : le 3 du mois il
 * vaut mécaniquement 5 %, le 28 il vaut mécaniquement 95 %, quel que soit le comportement réel.
 * Les deux consommateurs en tiraient des conclusions fausses :
 *   • le moteur de recos lisait « dépenses en baisse » et gonflait « Confort » en début de mois,
 *     puis le laissait fondre au fil des jours sans qu'aucune dépense ne l'explique ;
 *   • le Reporting félicitait (« 88 % sous ton budget habituel, beau contrôle 👌 ») le 4 du mois.
 *
 * Ici on rapporte le dépensé à l'AVANCEMENT de la période : 200 € dépensés à la moitié d'un mois
 * à 400 € = 100 % (pile dans les clous), pas 50 %. Le chiffre devient comparable à lui-même
 * n'importe quel jour du mois, ce qui est exactement ce que supposaient les seuils qui le lisent.
 */

/**
 * En dessous de cette part du mois écoulée, on ne conclut RIEN (null) : sur 2 jours, une seule
 * course extrapole à +300 % et une journée sans dépense à 0 %. Mieux vaut se taire que crier.
 */
export const MIN_ELAPSED_RATIO = 0.25;

export interface VariablePaceInput {
  /** Dépenses variables déjà engagées sur la période. */
  spent: number;
  /** Enveloppe variable de la période ENTIÈRE (référence habituelle). */
  envelope: number;
  /** Jour courant dans la période (1 = premier jour). */
  dayOfMonth: number;
  /** Longueur de la période en jours. */
  daysInMonth: number;
}

/**
 * Renvoie le rythme en % de l'enveloppe (100 = pile le rythme habituel), ou `null` quand il est
 * trop tôt — ou qu'il n'y a pas d'enveloppe de référence — pour conclure quoi que ce soit.
 */
export function variablePacePercentage(input: VariablePaceInput): number | null {
  const { spent, envelope, dayOfMonth, daysInMonth } = input;
  if (!(envelope > 0) || !(daysInMonth > 0)) return null;
  const elapsed = Math.min(1, Math.max(0, dayOfMonth / daysInMonth));
  if (elapsed < MIN_ELAPSED_RATIO) return null;
  // Dépensé ramené au mois COMPLET, puis rapporté à l'enveloppe du mois complet.
  return ((Math.max(0, spent) / elapsed) / envelope) * 100;
}
