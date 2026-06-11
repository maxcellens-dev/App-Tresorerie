/**
 * AppLoading — écran de chargement animé (logo Relyka qui pulse) affiché pendant
 * la résolution de la session / du profil. Couleurs fixes (le thème n'est pas encore prêt),
 * accordées au splash natif et au boot-loader HTML web pour une transition invisible.
 */
import { useEffect, useRef } from 'react';
import { View, Image, Text, StyleSheet, Animated, Easing } from 'react-native';

const BG = '#020617';
const ACCENT = '#00B67A';

export default function AppLoading() {
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

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      <Animated.View style={{ transform: [{ scale }], opacity, marginBottom: 22 }}>
        <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      </Animated.View>
      <Text style={styles.brand}>Relyka</Text>
      <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 84, height: 84, borderRadius: 18 },
  brand: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.5, marginBottom: 26 },
  ring: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: ACCENT + '33', borderTopColor: ACCENT },
});
