/**
 * AnimatedSplash — splash React animé (natif uniquement) qui prend le relais du splash natif
 * pour une transition SEAMLESS. Il est VISUELLEMENT IDENTIQUE à AppLoading (logo centré pulsant,
 * « Relyka » dessous, anneau qui tourne — mêmes tailles/marges/animations) : ainsi, quand il
 * s'efface, l'écran de chargement (ou l'accueil) apparaît SANS décalage du logo.
 *
 *  1. démarre sur la couleur INTERMÉDIAIRE #808F88 (= splash natif après rebuild) ;
 *  2. fond enchaîné vers le thème ADMIN (clair = crème, sombre = teal) + apparition du nom/anneau ;
 *  3. tout le calque s'efface en fondu → révèle l'écran dessous, logo au même endroit.
 *
 * Tout est JS/OTA. Le splash natif lui-même (app.json) ne change qu'au rebuild.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getCachedAdminTheme } from '../lib/themeBoot';
import { useLandingConfig } from '../hooks/useLandingConfig';

// Fond du splash : couleur INTERMÉDIAIRE (milieu clair #F4EFE6 ↔ teal sombre #0D2E2A).
// Doit correspondre à app.json > expo-splash-screen > backgroundColor (transition invisible).
const SPLASH_BG = '#808F88';
const BG_LIGHT = '#F4EFE6';
const BG_DARK = '#0D2E2A';
const ACCENT = '#00B67A';

export default function AnimatedSplash({ onReady, onDone }: { onReady?: () => void; onDone: () => void }) {
  // Mêmes marges système que l'écran natif où s'affiche AppLoading (status bar / barre de nav),
  // pour que le logo soit EXACTEMENT à la même hauteur → jonction sans décalage.
  const insets = useSafeAreaInsets();
  const { data: landing } = useLandingConfig();
  const isLight = (landing?.theme ?? getCachedAdminTheme() ?? 'dark') === 'light';
  const themeBg = isLight ? BG_LIGHT : BG_DARK; // cible du fondu = vrai fond du thème
  const brandColor = isLight ? '#191C1F' : '#FFFFFF';

  const pulse = useRef(new Animated.Value(0)).current;     // pulsation logo (comme AppLoading)
  const spin = useRef(new Animated.Value(0)).current;      // rotation anneau (comme AppLoading)
  const bgFade = useRef(new Animated.Value(0)).current;    // fondu fond intermédiaire → thème
  const content = useRef(new Animated.Value(0)).current;   // apparition nom + anneau
  const overlay = useRef(new Animated.Value(1)).current;   // fondu de sortie du calque
  const [gone, setGone] = useState(false);
  const startedRef = useRef(false);

  // Boucles continues identiques à AppLoading → état d'animation identique à la jonction.
  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    const s = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    p.start(); s.start();
    return () => { p.stop(); s.stop(); };
  }, [pulse, spin]);

  // Entrée (fondu fond + nom/anneau) puis sortie (fondu du calque). Démarrée quand le thème admin
  // est connu (config chargée) — ou après un court filet de sécurité réseau.
  useEffect(() => {
    if (startedRef.current) return;
    const themeKnown = landing !== undefined || getCachedAdminTheme() !== null;
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.timing(bgFade, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(content, { toValue: 1, duration: 520, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.delay(420),
        Animated.timing(overlay, { toValue: 0, duration: 480, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) { setGone(true); onDone(); } });
    };
    if (themeKnown) start();
    const t = setTimeout(start, 900);
    return () => clearTimeout(t);
  }, [landing]); // eslint-disable-line react-hooks/exhaustive-deps

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const logoOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  if (gone) return null;

  return (
    <Animated.View pointerEvents="none" onLayout={onReady} style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}>
      {/* Fonds : PLEIN écran (sous les barres système) → aucune zone non peinte */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      {/* Contenu : l'écran natif d'AppLoading dessine SOUS la barre de statut mais s'arrête au-dessus
          de la barre de navigation → son contenu est centré dans [0, H − navbar], donc plus haut.
          On réserve donc insets.bottom en bas pour centrer le logo EXACTEMENT à la même hauteur. */}
      <View style={[StyleSheet.absoluteFill, styles.content, { paddingBottom: insets.bottom }]}>
        <Animated.View style={{ marginBottom: 22, transform: [{ scale }], opacity: logoOpacity }}>
          <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
        </Animated.View>
        <Animated.Text style={[styles.brand, { color: brandColor, opacity: content }]}>Relyka</Animated.Text>
        <Animated.View style={[styles.ring, { opacity: content, transform: [{ rotate }] }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  content: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 96, height: 96 },
  brand: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 26 },
  ring: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: ACCENT + '33', borderTopColor: ACCENT },
});
