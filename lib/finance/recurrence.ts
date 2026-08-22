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
import { WEEKS_PER_MONTH } from './financialProfileEngine';
// Source UNIQUE des occurrences d'un modèle récurrent sur un mois (comparaisons en chaînes ISO,
// donc sans piège de fuseau horaire). Déjà utilisée par la Projection et le Reporting.
import { recurrenceOccurrencesInMonth } from './recurrenceMonth';

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
  /* ── POURQUOI CETTE FONCTION N'A PLUS D'ARITHMÉTIQUE À ELLE ────────────────────────────────────
   * Elle refaisait, en objets `Date`, le calcul que `recurrenceOccurrencesInMonth` fait déjà en
   * chaînes ISO — et elle le refaisait FAUX, en mélangeant deux repères de temps :
   *     new Date('2026-08-31')   → minuit UTC
   *     new Date(2026, 8, 0)     → minuit LOCAL du 31 août
   * À l'est de Greenwich (donc en France), le premier tombe APRÈS le second : la condition
   * `start > thisMonthEnd` était vraie et la fonction rendait 0. **Toute récurrente ancrée le
   * DERNIER jour de son mois disparaissait de ce mois-là** — un salaire du 31 valait 0 € en août.
   * Le Plan de trésorerie, la liste des Transactions et le Pilotage s'appuient tous dessus : la
   * ligne manquait, et le solde du mois était faux du montant entier.
   * Symétriquement, `start.getMonth()` lu sur une date UTC désigne le mois PRÉCÉDENT à l'ouest de
   * Greenwich pour une ancre du 1er → trimestrielles et annuelles décalées d'un mois.
   *
   * La même correction avait déjà été faite pour `recurringAmountForMonth` (Projection, Reporting).
   * Garder ici une seconde implémentation, c'était garantir que les deux écrans divergent.
   *
   * Deux effets de bord, tous deux corrects et hérités de la fonction partagée :
   *   • le jour est borné à la longueur du mois (une récurrente du 31 tombe le 28 en février) ;
   *   • une série qui s'arrête EN COURS de mois ne compte plus si son occurrence tombe après la
   *     date de fin (avant, le mois entier était compté).
   */
  // Horizon borné à 24 mois à partir de maintenant : au-delà, une récurrence sans fin n'a plus de
  // sens. Borne posée au DERNIER jour du mois d'horizon, pour conserver la granularité « mois »
  // d'origine (un horizon au 1er aurait exclu toutes les échéances du 2 au 31 de ce mois-là).
  const horizon = new Date(currentDate.getFullYear(), currentDate.getMonth() + 25, 0);
  const maxEndISO = isoDay(horizon);
  const cleanEnd = endDate ? String(endDate).slice(0, 10) : null;
  const end = cleanEnd && cleanEnd < maxEndISO ? cleanEnd : maxEndISO;

  const occurrences = recurrenceOccurrencesInMonth(
    { id: '', date: startDate, amount, recurrence_rule: rule, recurrence_end_date: end },
    year,
    month,
  );
  // `0 * -800` vaut `-0` en JavaScript : il se propage dans les sommes et finit par s'afficher
  // « −0 € ». On rend un vrai zéro.
  return occurrences.length === 0 ? 0 : occurrences.length * amount;
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

/**
 * MONTANT MENSUEL ÉQUIVALENT d'une récurrente — source unique.
 *
 * Ce facteur existait en CINQ exemplaires, et pas avec la même valeur : `4.33` dans
 * `hooks/useAppState` et dans la modale du Pilotage, `52 / 12` (soit 4,3333…) dans le snapshot IA
 * et trois fois dans `useUserSnapshot`. Deux modules répondaient donc différemment à la même
 * question — « combien cette récurrente pèse-t-elle par mois ? ».
 *
 * On aligne sur `WEEKS_PER_MONTH`, la constante que le moteur du Pilotage utilise déjà pour
 * convertir le budget variable hebdomadaire déclaré : c'est elle que l'utilisateur voit à l'écran
 * (« ≈ X € / mois »), et c'est elle qui décide de son enveloppe. Un seul chiffre pour toute l'app.
 *
 * `daily` est accepté par tolérance : ce n'est pas une valeur de `RecurrenceRule`, mais d'anciennes
 * lignes en base peuvent la porter, et la traiter comme « 0 par mois » la ferait disparaître des
 * totaux sans rien dire.
 */
