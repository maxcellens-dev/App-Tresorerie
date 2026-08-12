/**
 * ÉTAT DES LIEUX — une carte de signal (l'unité de base du bilan).
 * Présentation PURE : elle affiche le constat, rien d'autre.
 *
 * ⚠️ AUCUNE COULEUR D'ÉTAT. Il n'y a plus ni statut, ni pastille « Bien parti / Trop juste », ni
 * vert/orange/rouge : le bilan donne une vision d'un mois, il ne distribue pas de bons points.
 * La seule couleur est l'accent de l'app, sur la barre de progression — un remplissage, pas un
 * jugement. C'est un ÉTAT : aucune action, aucun bouton, le reste de l'app sert à agir.
 */
import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';
import type { AppColors } from '../../theme/palette';
import type { PulseSignal } from '../../lib/pulse/pulseEngine';

interface Props {
  signal: PulseSignal;
  /** Animation d'entrée décalée (le bilan se « remplit » sous les yeux). */
  delay?: number;
}

export default function PulseSignalCard({ signal, delay = 0 }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  // Entrée : fondu + léger glissement, puis remplissage de la barre.
  const enter = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(1, signal.progress ?? 0));

  // Entrée : UNE SEULE FOIS, au montage. (Avant, cet effet dépendait aussi de `target` : chaque
  // arrivée de données REJOUAIT l'animation d'entrée → clignotement de la carte.)
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(enter, { toValue: 1, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remplissage de la barre : glisse vers la nouvelle cible à chaque changement, au lieu de sauter.
  useEffect(() => {
    Animated.timing(fill, { toValue: target, duration: 650, useNativeDriver: false, easing: Easing.out(Easing.cubic) }).start();
  }, [target, fill]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <Text style={styles.label} numberOfLines={1}>
        {signal.emoji}  {signal.label}
      </Text>

      <Text style={styles.headline}>{signal.headline}</Text>
      {!!signal.detail && <Text style={styles.detail}>{signal.detail}</Text>}

      {signal.progress != null && (
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              {
                backgroundColor: COLORS.accent,
                width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              },
            ]}
          />
        </View>
      )}

      {!!signal.amountLine && <Text style={styles.amount}>{signal.amountLine}</Text>}
    </Animated.View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderRadius: 18,
      padding: 16,
      marginBottom: 10,
    },
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 8 },
    headline: { fontSize: 16, fontWeight: '800', color: c.text, letterSpacing: -0.2, lineHeight: 22 },
    detail: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 6 },
    track: { height: 6, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 12, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 999 },
    amount: { fontSize: 11.5, color: c.textSecondary, marginTop: 10, fontWeight: '600' },
  });
}
