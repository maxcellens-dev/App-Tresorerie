/**
 * useInvertedColors — la palette de l'app dans le mode CONTRAIRE (sombre si l'utilisateur est en
 * clair, et inversement).
 *
 * À quoi ça sert : les modaux du GUIDE utilisateur doivent se détacher franchement de la page qu'ils
 * recouvrent. Un modal aux couleurs de la page se lit comme un simple bloc de plus ; inversé, il se
 * lit comme « quelqu'un te parle par-dessus l'app ». Même accent, mêmes couleurs sémantiques (elles
 * sont recalculées pour le mode inversé) : ce n'est pas un autre thème, c'est le même en négatif.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useStyleConfig } from './useStyleConfig';
import { getCachedUserTheme, subscribeThemeCache, themeCacheVersion } from '../lib/themeBoot';
import { buildColors, DEFAULT_MODE, DEFAULT_PRESET, type AppColors, type ThemeMode } from '../theme/palette';

export function useInvertedColors(): AppColors {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: styleConfig } = useStyleConfig();

  useSyncExternalStore(subscribeThemeCache, themeCacheVersion, themeCacheVersion);
  const cached = getCachedUserTheme();
  const mode = (profile?.theme_mode ?? cached?.mode ?? DEFAULT_MODE) as ThemeMode;
  const inverted: ThemeMode = mode === 'light' ? 'dark' : 'light';
  const preset = (profile?.theme_preset ?? cached?.preset ?? DEFAULT_PRESET) as string;

  // Réglages du Style Editor pour le mode INVERSÉ (chaque mode a les siens).
  const cfg = inverted === 'light' ? styleConfig?.light : styleConfig?.dark;

  return useMemo(() => buildColors(inverted, preset, {
    // Cartes OPAQUES dans les modaux du guide : la transparence laisserait voir la page en dessous,
    // ce qui annule justement l'effet de contraste recherché.
    cardAlpha: 100,
    bgColor: cfg?.bg_color,
    headerAlpha: cfg?.header_alpha,
    inkColor: cfg?.ink_color,
    cardColor: cfg?.card_color,
    customAccents: styleConfig?.custom_accents,
    extraPresets: styleConfig?.extra_presets,
    semanticColors: styleConfig?.semantic_colors,
    lightSemanticColors: styleConfig?.light_semantic_colors,
  }), [inverted, preset, cfg, styleConfig]);
}
