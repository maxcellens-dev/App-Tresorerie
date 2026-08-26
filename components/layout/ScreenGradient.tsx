/**
 * ScreenGradient — dégradé de fond global, piloté par la config du Style Editor.
 * À placer juste après <StatusBar/> dans chaque écran, en absoluteFill.
 *
 * L'opacité (intensité) et l'activation sont lues depuis app_config.theme.style
 * pour le mode courant. La couleur suit l'accent actif (COLORS.emerald).
 */
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useStyleConfig, getGradientStops } from '../../hooks/theme/useStyleConfig';

/** Convertit 0-1 en composante hex alpha "00"-"FF". */
function toHexAlpha(a: number): string {
  const v = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return v.toString(16).padStart(2, '0').toUpperCase();
}

export default function ScreenGradient() {
  const COLORS = useAppColors();
  const { data: styleConfig } = useStyleConfig();

  /* Même source que l'entête (HeaderWithProfile) : le mode de la palette RÉELLEMENT appliquée.
     Lu depuis `profiles.theme_mode`, il valait « sombre » tant que le profil n'était pas revenu —
     donc au démarrage et hors-ligne — alors que l'app était déjà peinte en clair : le corps prenait
     les paliers du mode sombre. Les deux composants doivent lire la même chose, sinon une couture
     apparaît entre la barre du haut et le corps de la page. */
  const mode = COLORS.mode as 'dark' | 'light';
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
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}
