/**
 * RÉCURRENCES — arithmétique pure : poids d'un modèle récurrent sur un mois, part déjà passée,
 * et liste des occurrences à venir.
 *
 * Regroupées ici parce qu'elles répondent à la même question sous trois angles, et surtout parce
 * que la première (`addRecurrenceToMonth`) existait en DEUX exemplaires — dans le moteur du
 * Pilotage et dans l'écran Trésorerie. Deux sources de vérité pour un même montant : le plan de
 * trésorerie et le tableau de bord pouvaient diverger sur la même ligne, et toute correction
 * appliquée d'un seul côté aggravait l'écart. L'équivalence des deux versions a été prouvée avant
 * regroupement (voir `__tests__/recurrence.test.ts`, qui garde l'ancienne comme oracle).
 *
 * Aucune horloge implicite : `currentDate` / `todayStr` sont toujours des paramètres.
 */
import { isoDay } from '../dateUtils';
import type { RecurrenceRule } from '../../types/database';

/**
 * @param year/month  mois visé (month : 1-12)
 * @param amount      montant d'UNE occurrence
 * @param startDate   date de départ de la récurrence (ISO)
 * @param endDate     fin éventuelle ; l'horizon est de toute façon borné à 24 mois
 * @param currentDate horloge de référence (borne les 24 mois) — injectée, jamais lue en interne
 */
export function addRecurrenceToMonth(
  year: number, month: number, amount: number, startDate: string,
  rule: RecurrenceRule, endDate: string | null, currentDate: Date,
): number {
  const start = new Date(startDate);
  // Horizon borné à 24 mois à partir de maintenant : au-delà, une récurrence sans fin n'a plus de sens.
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);

  if (start > thisMonthEnd || end < thisMonthStart) return 0;
  if (rule === 'monthly') return amount;
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    return (thisMonth - startMonth) % 3 === 0 && thisMonth >= startMonth ? amount : 0;
  }
  if (rule === 'yearly') return start.getMonth() === month - 1 && year >= start.getFullYear() ? amount : 0;
  if (rule === 'weekly') {
    let count = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) count++;
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return count * amount;
  }
  return 0;
}

/** Montant récurrent déjà passé dans le mois courant (date ≤ todayStr). */
export function recurrencePastInMonth(
  year: number, month: number, amount: number, startDate: string,
  rule: RecurrenceRule, endDate: string | null, todayStr: string, currentDate: Date,
): number {
  const total = addRecurrenceToMonth(year, month, amount, startDate, rule, endDate, currentDate);
  const start = new Date(startDate);
  const thisMonthStart = new Date(year, month - 1, 1);
  const thisMonthEnd = new Date(year, month, 0);
  const maxEndDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 24, 1);
  const end = endDate ? new Date(Math.min(new Date(endDate).getTime(), maxEndDate.getTime())) : maxEndDate;
  if (start > thisMonthEnd || end < thisMonthStart) return 0;

  if (rule === 'monthly') {
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (occ < startDate.slice(0, 10)) return 0;
    return occ <= todayStr ? total : 0;
  }
  if (rule === 'weekly') {
    let past = 0;
    let d = new Date(start);
    while (d <= thisMonthEnd) {
      if (d >= thisMonthStart) {
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (ds <= todayStr) past += amount;
      }
      d.setDate(d.getDate() + 7);
      if (d > end) break;
    }
    return past;
  }
  if (rule === 'quarterly') {
    const startMonth = start.getFullYear() * 12 + start.getMonth();
    const thisMonth = year * 12 + (month - 1);
    if ((thisMonth - startMonth) % 3 !== 0 || thisMonth < startMonth) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  if (rule === 'yearly') {
    if (start.getMonth() !== month - 1 || year < start.getFullYear()) return 0;
    const day = Math.min(start.getDate(), thisMonthEnd.getDate());
    const occ = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return occ <= todayStr ? amount : 0;
  }
  return 0;
}

/** Occurrences (ISO) d'un modèle récurrent, strictement après `afterStr` et ≤ `untilStr`. */
export function recurrenceOccurrencesBetween(startDate: string, rule: RecurrenceRule, endDate: string | null, afterStr: string, untilStr: string): string[] {
  const out: string[] = [];
  const start = new Date(startDate.slice(0, 10) + 'T00:00:00');
  const until = new Date(untilStr + 'T00:00:00');
  const end = endDate ? new Date(endDate.slice(0, 10) + 'T00:00:00') : null;
  if (rule === 'weekly') {
    const d = new Date(start);
    while (isoDay(d) <= afterStr) d.setDate(d.getDate() + 7);
    let guard = 0;
    while (d <= until && (!end || d <= end) && guard++ < 200) { out.push(isoDay(d)); d.setDate(d.getDate() + 7); }
    return out;
  }
  const step = rule === 'monthly' ? 1 : rule === 'quarterly' ? 3 : rule === 'yearly' ? 12 : 0;
  if (step === 0) return out;
  const baseDay = start.getDate();
  const startTotal = start.getFullYear() * 12 + start.getMonth();
  for (let i = 0; i < 240; i++) {
    const total = startTotal + i * step;
    const yy = Math.floor(total / 12), mm = total % 12;
    const dim = new Date(yy, mm + 1, 0).getDate();
    const occ = new Date(yy, mm, Math.min(baseDay, dim));
    if (end && occ > end) break;
    const occStr = isoDay(occ);
    if (occStr > untilStr) break;
    if (occStr > afterStr) out.push(occStr);
  }
  return out;
}
