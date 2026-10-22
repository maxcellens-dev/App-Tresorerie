/**
 * La palette du Jardin, exprimée dans le format de la palette de l'app (`AppColors`).
 *
 * Pourquoi : l'app compte une trentaine d'écrans existants (fiche d'un compte, saisie, crédit,
 * Succès, réglages, boutique…) qui lisent tous leurs couleurs par `useAppColors()`. Quand le Jardin
 * est ouvert pour l'utilisateur, `useAppColors` renvoie CETTE palette : chaque écran prend d'un coup
 * le fond, les cartes, l'encre et les couleurs de matière du Jardin, sans être réécrit.
 *
 * C'est un mode CLAIR (`mode: 'light'`) : tous les écrans savent déjà se rendre en clair. Les
 * couleurs sémantiques suivent les parties de l'arbre (comptes courants = eau, épargne = racines,
 * placements = branches) et le rouge d'alerte est adouci (règle « pas de rouge d'alarme »).
 * `isGardenPalette` permet aux rares décors (dégradé de fond) de s'effacer.
 */
import type { AppColors } from '../../theme/palette';
import { GARDEN_COLORS as G, applyGardenTheme, gardenThemeColors, type GardenOverrides, type GardenPaletteValues, type GardenGlowConfig } from './theme';

/** Palettes du Jardin déjà construites, une par (mode, accent, surcharges). */
const byKey = new Map<string, AppColors>();
const gardenPalettes = new WeakSet<object>();

/** Palette de l'app (format `AppColors`) à partir des couleurs du Jardin d'un mode. */
function toAppColors(P: GardenPaletteValues, mode: 'light' | 'dark'): AppColors {
  const c = {
    mode,
    bg: P.bg,
    card: P.card,
    cardSolid: P.card,
    cardOpaque: P.card,
    cardBorder: P.line,
    text: P.ink,
    textSecondary: P.muted,
    danger: P.fruitsText,
    emerald: P.primary,
    accent: P.primary,
    primary: P.primary,
    border: P.line,
    background: P.bg,
    surface: P.card,
    sub: P.muted,
    red: P.fruitsText,
    screenBg: P.bg,
    tabActive: P.ink,
    tabInactive: P.muted,
    checking: P.waterText,
    savings: P.rootsText,
    investment: P.branchesText,
    balance: P.waterText,
    blue: P.waterText,
    orange: P.fruitsText,
    // Hors matières : éclaircis la nuit, sinon un violet foncé sur fond sombre ne se lit pas.
    violet: mode === 'dark' ? '#C9B8F7' : '#6B4FB0',
    teal: mode === 'dark' ? '#86D9D9' : '#1F7A7A',
    amber: P.rootsText,
    green: P.primary,
    yellow: P.noticeText,
    warning: P.noticeText,
    success: P.primary,
    selected: P.branchesBg,
    currentMonth: P.branchesBg,
    headerBg: P.glow,
    onAccent: P.onPrimary,
    accentText: P.primary,
  } as AppColors;
  gardenPalettes.add(c);
  return c;
}

/**
 * Palette du Jardin selon le MODE (clair / sombre) et la COULEUR D'ACCENT choisis dans Apparence,
 * comme avant la refonte : l'accent colore les boutons et teinte le fond. `accent` absent = le vert
 * du Jardin. Les composants du Jardin lisent GARDEN_COLORS, mis à jour ici (applyGardenTheme).
 * `overrides` : couleurs du Jardin réglées par l'admin dans le Style Editor (app_config.theme.style.garden).
 * ⚠️ RÉSERVÉ au thème de l'APP (useAppColors) : cette fonction ÉCRIT les couleurs actives.
 */
export function gardenAppColors(accent?: string | null, mode: 'light' | 'dark' = 'light', overrides?: GardenOverrides | null, glow?: Partial<GardenGlowConfig> | null): AppColors {
  const key = applyGardenTheme(mode, accent, overrides, glow);
  const hit = byKey.get(key);
  if (hit) return hit;
  const c = toAppColors({ ...G }, mode);
  byKey.set(key, c);
  return c;
}

/**
 * Même palette, SANS toucher aux couleurs actives (GARDEN_COLORS). Pour les couleurs des pages
 * publiques (useBrandColors) : ce hook est monté AUSSI une fois connecté (splash, chargement,
 * mises à jour) — s'il réécrivait les couleurs actives en clair, le mode sombre de l'app se
 * cassait par endroits (cartes blanches, texte foncé sur fond foncé).
 */
export function gardenColorsFor(accent?: string | null, mode: 'light' | 'dark' = 'light', overrides?: GardenOverrides | null, glow?: Partial<GardenGlowConfig> | null): AppColors {
  const key = `pure|${mode}|${accent ?? ''}|${overrides ? JSON.stringify(overrides) : ''}|${glow ? JSON.stringify(glow) : ''}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const c = toAppColors(gardenThemeColors(mode, accent, overrides, glow), mode);
  byKey.set(key, c);
  return c;
}

/** Vrai si `colors` est une palette du Jardin (quelle que soit sa couleur d'accent). */
export function isGardenPalette(colors: AppColors): boolean {
  return !!colors && gardenPalettes.has(colors as any);
}
