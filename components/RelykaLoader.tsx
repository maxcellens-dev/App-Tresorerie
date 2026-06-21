/**
 * RelykaLoader — loader « Relyka » : anneau lumineux rotatif (arc dégradé + halo) avec le mot
 * RELYKA au centre, chaque lettre qui pulse en vague décalée. Adaptation React Native du loader
 * CSS fourni (box-shadow inset / keyframes non supportés en RN → Animated + bordures + shadow).
 * Couleurs pilotées par le thème via les props `accent` / `textColor`.
 */
import { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, type ImageSourcePropType } from 'react-native';

interface Props {
  size?: number;
  accent: string;       // couleur d'accent du thème (anneau + halo)
  textColor: string;    // couleur du texte central
  text?: string;
  /** Logo affiché au centre à la place du texte (ex. logo du splash). */
  logo?: ImageSourcePropType;
}

export default function RelykaLoader({ size = 150, accent, textColor, text = 'Relyka', logo }: Props) {
  const letters = text.split('');
  const spin = useRef(new Animated.Value(0)).current;
  const letterVals = useRef(letters.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const s = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2200, easing: Easing.linear, useNativeDriver: true }),
    );
    s.start();
    // Chaque lettre boucle la même pulsation mais démarre avec un décalage → effet de vague.
    const ls = letterVals.map((v, i) =>
      Animated.sequence([
        Animated.delay(i * 130),
        Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true })),
      ]),
    );
    ls.forEach((a) => a.start());
    return () => { s.stop(); ls.forEach((a) => a.stop()); };
  }, [letterVals, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const border = Math.max(5, Math.round(size * 0.05));
  const fontSize = Math.round(size * 0.135);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Anneau rotatif : arc lumineux (haut/droite vifs, bas/gauche estompés) + halo coloré. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            borderWidth: border,
            borderColor: accent + '1F',
            borderTopColor: accent,
            borderRightColor: accent + 'AA',
            borderBottomColor: accent + '44',
            transform: [{ rotate }],
            shadowColor: accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.55,
            shadowRadius: 14,
            elevation: 8,
          },
        ]}
      />
      {/* Logo au centre (si fourni) — sinon RELYKA, lettres qui pulsent en vague. */}
      {logo ? (
        <Image source={logo} style={{ width: size * 0.46, height: size * 0.46, resizeMode: 'contain' }} />
      ) : (
      <View style={styles.row}>
        {letters.map((l, i) => {
          const v = letterVals[i];
          const opacity = v.interpolate({ inputRange: [0, 0.2, 0.4, 1], outputRange: [0.4, 1, 0.7, 0.4] });
          const scale = v.interpolate({ inputRange: [0, 0.2, 0.4, 1], outputRange: [1, 1.15, 1, 1] });
          return (
            <Animated.Text key={i} style={[styles.letter, { color: textColor, fontSize, opacity, transform: [{ scale }] }]}>
              {l}
            </Animated.Text>
          );
        })}
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  letter: { fontWeight: '800', letterSpacing: 0.5 },
});
