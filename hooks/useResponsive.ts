/**
 * useResponsive — points de rupture partagés pour l'affichage WEB « bureau ».
 *
 * Relyka reste une app mobile : tout ce qui suit ne s'active QUE sur `Platform.OS === 'web'`.
 * Sur natif, `isDesktop`/`isWideDesktop` valent toujours `false` → aucun style mobile n'est touché.
 *
 * Seuils (alignés sur lib/webLayout) :
 *   < 768   → téléphone (navigateur mobile) : rendu identique à l'app
 *   768-1023 → tablette / petite fenêtre : colonne d'app centrée (comportement historique)
 *   >= 1024 → BUREAU : habillage « site web » (barre latérale + contenu large)
 *   >= 1440 → grand bureau : gouttières plus généreuses, grilles à 3 colonnes
 */
import { Platform, useWindowDimensions } from 'react-native';

/** Largeur minimale pour basculer sur l'habillage « site web » (barre latérale). */
export const DESKTOP_MIN_WIDTH = 1024;
/** Au-delà : écrans larges (grilles plus denses). */
export const WIDE_MIN_WIDTH = 1440;
/** En-dessous : téléphone. */
export const COMPACT_MAX_WIDTH = 768;

export interface Responsive {
  width: number;
  height: number;
  /** Plateforme web (navigateur), quelle que soit la largeur. */
  isWeb: boolean;
  /** Web ET fenêtre >= 1024 px → habillage bureau. */
  isDesktop: boolean;
  /** Web ET fenêtre >= 1440 px. */
  isWideDesktop: boolean;
  /** Web ET 768 <= largeur < 1024 → colonne d'app centrée. */
  isWebTablet: boolean;
  /** Largeur « téléphone » (web étroit ou natif). */
  isCompact: boolean;
  /** Nombre de colonnes conseillé pour une grille de cartes. */
  columns: 1 | 2 | 3;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isDesktop = isWeb && width >= DESKTOP_MIN_WIDTH;
  const isWideDesktop = isWeb && width >= WIDE_MIN_WIDTH;
  return {
    width,
    height,
    isWeb,
    isDesktop,
    isWideDesktop,
    isWebTablet: isWeb && width >= COMPACT_MAX_WIDTH && width < DESKTOP_MIN_WIDTH,
    isCompact: width < COMPACT_MAX_WIDTH,
    columns: isWideDesktop ? 3 : isDesktop ? 2 : 1,
  };
}

/** Raccourci : « sommes-nous en web bureau ? » (le seul test nécessaire dans 90 % des écrans). */
export function useIsDesktopWeb(): boolean {
  return useResponsive().isDesktop;
}
