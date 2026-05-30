/**
 * useAppColors — couleurs de l'app selon les préférences de l'utilisateur.
 * Lit theme_mode + theme_preset depuis le profil (mis en cache par React Query)
 * et renvoie le jeu de couleurs correspondant. Fallback : sombre / émeraude.
 */
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import {
  buildColors, DEFAULT_MODE, DEFAULT_PRESET,
  type AppColors, type ThemeMode, type ThemePreset,
} from '../theme/palette';

export function useAppColors(): AppColors {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const mode = (profile?.theme_mode ?? DEFAULT_MODE) as ThemeMode;
  const preset = (profile?.theme_preset ?? DEFAULT_PRESET) as ThemePreset;
  return useMemo(() => buildColors(mode, preset), [mode, preset]);
}
