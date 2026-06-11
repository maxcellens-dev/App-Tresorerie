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
  yellow: string;
  warning: string;
  success: string;
  selected: string;
  currentMonth: string;
  [key: string]: string;
}

/**
 * Couleurs sémantiques principales — valeurs par défaut harmonisées (pastel).
 * Surchargeables globalement depuis le Style Editor (admin) via `semantic_colors`.
 * Ces clés pilotent boutons, montants et textes partout dans l'app.
 */
export const SEMANTIC_KEYS = ['danger', 'blue', 'violet', 'green', 'orange', 'teal', 'yellow', 'grey'] as const;
export type SemanticKey = typeof SEMANTIC_KEYS[number];

export const SEMANTIC_DEFAULTS: Record<SemanticKey, string> = {
  danger: '#f87171', // rouge (dépenses, suppression, erreurs)
  blue:   '#60a5fa', // compte courant, réservé, virement, solde
  violet: '#a78bfa', // investissement
  green:  '#00B67A', // épargne, recettes, succès
  orange: '#FF9500', // dépenses variables
  teal:   '#00C4CC', // projets
  yellow: '#fbbf24', // marge de sécurité
  grey:   '#8E949A', // textes secondaires / libellés
};

export const SEMANTIC_LABELS: Record<SemanticKey, { label: string; emoji: string }> = {
  danger: { label: 'Rouge (dépenses)',       emoji: '🔴' },
  blue:   { label: 'Bleu (courant)',          emoji: '🔵' },
  violet: { label: 'Violet (investissement)', emoji: '🟣' },
  green:  { label: 'Vert (épargne)',          emoji: '🟢' },
  orange: { label: 'Orange (variables)',      emoji: '🟠' },
  teal:   { label: 'Teal (projets)',          emoji: '🩵' },
  yellow: { label: 'Jaune (marge)',           emoji: '🟡' },
  grey:   { label: 'Gris (textes secondaires)', emoji: '🩶' },
};

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
  /** Surcharges hex des couleurs sémantiques { danger:'#xxxxxx', blue:'#xxxxxx', ... } */
  semanticColors?: Record<string, string>;
  /** Couleur de fond de l'app (derrière le dégradé) pour le mode courant. */
  bgColor?: string;
}

/** Couleurs de fond par défaut par mode (modifiables via le Style Editor). */
export const DEFAULT_BG: Record<ThemeMode, string> = { dark: '#000000', light: '#FFFFFF' };

/** Résout la couleur d'accent pour un preset donné (natif, custom hex ou preset perso). */
export function resolveAccent(mode: ThemeMode, preset: string, opts?: BuildColorsOptions): string {
  // 0. Couleur personnalisée saisie par l'utilisateur (theme_preset = hex direct)
  if (/^#[0-9A-Fa-f]{6}$/.test(preset)) return preset;
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
  const bg = (opts?.bgColor && /^#[0-9A-Fa-f]{6}$/.test(opts.bgColor)) ? opts.bgColor : base.bg;

  // Transparence des cartes configurable
  const alpha = Math.min(100, Math.max(0, opts?.cardAlpha ?? (isLight ? 4 : 8))) / 100;
  const cardRGB = base.cardWhiteBase ? '255,255,255' : '0,0,0';
  const card = `rgba(${cardRGB},${alpha})`;
  const cardBorder = `rgba(${cardRGB},${Math.min(1, alpha + 0.04)})`;

  // Couleurs sémantiques (surchargeables globalement via le Style Editor admin).
  const sem = (key: SemanticKey): string => {
    const v = opts?.semanticColors?.[key];
    return v && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : SEMANTIC_DEFAULTS[key];
  };
  const danger = sem('danger');
  const blue   = sem('blue');
  const violet = sem('violet');
  const green  = sem('green');
  const orange = sem('orange');
  const teal   = sem('teal');
  const yellow = sem('yellow');
  // Gris des textes secondaires : surchargé seulement s'il est explicitement défini
  // (sinon on garde le gris par défaut propre à chaque mode).
  const greyRaw = opts?.semanticColors?.grey;
  const textSecondary = greyRaw && /^#[0-9A-Fa-f]{6}$/.test(greyRaw) ? greyRaw : base.textSecondary;

  return {
    bg,
    card,
    cardSolid: base.cardSolid,
    cardBorder,
    text: base.text,
    textSecondary,
    danger,
    emerald: accent,
    accent,
    primary: accent,
    // alias
    border: cardBorder,
    background: bg,
    surface: card,
    sub: textSecondary,
    red: danger,
    screenBg: bg,
    tabActive: accent,
    tabInactive: textSecondary,
    // sémantiques (overridables)
    checking: blue,
    savings:  green,
    investment: violet,
    balance: blue,
    blue,
    orange,
    violet,
    teal,
    amber:  orange,
    green,
    yellow,
    warning: orange,
    success: green,
    selected:     isLight ? '#F0F7FF' : '#0A1A2E',
    currentMonth: isLight ? '#F0F7FF' : '#0A1A2E',
  } as AppColors;
}

export const DEFAULT_MODE: ThemeMode = 'dark';
export const DEFAULT_PRESET: ThemePreset = 'emerald';

/** Assombrit une couleur hex (#RRGGBB) vers le noir d'un facteur 0-1. */
function darkenHex(hex: string, factor: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const f = Math.min(1, Math.max(0, factor));
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - f));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - f));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - f));
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Couleur sémantique adaptée au texte selon le mode.
 * - Mode sombre : couleur inchangée (ressort bien sur fond noir).
 * - Mode clair  : couleur assombrie ~25 % (moins « flashy » sur fond blanc),
 *   sans modifier la palette stockée.
 */
export function semanticText(hex: string, COLORS: AppColors): string {
  const isLight = COLORS.bg === '#FFFFFF';
  return isLight ? darkenHex(hex, 0.28) : hex;
}

/** Pastille translucide (12 %) pour poser une valeur colorée. */
export function semanticPill(hex: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  return hex + '1F'; // ~12 %
}
