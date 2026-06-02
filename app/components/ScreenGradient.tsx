/**
 * ScreenGradient — dégradé de fond global, piloté par la config du Style Editor.
 * À placer juste après <StatusBar/> dans chaque écran, en absoluteFill.
 *
 * L'opacité (intensité) et l'activation sont lues depuis app_config.theme.style
 * pour le mode courant. La couleur suit l'accent actif (COLORS.emerald).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../hooks/useAppColors';
import { useStyleConfig, getGradientStops } from '../hooks/useStyleConfig';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';

/** Convertit 0-1 en composante hex alpha "00"-"FF". */
function toHexAlpha(a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return v.toString(16).padStart(2, '0').toUpperCase();
}

export default function ScreenGradient() {
  const COLORS = useAppColors();
  const { data: styleConfig } = useStyleConfig();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);

  const mode = (profile?.theme_mode ?? 'dark') as 'dark' | 'light';
  const cfg = mode === 'light' ? styleConfig?.light : styleConfig?.dark;

  const enabled = cfg?.gradient_enabled ?? true;
  if (!enabled) return null;

  // 4 paliers d'opacité configurables (du haut vers le bas)
  const stops = getGradientStops(cfg, mode === 'light' ? 20 : 30);
  if (stops.every((s) => s <= 0)) return null;

  const accent = COLORS.emerald;
  const colors = stops.map((s) => accent + toHexAlpha(s));

  return (
    <LinearGradient
      colors={colors as any}
      locations={[0, 0.28, 0.58, 1.0]}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    />
  );
}
