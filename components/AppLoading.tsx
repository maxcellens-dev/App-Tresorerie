/**
 * AppLoading — écran de chargement animé affiché pendant la résolution de la session / du profil.
 * Écran PRÉ-AUTH : suit le thème admin global (app_config.landing.theme), comme la vitrine /
 * la page de connexion — jamais le choix de l'utilisateur. Sombre par défaut tant que la config
 * n'est pas chargée (1ère requête).
 */
import { useEffect, useRef } from 'react';
import { View, Image, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useLandingConfig } from '../hooks/useLandingConfig';
import { getCachedAdminTheme } from '../lib/themeBoot';

const ACCENT = '#00B67A';
// Fond sombre : accordé au splash natif (#0D2E2A) pour une transition invisible.
const BG_DARK = '#0D2E2A';
// Fond clair : crème chaud (identique au DEFAULT_BG light de la palette).
const BG_LIGHT = '#F4EFE6';

export default function AppLoading() {
  const { data: landing } = useLandingConfig();
  // Avant la réponse réseau : dernier thème admin connu (localStorage web) → pas de flash sombre.
  const mode = landing?.theme ?? getCachedAdminTheme() ?? 'dark';

  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const s = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    p.start();
    s.start();
    return () => { p.stop(); s.stop(); };
  }, [pulse, spin]);

  const isLight = mode === 'light';
  const bg = isLight ? BG_LIGHT : BG_DARK;
  const textColor = isLight ? '#191C1F' : '#FFFFFF';

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <Animated.View style={{ transform: [{ scale }], opacity, marginBottom: 22 }}>
        <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      </Animated.View>
      <Text style={[styles.brand, { color: textColor }]}>Relyka</Text>
      <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 96, height: 96 },
  brand: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 26 },
  ring: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: ACCENT + '33', borderTopColor: ACCENT },
});
