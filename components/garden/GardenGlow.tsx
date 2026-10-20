/**
 * Halo d'accent du Jardin de nuit : un dégradé qui descend du haut de l'écran, de la teinte `glow`
 * (celle de la barre du haut, d'où l'absence de couture) vers le fond de page. C'est la
 * « dynamique » de l'ancienne interface sombre (fond + dégradé d'accent), sans laquelle le mode
 * sombre du Jardin n'était qu'un aplat presque noir.
 *
 * En clair, `glow` = `bg` : rien n'est rendu.
 */
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GARDEN_COLORS } from '../../lib/garden/theme';

export default function GardenGlow() {
  if (GARDEN_COLORS.glow === GARDEN_COLORS.bg) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[GARDEN_COLORS.glow, GARDEN_COLORS.bg]}
      locations={[0, 0.6]}
      style={[StyleSheet.absoluteFill, { bottom: undefined, height: 520 }]}
    />
  );
}
