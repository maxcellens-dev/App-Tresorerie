/**
 * Logique de masquage des recommandations (pure). L'état (ignorées / complétées du mois) est
 * désormais stocké CÔTÉ COMPTE via `useRecoDismissals` (profiles.ui_prefs), plus en local.
 *
 * Deux notions :
 *  • `ignored`   — « Ignorer » : on mémorise le MONTANT au moment de l'ignore. La reco reste
 *                  masquée tant que le montant recalculé est identique ; si la situation change,
 *                  elle réapparaît.
 *  • `completed` — l'utilisateur a agi (virement validé / réservation) → masquée jusqu'au mois suivant.
 */
import type { RecoType } from './recommendationEngine';

/** Une reco est masquée si « complétée », ou « ignorée » avec le même montant. */
export function isHidden(type: RecoType, amount: number, ignored: Record<string, number>, completed: string[]): boolean {
  if (completed.includes(type)) return true;
  const ignoredAmount = ignored[type];
  return ignoredAmount !== undefined && ignoredAmount === Math.round(amount);
}
