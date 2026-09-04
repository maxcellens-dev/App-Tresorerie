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
  /** Migration 223 — 'wealth' = mise à jour du solde d'un compte d'épargne / d'investissement. */
  regul_kind?: string | null;
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

// ── LES DEUX RÉGULARISATIONS ───────────────────────────────────────────────────────────────────
//
// Une régularisation dit toujours la même chose au moteur de solde (« à cette date, ce compte vaut
// exactement ça »), mais elle ne raconte pas la même histoire selon le compte :
//
//   • COMPTE COURANT — « il manquait 80 € que je n'avais pas saisis ». De l'argent réellement sorti
//     (ou entré) du quotidien : ça pèse sur le plan de trésorerie, sur les dépenses variables du
//     mois, et ça calibre le doute de l'app sur les soldes.
//
//   • ÉPARGNE / INVESTISSEMENT — « j'ai mis 500 € de côté sans le noter ». Ni dépense, ni recette :
//     un MOUVEMENT DE PATRIMOINE, à compter comme un virement entrant (ou sortant si le montant est
//     négatif). Hors plan de trésorerie, hors budget, hors calibration du doute — mais bien compté
//     dans l'épargne mise de côté du mois.
//
// Le marqueur est une DONNÉE (`regul_kind`, migration 223), jamais la catégorie : celle-ci est
// renommable par l'utilisateur, et s'appuyer dessus est exactement l'erreur que les migrations 175
// et 196 ont eu à corriger.

/** Valeur du marqueur pour une mise à jour de solde d'épargne / d'investissement. */
export const WEALTH_REGUL_KIND = 'wealth';

/**
 * Comptes dont la mise à jour de solde est un MOUVEMENT DE PATRIMOINE (et non une correction de
 * trésorerie) : épargne et investissement. Définie ici, avec le reste de la règle, plutôt que
 * réécrite dans chaque écran qui a besoin de trancher.
 */
export function isWealthAccountType(type: string | null | undefined): boolean {
  return type === 'savings' || type === 'investment';
}

/** Libellé posé par la mise à jour de solde d'un compte d'épargne / d'investissement. */
export const WEALTH_REGUL_NOTE = 'Régularisation épargne';

/**
 * true si la régularisation est une MISE À JOUR DE PATRIMOINE (épargne / investissement) — donc à
 * traiter comme un mouvement d'épargne, et jamais comme une correction de trésorerie.
 *
 * Volontairement fondé sur le seul marqueur : pas de repli sur le type du compte, qui ferait
 * basculer d'un coup des écritures anciennes d'une catégorie à l'autre selon l'écran qui les lit.
 * Les lignes antérieures ont été marquées une fois pour toutes par la migration 223.
 */
export function isWealthRegul(t: RegulLike | null | undefined): boolean {
  return (t?.regul_kind ?? null) === WEALTH_REGUL_KIND;
}

/** true si c'est une régularisation de TRÉSORERIE (compte courant) — celle qui pèse sur le budget. */
export function isCashRegul(t: RegulLike | null | undefined): boolean {
  return isRegul(t) && !isWealthRegul(t);
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

/**
 * Sous-catégorie d'une MISE À JOUR DE SOLDE d'épargne / d'investissement (migration 223).
 *
 * Une seule, sous « Mouvements », quel que soit le sens du montant : « Mouvements » est le tiroir
 * des écritures neutres, et le seul parent que le plan de trésorerie écarte de ses lignes comme de
 * ses totaux. Une jumelle côté recettes aurait fait apparaître ces mises à jour dans le total
 * RECETTES du plan — exactement ce qu'on cherche à éviter.
 *
 * `null` si le référentiel de l'utilisateur ne la contient pas encore : l'écriture part alors sans
 * catégorie, comme toutes les régularisations d'avant la migration 175. C'est le MARQUEUR
 * (`regul_kind`) qui porte le sens, jamais la catégorie.
 */
export const WEALTH_REGUL_CATEGORY_NAME = 'Régularisation épargne / invest';

export function findWealthRegulCategoryId(categories: CategoryLike[] | null | undefined): string | null {
  const wanted = WEALTH_REGUL_CATEGORY_NAME.toLowerCase();
  const match = (categories ?? []).find(
    (c) => c.type === 'expense' && c.name.trim().toLowerCase() === wanted,
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
