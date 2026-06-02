/**
 * Palette de couleurs sémantiques — identité Revolut-inspired.
 *
 * Types de compte :
 *   Épargne        → vert   (#00B67A)
 *   Investissement → violet (#9B5CF6)
 *   Courant        → bleu   (#0075FF)
 *   Dépenses var.  → orange (#FF9500)
 */

/* ── Base (dark) ── */
export const BASE = {
  bg: '#000000',
  card: '#111214',
  cardBorder: '#2A2B2E',
  text: '#FFFFFF',
  textSecondary: '#8E949A',
};

/* ── Couleurs par type de compte ── */
export const ACCOUNT_COLORS: Record<string, string> = {
  savings:    '#00B67A',
  investment: '#9B5CF6',
  checking:   '#0075FF',
  other:      '#8E949A',
};

/* ── Couleurs sémantiques ── */
export const SEMANTIC = {
  income:           '#00B67A',
  expense:          '#8E949A',
  expenseChart:     '#FF3B30',
  expenseChartDark: '#CC2F26',
  variableExpense:  '#FF9500',
  project:          '#00C4CC',
  objective:        '#00B67A',

  positive: '#00B67A',
  negative: '#FF3B30',

  danger:  '#FF3B30',
  warning: '#FF9500',
  success: '#00B67A',
};

/* ── Icônes par type de compte ── */
export const ACCOUNT_ICONS: Record<string, string> = {
  savings:    'leaf-outline',
  investment: 'trending-up-outline',
  checking:   'wallet-outline',
  other:      'cash-outline',
};

/** Helper : couleur d'un type de compte */
export function accountColor(type: string): string {
  return ACCOUNT_COLORS[type] ?? ACCOUNT_COLORS.other;
}
