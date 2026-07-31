/**
 * Part d'une récurrente qui compte sur le MOIS COURANT — et surtout : ce qui est déjà PASSÉ.
 *
 * ⚠ Sémantique de la matérialisation (migration 030) : pour chaque occurrence échue, une VRAIE
 * ligne est créée (`materialized_from` = id du modèle, `is_recurring = false`) PUIS la date du
 * modèle est avancée à l'occurrence suivante. Un modèle vivant est donc TOUJOURS ancré dans le
 * futur — on ne peut rien conclure de sa seule date.
 *
 * L'ancienne règle « modèle avancé ⇒ l'échéance de ce mois est passée » se trompait dès que
 * l'utilisateur SUPPRIMAIT l'occurrence : la ligne disparaissait, le modèle restait avancé, et le
 * Suivi du mois continuait d'afficher une dépense qui n'existait plus.
 *
 * Règle appliquée ici : **le réel prime**. Une occurrence matérialisée du mois fait foi (avec son
 * montant effectif, échéance modifiée comprise). Sinon, on ne projette le modèle que s'il est
 * ENCORE ancré sur le mois courant.
 */

export interface RecurrenceTemplate {
  id: string;
  date: string;                       // ancre du modèle (ISO)
  amount: number;                     // montant signé du modèle
  recurrence_rule?: string | null;
  recurrence_end_date?: string | null;
}

export interface MaterializedMonth {
  /** Somme des montants absolus réellement matérialisés ce mois pour ce modèle. */
  total: number;
  /** Nombre d'occurrences matérialisées ce mois. */
  count: number;
  /** Date de la dernière occurrence matérialisée du mois (tri / affichage). */
  lastDate: string;
}

export type MaterializedIndex = Map<string, MaterializedMonth>;

/** Occurrences matérialisées du mois `monthPrefix` (YYYY-MM), indexées par id de modèle. */
export function buildMaterializedIndex(
  transactions: Array<{ materialized_from?: string | null; date?: string | null; amount: number; is_draft?: boolean }>,
  monthPrefix: string,
): MaterializedIndex {
  const index: MaterializedIndex = new Map();
  for (const t of transactions) {
    const tpl = t.materialized_from;
    const d = String(t.date ?? '');
    if (!tpl || t.is_draft || d.slice(0, 7) !== monthPrefix) continue;
    const e = index.get(tpl) ?? { total: 0, count: 0, lastDate: d };
    e.total += Math.abs(Number(t.amount));
    e.count += 1;
    if (d > e.lastDate) e.lastDate = d;
    index.set(tpl, e);
  }
  return index;
}

export interface RecurrenceMonthPart {
  /** Montant attendu sur le mois (passé + à venir). */
  total: number;
  /** Part déjà échue — celle qui a réellement quitté le compte. */
  passed: number;
}

const ZERO: RecurrenceMonthPart = { total: 0, passed: 0 };

