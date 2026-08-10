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

/**
 * Note portée par l'ANCRE de solde initial posée à la création d'un compte (useAddAccount).
 * Marqueur unique, partagé — voir `isInitialBalanceAnchor`.
 */
export const INITIAL_BALANCE_NOTE = 'Régularisation solde initial';

/**
 * true si la transaction est l'ANCRE DE SOLDE INITIAL d'un compte (pas un écart constaté).
 *
 * Distinction capitale pour la calibration de fiabilité : une ancre dit « le compte démarre à
 * 21 000 € », pas « on a trouvé 21 000 € d'écart depuis la dernière vérification ». Les compter
 * comme des écarts faisait exploser la dérive journalière — un utilisateur qui crée quatre comptes
 * d'un coup se retrouvait avec un doute de plusieurs dizaines de milliers d'euros, et un Relyka
 * affiché en « jusqu'à 10 300 € » alors qu'il valait 1 266 €.
 */
export function isInitialBalanceAnchor(t: RegulLike | null | undefined): boolean {
  return (t?.note ?? '') === INITIAL_BALANCE_NOTE;
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

// ── La CATÉGORIE d'une régularisation ──────────────────────────────────────────────────────────
//
// Une régul n'était rangée nulle part : elle apparaissait « sans catégorie » dans le reporting et
// le plan de trésorerie, alors qu'elle correspond à de l'argent réellement en moins ou en plus. On
// la classe donc, selon son sens :
//   • à la BAISSE  → « Frais variables › Régularisation Solde »  (une dépense qu'on n'avait pas vue)
//   • à la HAUSSE  → « Autres recettes › Régularisation Solde »  (une rentrée qu'on n'avait pas vue)
//
// ⚠️ Poser une catégorie était IMPOSSIBLE jusqu'à la migration 175 : le moteur de solde SQL
// reconnaissait une régularisation à l'absence de catégorie. Il s'appuie désormais sur
// `regul_target`, comme `isRegul` ci-dessus — une seule définition des deux côtés du réseau.

/** Nom de la sous-catégorie, identique des deux côtés (la casse a divergé selon les référentiels). */
export const REGUL_CATEGORY_NAME = 'Régularisation Solde';

interface CategoryLike { id: string; name: string; type: string }

/**
 * Sous-catégorie de régularisation à poser sur une écriture, d'après son SENS.
 * `null` si le référentiel de l'utilisateur ne la contient pas (compte ancien, catégorie
 * supprimée) : on écrit alors la régul sans catégorie — exactement le comportement d'avant, jamais
 * un échec de saisie pour une question de rangement.
 */
export function findRegulCategoryId(
  categories: CategoryLike[] | null | undefined,
  amount: number,
): string | null {
  const wanted = amount < 0 ? 'expense' : 'income';
  const match = (categories ?? []).find(
    (c) => c.type === wanted && c.name.trim().toLowerCase() === REGUL_CATEGORY_NAME.toLowerCase(),
  );
  return match?.id ?? null;
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
