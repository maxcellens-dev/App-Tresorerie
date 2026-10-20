/**
 * Moment de la journée du Jardin : la scène suit l'heure LOCALE de l'appareil (jamais l'UTC).
 * Jour 7 h 30 → 18 h 30, crépuscule autour (6 h → 7 h 30 et 18 h 30 → 21 h 30), nuit le reste.
 * Une page peut le forcer (vitrine, captures) via l'option `moment` de la scène.
 */
export type Moment = 'day' | 'dusk' | 'night';

export function momentFor(date: Date = new Date()): Moment {
  const m = date.getHours() * 60 + date.getMinutes();
  if (m >= 7 * 60 + 30 && m < 18 * 60 + 30) return 'day';
  if ((m >= 6 * 60 && m < 7 * 60 + 30) || (m >= 18 * 60 + 30 && m < 21 * 60 + 30)) return 'dusk';
  return 'night';
}
