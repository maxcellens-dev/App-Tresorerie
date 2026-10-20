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
import { GARDEN_COLORS as G, applyGardenTheme } from './theme';

/** Palettes du Jardin déjà construites, une par (mode, accent). */
const byKey = new Map<string, AppColors>();
const gardenPalettes = new WeakSet<object>();

/**
 * Palette du Jardin selon le MODE (clair / sombre) et la COULEUR D'ACCENT choisis dans Apparence,
 * comme avant la refonte : l'accent colore les boutons et teinte le fond. `accent` absent = le vert
 * du Jardin. Les composants du Jardin lisent GARDEN_COLORS, mis à jour ici (applyGardenTheme).
 */
export function gardenAppColors(accent?: string | null, mode: 'light' | 'dark' = 'light'): AppColors {
  const key = applyGardenTheme(mode, accent);
  const hit = byKey.get(key);
  if (hit) return hit;
  const cached = {
    mode,
    bg: G.bg,
    card: G.card,
    cardSolid: G.card,
    cardOpaque: G.card,
    cardBorder: G.line,
    text: G.ink,
    textSecondary: G.muted,
    danger: G.fruitsText,
    emerald: G.primary,
    accent: G.primary,
    primary: G.primary,
    border: G.line,
    background: G.bg,
    surface: G.card,
    sub: G.muted,
    red: G.fruitsText,
    screenBg: G.bg,
    tabActive: G.ink,
    tabInactive: G.muted,
    checking: G.waterText,
    savings: G.rootsText,
    investment: G.branchesText,
    balance: G.waterText,
    blue: G.waterText,
    orange: G.fruitsText,
    violet: '#6B4FB0',
    teal: '#1F7A7A',
    amber: G.rootsText,
    green: G.primary,
    yellow: G.noticeText,
    warning: G.noticeText,
    success: G.primary,
    selected: G.branchesBg,
    currentMonth: G.branchesBg,
    headerBg: G.glow,
    onAccent: G.onPrimary,
    accentText: G.primary,
  } as AppColors;
  byKey.set(key, cached);
  gardenPalettes.add(cached);
  return cached;
}

/** Vrai si `colors` est une palette du Jardin (quelle que soit sa couleur d'accent). */
export function isGardenPalette(colors: AppColors): boolean {
  return !!colors && gardenPalettes.has(colors as any);
}
