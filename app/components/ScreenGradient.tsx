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
import { useStyleConfig } from '../hooks/useStyleConfig';
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

  // Valeurs par défaut si la config n'est pas encore chargée
  const enabled = cfg?.gradient_enabled ?? true;
  const opacityPct = cfg?.gradient_opacity ?? (mode === 'light' ? 20 : 30);

  if (!enabled || opacityPct <= 0) return null;

  const base = opacityPct / 100; // intensité du stop le plus fort (0-1)
  const a1 = toHexAlpha(base);          // 100 % de l'intensité
  const a2 = toHexAlpha(base * 0.6);    // 60 %
  const a3 = toHexAlpha(base * 0.33);   // 33 %
  const accent = COLORS.emerald;

  return (
    <LinearGradient
      colors={[accent + a1, accent + a2, accent + a3, COLORS.bg]}
      locations={[0, 0.28, 0.58, 1.0]}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    />
  );
}
