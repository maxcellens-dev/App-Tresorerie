/**
 * POULS — l'indicateur du Pilotage. Purement GRAPHIQUE : une pastille par signal jugé, dans la
 * couleur de son état. Pas de libellé (« au vert ») : la couleur dit déjà tout.
 *
 * Il vit DANS la pilule du mois du « Suivi du mois » (« Juillet 2026 🫀 ●●●● ») — pas de bouton de
 * plus dans un écran déjà dense. Au tap : ouvre le Pouls de la semaine.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { usePulse } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { openPulse } from './PulseHost';
import { pulseColor } from './PulseSignalCard';

/**
 * Le cœur + les pastilles, sans habillage — à poser dans un conteneur existant (la pilule du mois).
 * Renvoie `null` tant qu'il n'y a rien à juger : le conteneur reste alors intact.
 */
export function PulseDots() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: config } = usePulseConfig();
  const pulse = usePulse();

  // Battement lent, UNIQUEMENT quand un signal demande de l'attention (sinon rien ne bouge).
  const beat = useRef(new Animated.Value(0)).current;
  const needsAttention = pulse?.result.worst === 'watch' || pulse?.result.worst === 'alert';

  useEffect(() => {
    if (!needsAttention) { beat.stopAnimation(); beat.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
        Animated.timing(beat, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.quad) }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [needsAttention, beat]);

  if (!config?.enabled || !pulse) return null;
  const judged = pulse.result.signals.filter((s) => s.status !== 'neutral');
  if (judged.length === 0) return null;

  return (
    <View style={styles.inline}>
      <Animated.Text
        style={[styles.heart, { transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }]}
      >
        🧭
      </Animated.Text>
      {judged.slice(0, 5).map((signal) => (
        <View key={signal.id} style={[styles.dot, { backgroundColor: pulseColor(COLORS, signal.status) }]} />
      ))}
    </View>
  );
}

/** Variante autonome (pastille cliquable isolée), pour les écrans sans pilule de mois. */
export default function PulseChip() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const pulse = usePulse();
  if (!pulse) return null;

  return (
    <TouchableOpacity
      style={styles.chip}
      onPress={() => openPulse('now')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Mon pouls : ${pulse.result.greenCount} signaux au vert sur ${pulse.result.judgedCount}`}
    >
      <PulseDots />
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    chip: {
      paddingVertical: 5, paddingHorizontal: 10,
      borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    },
    heart: { fontSize: 13, marginRight: 2 },
    dot: { width: 7, height: 7, borderRadius: 999 },
  });
}
