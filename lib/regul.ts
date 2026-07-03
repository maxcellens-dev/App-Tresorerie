// Identification UNIFIÉE des régularisations de solde + prorata de clôture.
//
// Contexte : jusqu'ici les régularisations étaient repérées de plusieurs façons incohérentes
// (regex sur la note, nom de catégorie « Régularisation », ou `regul_target`). Résultat : selon
// le calcul, une même régul était tantôt exclue tantôt comptée comme dépense variable.
//
// Marqueur de référence = `regul_target != null`, posé sur TOUTE régularisation de solde
// (ajustement manuel + ancre de solde initial + clôture). Repli historique par note pour les
// anciennes lignes (ex. « Ajustement de solde » de l'ancienne clôture, sans regul_target).

export interface RegulLike {
  regul_target?: number | null;
  note?: string | null;
  category_id?: string | null;
  category?: { name?: string | null } | null;
}

/** true si la transaction est une régularisation de solde (ajustement, ancre, clôture). */
export function isRegul(t: RegulLike | null | undefined): boolean {
  if (!t) return false;
  if (t.regul_target != null) return true;
  const note = t.note ?? '';
  if (/r[ée]gul/i.test(note) || note === 'Ajustement de solde') return true;
  const catName = t.category?.name ?? '';
  return /r[ée]gularisation/i.test(catName);
}

// ── Prorata de clôture (option C : « je connais mon solde d'aujourd'hui ») ──────────────────
// Un écart constaté APRÈS la fin d'un mois (ex. réconciliation le 8 du mois suivant) doit être
// réparti au prorata des JOURS entre le mois qui se ferme et le mois courant — au lieu d'écraser
// tout l'écart sur le mois courant (ce qui faussait les dépenses variables).

function toDate(iso: string): Date { return new Date(iso.slice(0, 10) + 'T00:00:00'); }
function daysBetween(a: Date, b: Date): number { return Math.round((a.getTime() - b.getTime()) / 86400000); }
function lastDayOfMonth(key: string): Date { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0); }
function firstDayOfMonth(key: string): Date { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1); }
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface ProrataResult {
  /** Part de l'écart imputée au mois qui se ferme (datée du dernier jour du mois). */
  closingShare: number;
  /** Part de l'écart imputée au mois courant. */
  currentShare: number;
  /** Date de la régul du mois qui se ferme (dernier jour du mois). */
  closingDate: string;
  totalDays: number;
  daysInClosing: number;
}

/**
 * Répartit `gap` (écart de solde total) entre le mois `closingMonthKey` (YYYY-MM) et le mois courant,
 * au prorata des jours calendaires de l'intervalle [intervalStart → intervalEnd].
 * L'intervalle représente la période NON vérifiée (dernière vérif → aujourd'hui).
 */
export function prorateClosureGap(
  gap: number,
  intervalStart: string,
  intervalEnd: string,
  closingMonthKey: string,
): ProrataResult {
  const start = toDate(intervalStart);
  const end = toDate(intervalEnd);
  const mStart = firstDayOfMonth(closingMonthKey);
  const mEnd = lastDayOfMonth(closingMonthKey);
  const closingDate = isoDay(mEnd);

  const totalDays = Math.max(1, daysBetween(end, start));
  // Chevauchement de l'intervalle avec le mois qui se ferme.
  const ovStart = start > mStart ? start : mStart;
  const ovEnd = end < mEnd ? end : mEnd;
  const daysInClosing = Math.max(0, Math.min(totalDays, daysBetween(ovEnd, ovStart)));

  const closingShare = gap * (daysInClosing / totalDays);
  return {
    closingShare,
    currentShare: gap - closingShare,
    closingDate,
    totalDays,
    daysInClosing,
  };
}
