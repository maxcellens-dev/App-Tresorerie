/**
 * Logique de masquage des recommandations (pure). L'état (ignorées / complétées du mois) est
 * désormais stocké CÔTÉ COMPTE via `useRecoDismissals` (profiles.ui_prefs), plus en local.
 *
 * Deux notions :
 *  • `ignored`   — « Ignorer » : on mémorise le MONTANT au moment de l'ignore. La reco reste
 *                  masquée tant que le montant recalculé est PROCHE ; si la situation change
 *                  vraiment, elle réapparaît.
 *  • `completed` — l'utilisateur a agi (virement validé / réservation) → masquée jusqu'au mois suivant.
 */
import type { RecoType } from './recommendationEngine';

/**
 * Tolérance de réapparition : ±10 % du montant ignoré, avec un minimum de 20 €.
 * Le montant d'une reco bouge de quelques euros chaque jour (dépenses saisies, arrondis) — avec une
 * égalité stricte, une reco « ignorée » revenait dès le lendemain, ce qui vidait le geste de sens.
 */
function ignoreTolerance(ignoredAmount: number): number {
  return Math.max(20, Math.round(Math.abs(ignoredAmount) * 0.1));
}

/** Une reco est masquée si « complétée », ou « ignorée » à un montant proche. */
export function isHidden(type: RecoType, amount: number, ignored: Record<string, number>, completed: string[]): boolean {
  if (completed.includes(type)) return true;
  const ignoredAmount = ignored[type];
  if (ignoredAmount === undefined) return false;
  return Math.abs(Math.round(amount) - ignoredAmount) <= ignoreTolerance(ignoredAmount);
}
