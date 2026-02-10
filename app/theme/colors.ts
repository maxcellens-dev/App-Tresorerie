/**
 * Palette de couleurs unifiée pour l'ensemble de l'application.
 *
 * Couleurs par type de compte / catégorie financière :
 *   - Épargne          → vert   (#34d399)
 *   - Investissement    → violet (#a78bfa)
 *   - Compte Courant    → bleu   (#60a5fa)
 *   - Dépenses variables→ orangé (#f59e0b)
 *
 * La page Trésorerie conserve ses propres couleurs.
 */

/* ── Base (dark theme) ── */
export const BASE = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

/* ── Couleurs par type de compte ── */
export const ACCOUNT_COLORS: Record<string, string> = {
  savings: '#34d399',     // Épargne  → vert
  investment: '#a78bfa',  // Investissement → violet
  checking: '#60a5fa',    // Courant  → bleu
  other: '#94a3b8',       // Autre    → gris
};

/* ── Couleurs sémantiques ── */
export const SEMANTIC = {
  income: '#34d399',       // Recettes → vert
  expense: '#94a3b8',      // Dépenses (liste) → gris discret
  expenseChart: '#fb7185', // Dépenses (graphiques) → rose
  expenseChartDark: '#e11d48',
  variableExpense: '#f59e0b', // Dépenses variables → orangé/ambre
  project: '#22d3ee',      // Projets → cyan
  objective: '#34d399',    // Objectifs → vert

  positive: '#34d399',
  negative: '#fb7185',

  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#34d399',
};

/* ── Icônes par type de compte ── */
export const ACCOUNT_ICONS: Record<string, string> = {
  savings: 'leaf-outline',
  investment: 'trending-up-outline',
  checking: 'wallet-outline',
  other: 'cash-outline',
};

/**
 * Helper rapide : couleur d'un type de compte
 */
export function accountColor(type: string): string {
  return ACCOUNT_COLORS[type] ?? ACCOUNT_COLORS.other;
}
