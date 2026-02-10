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

    const date = new Date(`${year}-${month}-${day}`);
    if (isNaN(date.getTime())) return '';

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

/** Get today's date as ISO string YYYY-MM-DD */
export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
