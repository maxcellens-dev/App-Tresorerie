/**
 * Clés de mois (`2026-08`) — arithmétique et libellés.
 *
 * Ces quatre fonctions sont PURES et vivaient dans `hooks/useMonthlyClosure`, qui tire react-query
 * et Supabase : en dépendre depuis un module de calcul rendait ce dernier intestable en Node. Elles
 * n'ont aucun rapport avec l'accès aux données — seulement avec des dates.
 *
 * `hooks/useMonthlyClosure` les réexporte : les neuf fichiers qui les importent depuis là ne
 * changent pas de chemin (même schéma que `usePilotageData` → `lib/pilotageEngine`).
 *
 * ⚠️ Tout est en heure LOCALE, jamais UTC (cf. note `today-utc-vs-local`) : un `toISOString()`
 * poserait le dernier jour du mois la veille au soir pour la moitié du globe.
 */

/** `2026-08` pour la date donnée. */
export function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Décale une clé de mois de `n` mois (négatif pour reculer). */
export function addMonthKey(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return ym(d);
}

/** Dernier jour du mois, en ISO — `2026-02` → `2026-02-28`. */
export function lastDayOfMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0); // jour 0 du mois suivant = dernier jour du mois
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** « août 2026 » — libellé lisible d'une clé de mois. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