export const MONTHLY_FACTOR_BY_RULE: Record<string, number> = {
  daily: 30.4,
  weekly: WEEKS_PER_MONTH,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

/**
 * Règle inconnue → 0 : une ligne dont on ne sait pas à quel rythme elle tombe ne doit pas être
 * comptée « comme mensuelle » par défaut. Les appelants qui veulent l'autre convention (traiter
 * l'inconnu comme mensuel) lisent directement `MONTHLY_FACTOR_BY_RULE` avec leur propre repli.
 */
export function monthlyEquivalent(rule: string | null | undefined, amount: number): number {
  return amount * (MONTHLY_FACTOR_BY_RULE[String(rule)] ?? 0);
}

/**
 * Nombre d'échéances MENSUELLES entre `startISO` et `endISO`, bornes INCLUSES.
 *
 * Le jour de l'échéance est celui de `startISO`, borné au dernier jour de chaque mois : le 31 tombe
 * au 28/29 en février, au 30 en avril — puis REVIENT au 31 le mois suivant.
 *
 * ⚠️ C'est tout l'objet de cette fonction. Les deux écrans Projets comptaient ces mois à la main
 * avec `cursor.setMonth(cursor.getMonth() + 1)`, qui DÉBORDE : partant du 31 janvier, JavaScript
 * passe par « 31 février », le fait glisser au 3 mars — et toute la série dérive ensuite sur le 3.
 * Le compte de mois était donc faux pour tout projet dont l'échéance tombe le 29, 30 ou 31, et avec
 * lui la mensualité calculée en mode « date » (un montant qui est ENREGISTRÉ).
 *
 * On raisonne en mois absolus (année × 12 + mois), jamais en incréments de `Date`.
 */
/**
 * Dates ISO des échéances MENSUELLES à partir de `startISO`, jusqu'à `endISO` inclus (ou
 * `maxCount` échéances si aucune fin). Le jour est celui de `startISO`, borné au dernier jour de
 * chaque mois puis REMIS au jour d'origine le mois suivant.
 *
 * ⚠️ Primitive volontairement partagée : trois boucles la réécrivaient à la main avec
 * `cursor.setMonth(cursor.getMonth() + 1)`, qui DÉBORDE. Depuis le 31 janvier, JavaScript passe par
 * « 31 février », bascule au 3 mars — et la série dérive ensuite sur le 3. Conséquences constatées :
 * un projet dont l'échéance tombe le 31 SAUTAIT février, et toutes ses transactions suivantes
 * étaient créées le 3. On raisonne donc en mois absolus (année × 12 + mois), jamais en incréments
 * de `Date`.
 */
export function monthlyOccurrenceDates(
  startISO: string,
  endISO: string | null,
  maxCount = 240,
): string[] {
  const start = String(startISO ?? '').slice(0, 10);
  const end = endISO ? String(endISO).slice(0, 10) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  if (end !== null && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  if (end !== null && end < start) return [];

  const [sy, sm, baseDay] = start.split('-').map(Number);
  const startTotal = sy * 12 + (sm - 1);
  const out: string[] = [];

  for (let i = 0; i < maxCount; i++) {
    const total = startTotal + i;
    const yy = Math.floor(total / 12);
    const mm = total % 12;
    // `new Date(yy, mm + 1, 0)` = jour 0 du mois suivant = dernier jour du mois visé (heure locale).
    const daysInMonth = new Date(yy, mm + 1, 0).getDate();
    const day = Math.min(baseDay, daysInMonth);
    const occ = `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (end !== null && occ > end) break;
    out.push(occ);
  }
  return out;
}

/** Nombre d'échéances mensuelles entre les deux bornes, incluses (cf. `monthlyOccurrenceDates`). */
export function monthlyOccurrenceCount(startISO: string, endISO: string): number {
  if (!endISO) return 0;
  return monthlyOccurrenceDates(startISO, endISO).length;
}
