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
import { getCachedAdminTheme } from '../../lib/platform/themeBoot';
import { useLandingConfig } from '../../hooks/config/useLandingConfig';
import { useBrandColors } from '../../hooks/theme/useBrandColors';
import { onAppReady } from '../../lib/platform/splashGate';

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
  const rootRef = useRef<View>(null);
  const readySent = useRef(false);

  // Ne masquer le splash NATIF que quand la fenêtre est STABILISÉE. Au démarrage, KeyboardProvider
  // (react-native-keyboard-controller) bascule la fenêtre en edge-to-edge : pendant quelques frames
  // le contenu est décalé sous la barre d'état (bande blanche + logo plus bas), puis se recale à
  // y = 0. Ce décalage arrive APRÈS le premier onLayout : une mesure unique passait AVANT lui et
  // exposait le blip. On exige donc une STABILITÉ CONTINUE — y ≈ 0 pendant STABLE_MS d'affilée —
  // avant d'effacer le natif (opaque, il couvre toute la bascule). Plafond dur en garde-fou.
  const sendReadyWhenSettled = () => {
    if (readySent.current) return;
    const STABLE_MS = 300;   // durée d'immobilité exigée (la bascule dure quelques frames)
    const STEP_MS = 50;
    const CAP_MS = 1500;     // ne jamais bloquer le boot (+ filet 4 s dans app/_layout)
    const started = Date.now();
    let stableFor = 0;
    const done = () => { readySent.current = true; onReady?.(); };
    const check = () => {
      if (readySent.current) return;
      if (Date.now() - started > CAP_MS) { done(); return; }
      if (!rootRef.current) { done(); return; }
      rootRef.current.measureInWindow((_x, y) => {
        if (readySent.current) return;
        stableFor = Math.abs(y ?? 0) < 1 ? stableFor + STEP_MS : 0;
        if (stableFor >= STABLE_MS) done();
        else setTimeout(check, STEP_MS);
      });
    };
    check();
  };

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
    // Filet : ne jamais garder le splash au-delà de 3,5 s même sans signal (Pilotage signale déjà
    // « prêt » sous 900 ms max). Évite un splash bloqué hors-ligne.
    const cap = setTimeout(fadeOut, 3500);
    return () => { unsub(); clearTimeout(cap); clearTimeout(delayTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;

  return (
    <Animated.View
      ref={rootRef}
      pointerEvents="none"
      onLayout={(e) => { setWinH(e.nativeEvent.layout.height); sendReadyWhenSettled(); }}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: overlay }]}
    >
      {/* Fonds : plein écran (sous les barres système) */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BG }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: themeBg, opacity: bgFade }]} />
      {/* Logo : même image, même taille, même position que le splash natif. */}
      <Animated.View style={[styles.logoWrap, { top: logoTop, transform: [{ translateY: contentY }] }]}>
        <Image source={require('../../assets/logo.png')} style={{ width: LOGO, height: LOGO }} resizeMode="contain" fadeDuration={0} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 9999, elevation: 9999 },
  logoWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
