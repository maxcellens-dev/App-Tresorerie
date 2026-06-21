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
import { onAppReady } from '../lib/splashGate';
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
  const themeKnown = landing !== undefined || getCachedAdminTheme() !== null;
  const themeBg = isLight ? BG_LIGHT : BG_DARK;
  const textColor = isLight ? '#191C1F' : '#FFFFFF';

  const bgFade = useRef(new Animated.Value(0)).current;   // fondu fond intermédiaire → thème
  const content = useRef(new Animated.Value(0)).current;  // apparition du loader
  const contentY = useRef(new Animated.Value(0)).current; // glissement du loader vers le haut (sortie)
  const overlay = useRef(new Animated.Value(1)).current;  // fondu de sortie du calque
  const [gone, setGone] = useState(false);
  const outRef = useRef(false);

  // Apparition immédiate du loader.
  useEffect(() => {
    Animated.timing(content, { toValue: 1, duration: 200, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Crossfade du fond intermédiaire vers le vrai thème, UNIQUEMENT quand il est connu (pas de pop).
  useEffect(() => {
    if (themeKnown) {
      Animated.timing(bgFade, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
    }
  }, [themeKnown, bgFade]);

  // Sortie UNIQUEMENT quand la page de destination est réellement prête (signal splashGate, émis
  // par pilotage une fois chargé, par l'accueil, etc.). Filet de sécurité à 8 s.
  useEffect(() => {
    let delayTimer: ReturnType<typeof setTimeout>;
    const fadeOut = () => {
      if (outRef.current) return;
      outRef.current = true;
      // Sortie = fondu + glissement du loader vers le haut (effet d'apparition de la page dessous).
      Animated.parallel([
        Animated.timing(overlay, { toValue: 0, duration: 340, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        Animated.timing(contentY, { toValue: -64, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) { setGone(true); onDone(); } });
    };
    // Petit délai (100 ms) APRÈS le signal « prêt » : laisse la page de destination finir de se
    // peindre avant de révéler → on ne voit plus la fin du cercle de chargement.
    const unsub = onAppReady(() => { delayTimer = setTimeout(fadeOut, 100); });
    const cap = setTimeout(fadeOut, 8000);
    return () => { unsub(); clearTimeout(cap); clearTimeout(delayTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;

  return (
    <Animated.View pointerEvents="none" onLayout={onReady} style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}>
      {/* Fonds : plein écran (sous les barres système) */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      {/* Loader centré comme AppLoading (zone au-dessus de la barre de navigation) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.content, { paddingBottom: insets.bottom, opacity: content, transform: [{ translateY: contentY }] }]}>
        <RelykaLoader accent={COLORS.emerald} textColor={textColor} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  content: { alignItems: 'center', justifyContent: 'center' },
});
