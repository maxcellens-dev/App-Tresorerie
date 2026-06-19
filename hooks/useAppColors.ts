/**
 * useAppColors — couleurs de l'app selon les préférences utilisateur + config de style globale.
 * - theme_mode + theme_preset : par utilisateur (profil)
 * - card_alpha, custom_accents, extra_presets : globaux (app_config via useStyleConfig)
 * Fallback : sombre / émeraude.
 */
import { useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useStyleConfig } from './useStyleConfig';
import { getCachedUserTheme, setCachedUserTheme } from '../lib/themeBoot';
import {
  buildColors, DEFAULT_MODE, DEFAULT_PRESET,
  type AppColors, type ThemeMode,
} from '../theme/palette';

export function useAppColors(): AppColors {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: styleConfig } = useStyleConfig();

  // Au rechargement web, le profil n'est pas encore chargé : on repart du dernier thème
  // utilisateur mémorisé (localStorage) au lieu du défaut sombre → pas de flash de fond noir.
  const cachedUser = getCachedUserTheme();
  const mode = (profile?.theme_mode ?? cachedUser?.mode ?? DEFAULT_MODE) as ThemeMode;
  const preset = (profile?.theme_preset ?? cachedUser?.preset ?? DEFAULT_PRESET) as string;

  // Mémorise le thème dès qu'il est réellement connu (profil chargé) pour le prochain démarrage.
  useEffect(() => {
    if (profile?.theme_mode) setCachedUserTheme(profile.theme_mode, profile.theme_preset ?? DEFAULT_PRESET);
  }, [profile?.theme_mode, profile?.theme_preset]);

  const cardAlpha = mode === 'light'
    ? styleConfig?.light.card_alpha
    : styleConfig?.dark.card_alpha;
  const bgColor = mode === 'light'
    ? styleConfig?.light.bg_color
    : styleConfig?.dark.bg_color;
  const headerAlpha = mode === 'light'
    ? styleConfig?.light.header_alpha
    : styleConfig?.dark.header_alpha;

  return useMemo(
    () => buildColors(mode, preset, {
      cardAlpha,
      bgColor,
      headerAlpha,
      customAccents: styleConfig?.custom_accents,
      extraPresets: styleConfig?.extra_presets,
      semanticColors: styleConfig?.semantic_colors,
      lightSemanticColors: styleConfig?.light_semantic_colors,
    }),
    [mode, preset, cardAlpha, bgColor, headerAlpha, styleConfig?.custom_accents, styleConfig?.extra_presets, styleConfig?.semantic_colors, styleConfig?.light_semantic_colors]
  );
}
