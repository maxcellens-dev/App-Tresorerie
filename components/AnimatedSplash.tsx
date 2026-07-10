/**
 * AnimatedSplash — splash React animé (natif uniquement) qui prend le relais du splash natif.
 *
 * Objectif : l'utilisateur ne voit QUE le logo de l'app pendant tout le chargement, sans jonction
 * visible entre le splash natif et celui-ci.
 *  1. Première frame IDENTIQUE au splash natif : fond crème + logo (assets/logo.png, la même image)
 *     à 96 dp (= app.json > expo-splash-screen > imageWidth), centré à la MÊME position.
 *  2. Le splash natif s'efface en fondu par-dessus (SplashScreen.setOptions({ fade }) dans
 *     app/_layout.tsx) → jonction invisible puisque les deux calques sont identiques.
 *  3. Fond enchaîné vers le thème ADMIN (clair = crème, sombre = teal) quand il est connu.
 *  4. Sortie quand la page de destination est prête : fondu du calque + glissement du logo vers le
 *     haut (animation conservée de la version précédente).
 *
 * ► Centrage — le piège qui a fait échouer les tentatives passées : le splash natif centre son
 *   image dans l'ÉCRAN PHYSIQUE entier, alors que la fenêtre de l'app (où vit ce calque) commence
 *   derrière la barre d'état translucide mais S'ARRÊTE AU-DESSUS de la barre de navigation. Un logo
 *   centré « flex » dans la fenêtre est donc plus haut que le natif d'une demi-barre de navigation
 *   (~24 dp, visible). On positionne donc le logo en absolu à `screen.height / 2` — le haut de la
 *   fenêtre coïncidant avec le haut de l'écran, les deux repères sont alignés.
 *
 * Version précédente (anneau RelykaLoader) : components/AnimatedSplash.legacy.tsx (pour revert).
 */
import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Easing, Image, Dimensions } from 'react-native';
import { getCachedAdminTheme } from '../lib/themeBoot';
import { useLandingConfig } from '../hooks/useLandingConfig';
import { useBrandColors } from '../hooks/useBrandColors';
import { onAppReady } from '../lib/splashGate';

// Fond du splash : crème, identique au fond du splash natif.
// Doit correspondre à app.json > expo-splash-screen > backgroundColor (transition invisible).
const SPLASH_BG = '#F4EFE6';
const BG_LIGHT = '#F4EFE6';
const BG_DARK = '#0D2E2A';
/** Taille d'affichage du logo = app.json > expo-splash-screen > imageWidth (image carrée 512×512). */
const LOGO = 96;

export default function AnimatedSplash({ onReady, onDone }: { onReady?: () => void; onDone: () => void }) {
  const { data: landing } = useLandingConfig();
  const COLORS = useBrandColors();
  const isLight = COLORS.mode === 'light';
  const themeKnown = landing !== undefined || getCachedAdminTheme() !== null;
  const themeBg = isLight ? BG_LIGHT : BG_DARK;

  const bgFade = useRef(new Animated.Value(0)).current;   // fondu fond crème → thème
  const contentY = useRef(new Animated.Value(0)).current; // glissement du logo vers le haut (sortie)
  const overlay = useRef(new Animated.Value(1)).current;  // fondu de sortie du calque
  const [gone, setGone] = useState(false);
  const [winH, setWinH] = useState<number | null>(null);  // hauteur réelle du calque (mesurée)
  const outRef = useRef(false);

  // Centre de l'écran physique (voir ► Centrage dans l'en-tête). Pas d'animation d'entrée : le logo
  // doit être là, au bon endroit, dès la première frame — c'est lui qui « est » le splash natif.
  // Cas dégradé (écran partagé, fenêtre flottante) : la fenêtre ne couvre plus l'écran, et le splash
  // natif se centre alors dans les bornes de l'APP → on se rabat sur le centre de la fenêtre.
  const screenH = Dimensions.get('screen').height;
  const isFullScreenish = winH == null || screenH - winH < 160; // 160 dp > toute barre système
  const logoTop = (isFullScreenish ? screenH : winH) / 2 - LOGO / 2;

  // Crossfade du fond crème vers le vrai thème, UNIQUEMENT quand il est connu (pas de pop).
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
      // Sortie = fondu + glissement du logo vers le haut (effet d'apparition de la page dessous).
      Animated.parallel([
        Animated.timing(overlay, { toValue: 0, duration: 340, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        Animated.timing(contentY, { toValue: -64, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) { setGone(true); onDone(); } });
    };
    // Petit délai (100 ms) APRÈS le signal « prêt » : laisse la page de destination finir de se
    // peindre avant de révéler → pas de flash de page à moitié rendue.
    const unsub = onAppReady(() => { delayTimer = setTimeout(fadeOut, 100); });
    const cap = setTimeout(fadeOut, 8000);
    return () => { unsub(); clearTimeout(cap); clearTimeout(delayTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => { setWinH(e.nativeEvent.layout.height); onReady?.(); }}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}
    >
      {/* Fonds : plein écran (sous les barres système) */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      {/* Logo : même image, même taille, même position que le splash natif. */}
      <Animated.View style={[styles.logoWrap, { top: logoTop, transform: [{ translateY: contentY }] }]}>
        <Image source={require('../assets/logo.png')} style={{ width: LOGO, height: LOGO }} resizeMode="contain" fadeDuration={0} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  logoWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
