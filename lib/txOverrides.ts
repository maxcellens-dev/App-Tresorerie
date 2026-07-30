import type { TransactionMonthOverride } from '../types/database';

/**
 * Overrides d'échéance (« modifier CETTE échéance ») appliqués à une LIGNE BRUTE.
 *
 * La page Transactions déplie chaque récurrente en une occurrence par mois affiché et applique
 * l'override du mois affiché. Les écrans qui lisent les lignes BRUTES (détail d'un compte) ne
 * dépliaient rien : ils affichaient le montant/la date du MODÈLE, donc une échéance modifiée
 * « pour ce mois seulement » y restait à l'ancienne valeur → les deux écrans montraient la même
 * transaction avec deux montants. Ce module applique l'override sur la ligne brute, en gardant
 * le mois d'ancrage (`instance_month`) pour que « Modifier » ouvre bien CETTE échéance.
 *
 * Après matérialisation, l'ancre du modèle est la prochaine occurrence NON échue : le mois de la
 * ligne brute EST donc le mois de l'occurrence à venir → la clé d'override se dérive de sa date.
 */
export type OverrideMap = Record<string, { amount: number | null; date?: string | null }>;

export function overrideKey(transactionId: string, year: number, month: number): string {
  return `${transactionId}:${year}:${month}`;
}

export function buildOverrideMap(overrides: TransactionMonthOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const o of overrides) {
    map[overrideKey(o.transaction_id, o.year, o.month)] = { amount: o.override_amount, date: o.override_date };
  }
  return map;
}

/** Mois d'ancrage (YYYY-MM) de l'occurrence portée par une ligne récurrente brute. */
export function instanceMonthOf(t: { date: string; is_recurring?: boolean | null }): string | null {
  if (!t.is_recurring || !t.date) return null;
  return t.date.slice(0, 7);
}

/**
 * Renvoie la ligne avec le montant / la date de l'échéance de SON mois d'ancrage.
 * `instance_month` est posé sur toute ligne récurrente (même sans override) : c'est le paramètre
 * `instanceDate` attendu par l'éditeur pour modifier UNE échéance et non toute la série.
 */
export function applyMonthOverride<T extends { id: string; date: string; amount: number; is_recurring?: boolean | null }>(
  t: T,
  map: OverrideMap,
): T & { instance_month?: string } {
  const month = instanceMonthOf(t);
  if (!month) return t;
  const [year, m] = month.split('-').map(Number);
  const ovr = map[overrideKey(t.id, year, m)];
  if (!ovr) return { ...t, instance_month: month };
  return {
    ...t,
    instance_month: month,
    ...(ovr.amount != null ? { amount: Number(ovr.amount) } : {}),
    ...(ovr.date ? { date: ovr.date } : {}),
  };
}

export function applyMonthOverrides<T extends { id: string; date: string; amount: number; is_recurring?: boolean | null }>(
  list: T[],
  map: OverrideMap,
): (T & { instance_month?: string })[] {
  return list.map((t) => applyMonthOverride(t, map));
}