/** Part d'un modèle récurrent sur le mois de `now`, en s'appuyant d'abord sur les lignes réelles. */
export function recurrenceForMonth(
  t: RecurrenceTemplate,
  materialized: MaterializedIndex,
  now: Date,
): RecurrenceMonthPart {
  const y = now.getFullYear(), mo = now.getMonth() + 1, dToday = now.getDate();
  const daysInMonth = new Date(y, mo, 0).getDate();
  const monthStart = new Date(y, mo - 1, 1), monthEnd = new Date(y, mo, 0);
  const thisIdx = y * 12 + (mo - 1);

  const amt = Math.abs(Number(t.amount));
  const start = new Date(String(t.date ?? '').slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return ZERO;
  const end = t.recurrence_end_date ? new Date(String(t.recurrence_end_date).slice(0, 10) + 'T00:00:00') : null;
  const rule = t.recurrence_rule;
  const startIdx = start.getFullYear() * 12 + start.getMonth();
  const day = Math.min(start.getDate(), daysInMonth);
  const mat = materialized.get(t.id);

  if (rule === 'weekly') {
    // Passé = occurrences RÉELLEMENT matérialisées ce mois. Futur = projection depuis l'ancre, que
    // la matérialisation a déjà avancée après la dernière échue → les deux ne se recouvrent pas.
    // (Si la matérialisation n'a pas encore tourné — hors ligne — l'ancre est encore dans le passé
    // et la projection reprend le relais, d'où le test du jour.)
    let total = mat?.total ?? 0, passed = mat?.total ?? 0;
    const d = new Date(start);
    while (d < monthStart) d.setDate(d.getDate() + 7);
    while (d <= monthEnd && (!end || d <= end)) {
      total += amt;
      if (d.getDate() <= dToday) passed += amt;
      d.setDate(d.getDate() + 7);
    }
    return { total, passed };
  }

  // Le RÉEL prime : une occurrence matérialisée ce mois fait foi, à son montant effectif.
  if (mat) return { total: mat.total, passed: mat.total };
  if (end && end < monthStart) return ZERO;
  // Aucune ligne réelle : l'échéance n'existe ce mois que si le modèle y est ENCORE ancré. Un
  // modèle ancré plus loin = occurrence déjà consommée puis SUPPRIMÉE, ou récurrente qui démarre
  // plus tard. Dans les deux cas, rien à compter ce mois.
  if (startIdx > thisIdx) return ZERO;
  const occursThisMonth =
    rule === 'monthly' ? true
    : rule === 'yearly' ? start.getMonth() === mo - 1
    : rule === 'quarterly' ? ((((thisIdx - startIdx) % 3) + 3) % 3 === 0)
    : false;
  if (!occursThisMonth) return ZERO;
  // La matérialisation n'a pas (encore) tourné : on projette, échue si son jour l'est (aujourd'hui inclus).
  return { total: amt, passed: day <= dToday ? amt : 0 };
}

/**
 * Montant SIGNÉ d'un modèle récurrent sur un mois DONNÉ (passé ou futur), échéance modifiée
 * comprise. C'est la projection « à plat » : contrairement à `recurrenceForMonth`, elle ne
 * s'appuie pas sur les lignes réelles — elle sert à PROJETER des mois où rien n'existe encore
 * (trésorerie prévue, mois à venir du Reporting).
 *
 * Extraite de lib/tresoProjection (à l'identique) pour que la Projection et le Reporting comptent
 * les mêmes échéances aux mêmes mois : deux copies de cette arithmétique auraient fini par diverger.
 *
 * `overridesMap` : `${transactionId}:${year}:${month}` → montant FINAL signé de CETTE échéance.
 */
export function recurringAmountForMonth(
  t: RecurrenceTemplate,
  year: number,
  month: number,
  overridesMap: Record<string, number> = {},
): number {
  const okey = `${t.id}:${year}:${month}`;
  if (overridesMap[okey] !== undefined) return overridesMap[okey];
  const rule = t.recurrence_rule;
  const start = new Date(t.date);
  const end = t.recurrence_end_date ? new Date(t.recurrence_end_date) : new Date(year + 5, 0, 1);
  const msStart = new Date(year, month - 1, 1);
  const msEnd = new Date(year, month, 0);
  if (start > msEnd || end < msStart) return 0;
  if (rule === 'monthly') return Number(t.amount);
  if (rule === 'quarterly') {
    const sm = start.getFullYear() * 12 + start.getMonth();
    const tm = year * 12 + (month - 1);
    return (tm - sm) % 3 === 0 && tm >= sm ? Number(t.amount) : 0;
  }
  if (rule === 'yearly') return start.getMonth() === month - 1 ? Number(t.amount) : 0;
  if (rule === 'weekly') {
    let count = 0; const d = new Date(start);
    while (d <= msEnd) { if (d >= msStart && d <= end) count++; d.setDate(d.getDate() + 7); }
    return count * Number(t.amount);
  }
  return 0;
}
