/**
 * Palette centrale de l'application.
 * Deux modes (clair / sombre) × 5 presets d'accent.
 * Les écrans consomment ces couleurs via le hook useAppColors().
 */

export type ThemeMode = 'dark' | 'light';
export type ThemePreset = 'emerald' | 'ocean' | 'violet' | 'coral' | 'amber';

/** Jeu de couleurs consommé par les écrans (toutes les clés utilisées historiquement). */
export interface AppColors {
  // ── Dynamiques (mode) ──
  bg: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  danger: string;
  // ── Accent (preset) ──
  emerald: string;   // nom historique de l'accent (conservé pour limiter la migration)
  accent: string;
  primary: string;
  // ── Alias ──
  border: string;        // = cardBorder
  background: string;    // = bg
  surface: string;       // = card
  sub: string;           // = textSecondary
  red: string;           // = danger
  screenBg: string;      // = bg
  tabActive: string;     // = accent
  tabInactive: string;   // = textSecondary
  // ── Sémantiques fixes (indépendantes du mode) ──
  checking: string;
  savings: string;
  investment: string;
  balance: string;
  blue: string;
  orange: string;
  violet: string;
  teal: string;
  amber: string;
  green: string;
  warning: string;
  success: string;
  selected: string;
  currentMonth: string;
  // Tolérance pour toute clé résiduelle
  [key: string]: string;
}

/** Couleurs liées au mode (fond, cartes, texte). */
const MODE_COLORS: Record<ThemeMode, Omit<AppColors, 'emerald' | 'accent'>> = {
  dark: {
    bg: '#020617',
    card: '#0f172a',
    cardBorder: '#1e293b',
    text: '#ffffff',
    textSecondary: '#94a3b8',
    danger: '#f87171',
  },
  light: {
    bg: '#f1f5f9',
    card: '#ffffff',
    cardBorder: '#e2e8f0',
    text: '#0f172a',
    textSecondary: '#64748b',
    danger: '#ef4444',
  },
};

/** Couleur d'accent par preset (légère variation par mode pour le contraste). */
const PRESET_ACCENT: Record<ThemePreset, { dark: string; light: string; label: string; emoji: string }> = {
  emerald: { dark: '#34d399', light: '#059669', label: 'Émeraude', emoji: '🟢' },
  ocean:   { dark: '#38bdf8', light: '#0284c7', label: 'Océan',    emoji: '🔵' },
  violet:  { dark: '#a78bfa', light: '#7c3aed', label: 'Violet',   emoji: '🟣' },
  coral:   { dark: '#fb7185', light: '#e11d48', label: 'Corail',   emoji: '🔴' },
  amber:   { dark: '#fbbf24', light: '#d97706', label: 'Ambre',    emoji: '🟠' },
};

export const THEME_PRESETS: { id: ThemePreset; label: string; emoji: string; swatch: string }[] =
  (Object.keys(PRESET_ACCENT) as ThemePreset[]).map((id) => ({
    id,
    label: PRESET_ACCENT[id].label,
    emoji: PRESET_ACCENT[id].emoji,
    swatch: PRESET_ACCENT[id].dark,
  }));

export const THEME_MODES: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'dark',  label: 'Sombre', icon: 'moon-outline' },
  { id: 'light', label: 'Clair',  icon: 'sunny-outline' },
];

/** Construit le jeu de couleurs final pour un mode + preset donnés. */
export function buildColors(mode: ThemeMode, preset: ThemePreset): AppColors {
  const base = MODE_COLORS[mode] ?? MODE_COLORS.dark;
  const accentDef = PRESET_ACCENT[preset] ?? PRESET_ACCENT.emerald;
  const accent = mode === 'light' ? accentDef.light : accentDef.dark;
  const isLight = mode === 'light';

  return {
    ...base,
    emerald: accent,
    accent,
    primary: accent,
    // alias
    border: base.cardBorder,
    background: base.bg,
    surface: base.card,
    sub: base.textSecondary,
    red: base.danger,
    screenBg: base.bg,
    tabActive: accent,
    tabInactive: base.textSecondary,
    // sémantiques fixes (mêmes repères visuels quel que soit le mode)
    checking: '#60a5fa',
    savings: '#34d399',
    investment: '#a78bfa',
    balance: '#60a5fa',
    blue: '#60a5fa',
    orange: '#f59e0b',
    violet: '#a78bfa',
    teal: '#0ea5a8',
    amber: '#fbbf24',
    green: '#34d399',
    warning: '#f59e0b',
    success: '#22c55e',
    selected: isLight ? '#eef2ff' : '#112f1c',
    currentMonth: isLight ? '#eef2ff' : '#0d2318',
  } as AppColors;
}

export const DEFAULT_MODE: ThemeMode = 'dark';
export const DEFAULT_PRESET: ThemePreset = 'emerald';
