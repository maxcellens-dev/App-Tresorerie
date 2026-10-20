/**
 * « À venir d'ici la fin du mois » — ce qui est DÉJÀ INSCRIT dans l'app et n'a pas encore eu lieu.
 *
 * Trois sources, une seule liste datée :
 *   - les prélèvements récurrents pas encore passés (repris tels quels de `computeRecurUpcoming` :
 *     ce sont EXACTEMENT les lignes qui font « Prélèvements encore à passer » — la somme de la
 *     liste retombe donc sur le chiffre affiché) ;
 *   - les rentrées récurrentes pas encore arrivées (salaire, allocations…) ;
 *   - les opérations ponctuelles déjà saisies à une date future du mois (un achat prévu le 25,
 *     un remboursement attendu).
 *
 * Même périmètre que le suivi du mois (computeSuiviDetail) : comptes courants du périmètre
 * quotidien, hors virements, hors brouillons, hors régularisations. L'estimation des dépenses du
 * quotidien n'en fait PAS partie : ce n'est pas une opération inscrite, c'est une prévision.
 *
 * Module PUR (aucun accès réseau) — testé dans __tests__/monthUpcoming.test.ts.
 */
import { buildMaterializedIndex, recurrenceForMonth } from './recurrenceMonth';
import { convertAmount, type RatesMap } from './currency';
import { isRegul } from './regul';
import { isProjectSpendTx } from './projectTx';

export interface UpcomingItem {
  /** Clé unique d'affichage (une ligne par source). */
  key: string;
  kind: 'expense' | 'income';
  source: 'recurring' | 'planned';
  /** Date de l'occurrence dans le mois (YYYY-MM-DD). */
  date: string;
  /** Montant restant POSITIF, dans la devise du compte. */
  amount: number;
  /** Même montant, converti dans la devise de référence (pour les totaux). */
  amountRef: number;
  /** Nombre d'occurrences restantes (récurrente hebdomadaire : plusieurs dans le mois). */
  occurrences: number;
  /** La transaction d'origine (modèle récurrent, ou opération saisie). */
  tx: any;
}

export interface MonthUpcoming {
  items: UpcomingItem[];
  expenseTotal: number;
  incomeTotal: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function computeMonthUpcoming(params: {
  /** `vm.recurUpcoming.list` : prélèvements récurrents restants (avec `_left`, `_monthDate`). */
  recurringExpenses: any[];
  txForSuivi: any[];
  accountsForSuivi: any[];
  refCode: string;
  rates: RatesMap;
  now?: Date;
}): MonthUpcoming {
  const { recurringExpenses, txForSuivi, accountsForSuivi, refCode, rates } = params;
  const now = params.now ?? new Date();
  const y = now.getFullYear(), mo = now.getMonth() + 1;
  const monthPrefix = `${y}-${pad(mo)}`;
  const todayStr = `${monthPrefix}-${pad(now.getDate())}`;
  const daysInMonth = new Date(y, mo, 0).getDate();

  const curByAcc: Record<string, string> = {};
  const checkingIds = new Set<string>();
  for (const a of accountsForSuivi) {
    curByAcc[a.id] = a.currency;
    if (a.type === 'checking') checkingIds.add(a.id);
  }
  const toRef = (amt: number, accountId: string) =>
    convertAmount(amt, curByAcc[accountId] || refCode, refCode, rates) ?? amt;

  /* Date à afficher pour une récurrente : son ancre si elle tombe encore ce mois-ci (la
     matérialisation l'avance après chaque échéance passée), sinon le jour de l'ancre dans le mois. */
  const occurrenceDate = (t: any, monthDate?: string) => {
    const anchor = String(t.date ?? '').slice(0, 10);
    if (anchor.slice(0, 7) === monthPrefix && anchor > todayStr) return anchor;
    if (monthDate && monthDate > todayStr) return monthDate;
    const day = Math.min(new Date(anchor + 'T00:00:00').getDate() || daysInMonth, daysInMonth);
    const d = `${monthPrefix}-${pad(day)}`;
    return d > todayStr ? d : todayStr;
  };

  const items: UpcomingItem[] = [];

  // 1 · Prélèvements récurrents restants — repris à l'identique (même total que l'écran).
  for (const t of recurringExpenses) {
    const left = Math.max(0, Number(t._left) || 0);
    if (left <= 0) continue;
    const one = Math.abs(Number(t.amount)) || left;
    items.push({
      key: `rec-${t.id}`, kind: 'expense', source: 'recurring',
      date: occurrenceDate(t, t._monthDate),
      amount: left, amountRef: toRef(left, t.account_id),
      occurrences: Math.max(1, Math.round(left / one)), tx: t,
    });
  }

  const inScope = (t: any) =>
    checkingIds.has(t.account_id) && !t.linked_account_id && !t.is_draft && !t.is_reserved && !isRegul(t);

  // 2 · Rentrées récurrentes pas encore arrivées.
  const materialized = buildMaterializedIndex(txForSuivi, monthPrefix);
  for (const t of txForSuivi) {
    if (!(t.is_recurring && t.recurrence_rule) || !inScope(t) || t.project_id) continue;
    if (Number(t.amount) <= 0 || t.category?.type !== 'income') continue;
    const r = recurrenceForMonth(t, materialized, now);
    const left = Math.max(0, r.total - r.passed);
    if (left <= 0) continue;
    const one = Math.abs(Number(t.amount)) || left;
    items.push({
      key: `rec-${t.id}`, kind: 'income', source: 'recurring',
      date: occurrenceDate(t, materialized.get(t.id)?.lastDate),
      amount: left, amountRef: toRef(left, t.account_id),
      occurrences: Math.max(1, Math.round(left / one)), tx: t,
    });
  }

  // 3 · Opérations ponctuelles déjà saisies pour plus tard dans le mois.
  for (const t of txForSuivi) {
    if (t.is_recurring && t.recurrence_rule) continue;
    const d = String(t.date ?? '').slice(0, 10);
    if (d.slice(0, 7) !== monthPrefix || d <= todayStr || !inScope(t)) continue;
    if (t.project_id && !isProjectSpendTx(t)) continue;
    const amt = Number(t.amount);
    const cat = t.category;
    const kind = amt < 0 && (!cat || cat.type === 'expense') ? 'expense'
      : amt > 0 && cat?.type === 'income' ? 'income' : null;
    if (!kind) continue;
    const abs = Math.abs(amt);
    items.push({
      key: `tx-${t.id}`, kind, source: 'planned', date: d,
      amount: abs, amountRef: toRef(abs, t.account_id), occurrences: 1, tx: t,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || b.amountRef - a.amountRef);
  let expenseTotal = 0, incomeTotal = 0;
  for (const it of items) {
    if (it.kind === 'expense') expenseTotal += it.amountRef; else incomeTotal += it.amountRef;
  }
  return { items, expenseTotal, incomeTotal };
}
