/**
 * AnimatedSplash — splash React animé (natif uniquement) qui prend le relais du splash natif :
 *  1. démarre sur la couleur INTERMÉDIAIRE #808F88 (= splash natif après rebuild) ;
 *  2. fond enchaîné vers le thème ADMIN (clair = crème, sombre = teal) + apparition du loader ;
 *  3. tout le calque s'efface en fondu → révèle l'écran de chargement (même RelykaLoader) → seamless.
 *
 * Plus de logo (alignement supprimé) : on affiche directement le RelykaLoader, identique à
 * l'écran de chargement → aucune jonction de logo à gérer.
 */
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCachedAdminTheme } from '../lib/themeBoot';
import { useLandingConfig } from '../hooks/useLandingConfig';
import { useBrandColors } from '../hooks/useBrandColors';
import RelykaLoader from './RelykaLoader';

// Fond du splash : couleur INTERMÉDIAIRE (milieu clair #F4EFE6 ↔ teal sombre #0D2E2A).
// Doit correspondre à app.json > expo-splash-screen > backgroundColor (transition invisible).
const SPLASH_BG = '#808F88';
const BG_LIGHT = '#F4EFE6';
const BG_DARK = '#0D2E2A';

export default function AnimatedSplash({ onReady, onDone }: { onReady?: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { data: landing } = useLandingConfig();
  const COLORS = useBrandColors();
  const isLight = COLORS.mode === 'light';
  const themeBg = isLight ? BG_LIGHT : BG_DARK;
  const textColor = isLight ? '#191C1F' : '#FFFFFF';

  const bgFade = useRef(new Animated.Value(0)).current;   // fondu fond intermédiaire → thème
  const content = useRef(new Animated.Value(0)).current;  // apparition du loader
  const overlay = useRef(new Animated.Value(1)).current;  // fondu de sortie du calque
  const [gone, setGone] = useState(false);
  const startedRef = useRef(false);

  // Démarre quand le thème admin est connu (config chargée) — ou après un filet de sécurité réseau.
  useEffect(() => {
    if (startedRef.current) return;
    const themeKnown = landing !== undefined || getCachedAdminTheme() !== null;
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      // Séquence courte (~750 ms) : juste le temps du fondu de thème, puis on s'efface vite
      // vers la page (l'écran de chargement reprend le même loader si l'app n'est pas prête).
      Animated.sequence([
        Animated.delay(60),
        Animated.parallel([
          Animated.timing(bgFade, { toValue: 1, duration: 340, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(content, { toValue: 1, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.delay(70),
        Animated.timing(overlay, { toValue: 0, duration: 300, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) { setGone(true); onDone(); } });
    };
    if (themeKnown) start();
    const t = setTimeout(start, 600); // filet de sécurité réseau (raccourci)
    return () => clearTimeout(t);
  }, [landing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;

  return (
    <Animated.View pointerEvents="none" onLayout={onReady} style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}>
      {/* Fonds : plein écran (sous les barres système) */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      {/* Loader centré comme AppLoading (zone au-dessus de la barre de navigation) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.content, { paddingBottom: insets.bottom, opacity: content }]}>
        <RelykaLoader accent={COLORS.emerald} textColor={textColor} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  content: { alignItems: 'center', justifyContent: 'center' },
});
