/**
 * AppLoading — écran de chargement (pré-auth). Suit le thème admin global (couleurs via
 * useBrandColors) — jamais le choix utilisateur.
 *
 * Affiche le LOGO SEUL, à la même taille que le splash (natif) et que le boot-loader HTML (web,
 * app/+html.tsx) : pendant tout le chargement, l'utilisateur ne voit qu'une seule et même image,
 * sans jonction visible entre les étapes. Cf. AnimatedSplash.tsx.
 *
 * Version précédente (anneau RelykaLoader) : components/AppLoading.legacy.tsx (pour revert).
 */
import { View, Image, StyleSheet, Platform } from 'react-native';
import { useBrandColors } from '../../hooks/theme/useBrandColors';

// Fonds accordés au splash : sombre = teal, clair = crème.
const BG_DARK = '#0D2E2A';
const BG_LIGHT = '#F4EFE6';
/** Même taille qu'AnimatedSplash et que #app-boot .boot-logo (web). */
const LOGO = 96;

export default function AppLoading() {
  const COLORS = useBrandColors();
  const bg = COLORS.mode === 'light' ? BG_LIGHT : BG_DARK;

  return (
    // data-app-loading (web) : tant que ce marqueur est dans le DOM, le boot-loader HTML reste en
    // place (app/+html.tsx). Sinon il s'effacerait ICI, révélant un logo identique → dédoublement.
    <View
      style={[styles.root, { backgroundColor: bg }]}
      {...(Platform.OS === 'web' ? ({ dataSet: { appLoading: '1' } } as any) : {})}
    >
      <Image source={require('../../assets/logo.png')} style={{ width: LOGO, height: LOGO }} resizeMode="contain" fadeDuration={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
