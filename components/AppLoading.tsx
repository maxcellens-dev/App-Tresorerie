/**
 * AppLoading — écran de chargement (pré-auth). Suit le thème admin global (couleurs via
 * useBrandColors) — jamais le choix utilisateur. Affiche le RelykaLoader (anneau lumineux +
 * « Relyka » au centre) ; plus de logo (alignement supprimé).
 */
import { View, StyleSheet } from 'react-native';
import { useBrandColors } from '../hooks/useBrandColors';
import RelykaLoader from './RelykaLoader';

// Fonds accordés au splash : sombre = teal, clair = crème.
const BG_DARK = '#0D2E2A';
const BG_LIGHT = '#F4EFE6';

export default function AppLoading() {
  const COLORS = useBrandColors();
  const isLight = COLORS.mode === 'light';
  const bg = isLight ? BG_LIGHT : BG_DARK;
  const textColor = isLight ? '#191C1F' : '#FFFFFF';

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <RelykaLoader accent={COLORS.emerald} textColor={textColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
