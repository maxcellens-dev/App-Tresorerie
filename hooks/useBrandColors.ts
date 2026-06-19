/**
 * useBrandColors — palette de marque (accent émeraude), indépendante des préférences
 * utilisateur. Utilisée par les écrans pré-auth (accueil, connexion, inscription, etc.).
 * Le MODE clair/sombre suit le réglage de la page d'accueil (app_config.landing.theme),
 * piloté en admin → toute la vitrine bascule ensemble. L'accent reste émeraude.
 * Respecte les réglages globaux du Style Editor (transparence cartes, presets, couleurs sémantiques).
 */
import { useMemo } from 'react';
import { useStyleConfig } from './useStyleConfig';
import { useLandingConfig } from './useLandingConfig';
import { getCachedAdminTheme } from '../lib/themeBoot';
import { buildColors, type AppColors, type ThemeMode } from '../theme/palette';

export function useBrandColors(): AppColors {
  const { data: styleConfig } = useStyleConfig();
  const { data: landing } = useLandingConfig();
  // Avant la réponse réseau : dernier thème admin connu (localStorage web) → pas de flash sombre.
  const mode = (landing?.theme ?? getCachedAdminTheme() ?? 'dark') as ThemeMode;
  return useMemo(
    () => buildColors(mode, 'emerald', {
      cardAlpha: mode === 'light' ? styleConfig?.light.card_alpha : styleConfig?.dark.card_alpha,
      bgColor: mode === 'light' ? styleConfig?.light.bg_color : styleConfig?.dark.bg_color,
      headerAlpha: mode === 'light' ? styleConfig?.light.header_alpha : styleConfig?.dark.header_alpha,
      customAccents: styleConfig?.custom_accents,
      extraPresets: styleConfig?.extra_presets,
      semanticColors: styleConfig?.semantic_colors,
      lightSemanticColors: styleConfig?.light_semantic_colors,
    }),
    [mode, styleConfig]
  );
}
