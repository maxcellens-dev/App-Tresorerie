/**
 * Palette centrale — identité graphique Revolut-inspired.
 * Deux modes (clair / sombre) × presets d'accent (+ presets custom).
 * Les écrans consomment ces couleurs via le hook useAppColors().
 */

export type ThemeMode = 'dark' | 'light';
export type ThemePreset = 'emerald' | 'ocean' | 'violet' | 'coral' | 'amber' | 'noir' | 'blanc' | (string & {});

/** Jeu de couleurs consommé par les écrans. */
export interface AppColors {
  // ── Dynamiques (mode) ──
  bg: string;
  card: string;
  /** Surface opaque (jamais transparente) — pour les modales et containers qui doivent cacher le fond. */
  cardSolid: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  danger: string;
  // ── Accent (preset) ──
  emerald: string;   // alias historique de l'accent
  accent: string;
  primary: string;
  // ── Alias ──
  border: string;
  background: string;
  surface: string;
  sub: string;
  red: string;
  screenBg: string;
  tabActive: string;
  tabInactive: string;
  // ── Sémantiques fixes ──
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
  [key: string]: string;
}

/** Surfaces de base par mode (sans la transparence configurable). */
const MODE_BASE: Record<ThemeMode, {
  bg: string; cardSolid: string; text: string; textSecondary: string; danger: string;
  cardWhiteBase: boolean; // true → cartes blanches translucides, false → noires
}> = {
  dark: {
    bg: '#000000',
    cardSolid: '#16181C',
    text: '#FFFFFF',
    textSecondary: '#8E949A',
    danger: '#FF3B30',
    cardWhiteBase: true,
  },
  light: {
    bg: '#FFFFFF',
    cardSolid: '#F2F3F5',
    text: '#191C1F',
    textSecondary: '#6C757D',
    danger: '#FF3B30',
    cardWhiteBase: false,
  },
};

/** Couleur d'accent par preset natif (légère variation par mode). */
const PRESET_ACCENT: Record<string, { dark: string; light: string; label: string; emoji: string }> = {
  emerald: { dark: '#00B67A', light: '#009963', label: 'Émeraude', emoji: '🟢' },
  ocean:   { dark: '#0075FF', light: '#0066E0', label: 'Océan',    emoji: '🔵' },
  violet:  { dark: '#9B5CF6', light: '#7C3AED', label: 'Violet',   emoji: '🟣' },
  coral:   { dark: '#FF6B6B', light: '#E0342A', label: 'Corail',   emoji: '🔴' },
  amber:   { dark: '#FF9500', light: '#D97706', label: 'Ambre',    emoji: '🟠' },
  noir:    { dark: '#D4D4D4', light: '#1A1A1A', label: 'Noir',     emoji: '⚫' },
  blanc:   { dark: '#FFFFFF', light: '#9CA3AF', label: 'Blanc',    emoji: '⚪' },
};

export const NATIVE_PRESET_IDS = Object.keys(PRESET_ACCENT);

export const THEME_PRESETS: { id: string; label: string; emoji: string; swatch: string }[] =
  NATIVE_PRESET_IDS.map((id) => ({
    id,
    label: PRESET_ACCENT[id].label,
    emoji: PRESET_ACCENT[id].emoji,
    swatch: PRESET_ACCENT[id].dark,
  }));

export const THEME_MODES: { id: ThemeMode; label: string; icon: string }[] = [
  { id: 'dark',  label: 'Sombre', icon: 'moon-outline' },
  { id: 'light', label: 'Clair',  icon: 'sunny-outline' },
];

/** Options de surcharge venant du Style Editor (app_config). */
export interface BuildColorsOptions {
  /** Transparence des cartes (0-100). 8 = rgba(...,0.08). */
  cardAlpha?: number;
  /** Surcharges hex par preset natif { emerald: '#xxxxxx', ... } */
  customAccents?: Record<string, string>;
  /** Presets personnalisés créés dans le Style Editor */
  extraPresets?: { id: string; label: string; dark: string; light: string }[];
}

/** Résout la couleur d'accent pour un preset donné (natif, custom hex ou preset perso). */
export function resolveAccent(mode: ThemeMode, preset: string, opts?: BuildColorsOptions): string {
  // 1. Preset personnalisé créé par l'admin
  const extra = opts?.extraPresets?.find((p) => p.id === preset);
  if (extra) return mode === 'light' ? extra.light : extra.dark;
  // 2. Surcharge hex d'un preset natif
  const custom = opts?.customAccents?.[preset];
  if (custom && /^#[0-9A-Fa-f]{6}$/.test(custom)) return custom;
  // 3. Couleur native
  const def = PRESET_ACCENT[preset] ?? PRESET_ACCENT.emerald;
  return mode === 'light' ? def.light : def.dark;
}

/** Construit le jeu de couleurs final pour un mode + preset (+ options Style Editor). */
export function buildColors(mode: ThemeMode, preset: string, opts?: BuildColorsOptions): AppColors {
  const base = MODE_BASE[mode] ?? MODE_BASE.dark;
  const accent = resolveAccent(mode, preset, opts);
  const isLight = mode === 'light';

  // Transparence des cartes configurable
  const alpha = Math.min(100, Math.max(0, opts?.cardAlpha ?? (isLight ? 4 : 8))) / 100;
  const cardRGB = base.cardWhiteBase ? '255,255,255' : '0,0,0';
  const card = `rgba(${cardRGB},${alpha})`;
  const cardBorder = `rgba(${cardRGB},${Math.min(1, alpha + 0.04)})`;

  return {
    bg: base.bg,
    card,
    cardSolid: base.cardSolid,
    cardBorder,
    text: base.text,
    textSecondary: base.textSecondary,
    danger: base.danger,
    emerald: accent,
    accent,
    primary: accent,
    // alias
    border: cardBorder,
    background: base.bg,
    surface: card,
    sub: base.textSecondary,
    red: base.danger,
    screenBg: base.bg,
    tabActive: accent,
    tabInactive: base.textSecondary,
    // sémantiques fixes
    checking: '#0075FF',
    savings:  '#00B67A',
    investment: '#9B5CF6',
    balance: '#0075FF',
    blue:   '#0075FF',
    orange: '#FF9500',
    violet: '#9B5CF6',
    teal:   '#00C4CC',
    amber:  '#FF9500',
    green:  '#00B67A',
    warning: '#FF9500',
    success: '#00B67A',
    selected:     isLight ? '#F0F7FF' : '#0A1A2E',
    currentMonth: isLight ? '#F0F7FF' : '#0A1A2E',
  } as AppColors;
}

export const DEFAULT_MODE: ThemeMode = 'dark';
export const DEFAULT_PRESET: ThemePreset = 'emerald';
