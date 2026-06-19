/**
 * AnimatedSplash — splash React animé (natif uniquement) qui prend le relais du splash natif
 * (expo-splash-screen) pour une transition SEAMLESS vers l'app :
 *  1. démarre EXACTEMENT comme le splash natif (fond teal #0D2E2A, logo centré) → aucun saut ;
 *  2. fond enchaîné du fond vers le THÈME ADMIN (clair = crème, sombre = teal) ;
 *  3. le logo « monte » et rétrécit vers le haut (vers l'emplacement du logo de la page suivante)
 *     pendant que tout le calque s'efface → révèle l'écran dessous (accueil OU écran de chargement).
 *
 * Fonctionne déconnecté (révèle l'accueil) comme connecté (révèle l'écran de chargement, déjà
 * accordé au thème) → plus de « sombre puis clair » brutal.
 *
 * Le splash natif restant codé en dur en teal (app.json), le fondu enchaîné habille proprement
 * le passage teal → thème clair sans rebuild (tout est JS/OTA).
 */
import { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, Animated, Easing } from 'react-native';
import { getCachedAdminTheme } from '../lib/themeBoot';
import { useLandingConfig } from '../hooks/useLandingConfig';

// Fond du splash : couleur INTERMÉDIAIRE (milieu entre le thème clair #F4EFE6 et le teal sombre
// #0D2E2A) → écart minimal avec l'un comme l'autre. Doit correspondre à app.json >
// expo-splash-screen > backgroundColor pour une transition invisible (nécessite un rebuild natif).
const SPLASH_BG = '#808F88';
const BG_LIGHT = '#F4EFE6';
const BG_DARK = '#0D2E2A';

export default function AnimatedSplash({ onReady, onDone }: { onReady?: () => void; onDone: () => void }) {
  const { data: landing } = useLandingConfig();
  const isLight = (landing?.theme ?? getCachedAdminTheme() ?? 'dark') === 'light';
  const themeBg = isLight ? BG_LIGHT : BG_DARK; // cible du fondu : vrai fond du thème
  const brandColor = isLight ? '#191C1F' : '#FFFFFF';

  const bgFade = useRef(new Animated.Value(0)).current;   // 0 = fond natif, 1 = fond thème
  const brand = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const logoY = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);
  const startedRef = useRef(false);

  // Démarre la séquence quand le thème admin est connu (config chargée) — ou après un court délai
  // de sécurité si le réseau tarde (on part alors du défaut). Évite un « pop » de couleur tardif.
  useEffect(() => {
    if (startedRef.current) return;
    const themeKnown = landing !== undefined || getCachedAdminTheme() !== null;
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const seq = Animated.sequence([
        Animated.delay(120),
        // Fondu enchaîné du fond + apparition du nom + petit « battement » du logo.
        Animated.parallel([
          Animated.timing(bgFade, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(brand, { toValue: 1, duration: 480, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.sequence([
            Animated.timing(logoScale, { toValue: 1.08, duration: 320, easing: Easing.out(Easing.ease), useNativeDriver: true }),
            Animated.timing(logoScale, { toValue: 1, duration: 320, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ]),
        Animated.delay(200),
        // Le logo monte + rétrécit (vers l'en-tête de la page suivante) tandis que le calque s'efface.
        Animated.parallel([
          Animated.timing(overlay, { toValue: 0, duration: 480, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          Animated.timing(logoY, { toValue: -64, duration: 480, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          Animated.timing(logoScale, { toValue: 0.82, duration: 480, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
      ]);
      seq.start(({ finished }) => { if (finished) { setGone(true); onDone(); } });
    };
    if (themeKnown) start();
    const t = setTimeout(start, 900); // filet de sécurité réseau
    return () => clearTimeout(t);
  }, [landing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={onReady}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}
    >
      {/* base = couleur intermédiaire (= splash natif) → transition invisible */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      {/* couche thème par-dessus, révélée en fondu enchaîné */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      <Animated.Image
        source={require('../assets/logo.png')}
        resizeMode="contain"
        style={[styles.logo, { transform: [{ translateY: logoY }, { scale: logoScale }] }]}
      />
      <Animated.Text style={[styles.brand, { color: brandColor, opacity: brand, transform: [{ translateY: logoY }] }]}>
        Relyka
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', zIndex: 9999, elevation: 9999 },
  logo: { width: 96, height: 96 },
  brand: { marginTop: 18, fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
});
