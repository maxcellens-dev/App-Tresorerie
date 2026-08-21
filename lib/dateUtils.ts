/**
 * Utility functions for French date formatting (jj-mm-aaaa).
 * Internal storage always uses ISO format (YYYY-MM-DD).
 */

/** Convert ISO date (YYYY-MM-DD) → French display (DD-MM-YYYY) */
export function formatDateFrench(isoDate: string): string {
  if (!isoDate) return '';
  try {
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    const [year, month, day] = parts;
    return `${day}-${month}-${year}`;
  } catch {
    return isoDate;
  }
}

/**
 * Parse a French date input (DD-MM-YYYY or DD/MM/YYYY or DDMMYYYY)
 * back to ISO format (YYYY-MM-DD).
 * Returns empty string if invalid.
 * If allowPast is false, returns '' for dates before today.
 */
export function parseDateFromFrench(input: string, allowPast = true): string {
  if (!input) return '';
  try {
    const cleaned = input.replace(/\D/g, '');
    if (cleaned.length !== 8) return '';

    const day = cleaned.substring(0, 2);
    const month = cleaned.substring(2, 4);
    const year = cleaned.substring(4, 8);

    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return '';

    /* ⚠️ VALIDATION PAR ALLER-RETOUR, et non `isNaN(new Date(...))`.
       `new Date('2026-02-31')` ne rend PAS une date invalide : V8 bascule sur son analyse permissive
       et la fait glisser au 3 mars. Le test passait donc, et la fonction renvoyait « 2026-02-31 » —
       une date qui n'existe pas, envoyée telle quelle à une colonne `date` de Postgres, qui la
       rejette. L'utilisateur récupérait une erreur de base de données brute au lieu d'un simple
       « date invalide ». On reconstruit donc la date en heure LOCALE et on vérifie qu'elle n'a pas
       débordé — ce qui traite au passage les années bissextiles (29-02 accepté en 2028, pas en 2026).

       L'heure locale compte aussi pour `allowPast` : l'ancienne construction lisait la chaîne en UTC
       et la comparait à un minuit LOCAL, deux repères décalés d'un fuseau. */
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';

    if (!allowPast) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) return '';
    }

    return `${year}-${month}-${day}`;
  } catch {
    return '';
  }
}

/**
 * Une date en ISO court (AAAA-MM-JJ), lue en heure LOCALE.
 *
 * Jamais `toISOString().slice(0, 10)` : celui-ci convertit en UTC, donc renvoie la veille pour tout
 * ce qui se passe après 22 h en France — les opérations du jour disparaissaient des filtres
 * « aujourd'hui » après minuit UTC.
 */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Get today's date as ISO string YYYY-MM-DD */
export function todayISO(): string {
  return isoDay(new Date());
}

/**
 * Jour du mois (1-31) d'une date ISO, lu SUR LA CHAÎNE.
 *
 * ⚠️ `new Date('2026-08-15').getDate()` est un piège : la chaîne est parsée en UTC, puis relue en
 * heure LOCALE — dans tout fuseau à l'ouest de Greenwich, le jour retourné est celui de la VEILLE.
 * Le motif traînait dans cinq calculs (jour d'échéance d'un projet — écrit en base —, jour d'une
 * récurrente dans la prévision, jour de la rentrée d'argent inférée). On ne passe donc plus par
 * `Date` du tout : le jour est déjà dans la chaîne.
 *
 * Renvoie 0 si l'entrée n'est pas une date ISO exploitable — à l'appelant de choisir son repli.
 */
export function dayOfMonthISO(iso: string | null | undefined): number {
  const day = Number(String(iso ?? '').slice(8, 10));
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 0;
}
