/**
 * useAppColors — couleurs de l'app selon les préférences utilisateur + config de style globale.
 * - theme_mode + theme_preset : par utilisateur (profil)
 * - card_alpha, custom_accents, extra_presets : globaux (app_config via useStyleConfig)
 * Fallback : sombre / émeraude.
 */
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useStyleConfig } from './useStyleConfig';
import {
  buildColors, DEFAULT_MODE, DEFAULT_PRESET,
  type AppColors, type ThemeMode,
} from '../theme/palette';

export function useAppColors(): AppColors {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: styleConfig } = useStyleConfig();

  const mode = (profile?.theme_mode ?? DEFAULT_MODE) as ThemeMode;
  const preset = (profile?.theme_preset ?? DEFAULT_PRESET) as string;

  const cardAlpha = mode === 'light'
    ? styleConfig?.light.card_alpha
    : styleConfig?.dark.card_alpha;

  return useMemo(
    () => buildColors(mode, preset, {
      cardAlpha,
      customAccents: styleConfig?.custom_accents,
      extraPresets: styleConfig?.extra_presets,
    }),
    [mode, preset, cardAlpha, styleConfig?.custom_accents, styleConfig?.extra_presets]
  );
}
