/**
 * POULS — une carte de signal (l'unité de base du Pouls hebdo ET de l'état des lieux).
 * Présentation PURE : elle affiche ce que le moteur a jugé, rien d'autre.
 * Le Pouls est un ÉTAT — aucune action, aucun bouton : le reste de l'app sert à agir.
 *
 * Couleurs : uniquement des clés SÉMANTIQUES du thème (green / orange / danger / blue / grey) —
 * elles suivent donc le Style Editor, comme le reste de l'app.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { PULSE_STATUS_COLOR_KEY, type PulseSignal } from '../lib/pulseEngine';

export function pulseColor(COLORS: AppColors, status: PulseSignal['status']): string {
  return COLORS[PULSE_STATUS_COLOR_KEY[status]] ?? COLORS.textSecondary;
}

interface Props {
  signal: PulseSignal;
  /** Animation d'entrée décalée (le bilan se « remplit » sous les yeux). */
  delay?: number;
}

export default function PulseSignalCard({ signal, delay = 0 }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const color = pulseColor(COLORS, signal.status);

  // Entrée : fondu + léger glissement, puis remplissage de la barre (c'est ce mouvement qui donne
  // envie de « tout faire passer au vert »).
  const enter = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const target = Math.max(0, Math.min(1, signal.progress?.value ?? 0));

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(enter, { toValue: 1, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(fill, { toValue: target, duration: 850, delay: 120, useNativeDriver: false, easing: Easing.out(Easing.cubic) }),
      ]),
    ]).start();
  }, [delay, target, enter, fill]);

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
      <View style={styles.head}>
        <Text style={styles.label} numberOfLines={1}>
          {signal.emoji}  {signal.label}
        </Text>
        <View style={[styles.chip, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
          <Text style={[styles.chipText, { color }]} numberOfLines={1}>{signal.chip}</Text>
        </View>
      </View>

      <Text style={styles.headline}>{signal.headline}</Text>
      {!!signal.detail && <Text style={styles.detail}>{signal.detail}</Text>}

      {signal.progress && (() => {
        // Trait de seuil (ex. « bon rythme » = X % de la capacité) : affiché avec son % en dessous,
        // pour que le repère soit lisible sans deviner ce qu'il marque.
        const tickPct = signal.progress.target != null && signal.progress.target < 1 ? signal.progress.target : null;
        return (
          <View style={[styles.track, tickPct != null && styles.trackWithTickLabel]}>
            <Animated.View
              style={[
                styles.fill,
                {
                  backgroundColor: color,
                  width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                },
              ]}
            />
            {tickPct != null && (
              <>
                <View style={[styles.tick, { left: `${tickPct * 100}%` }]} />
                <Text style={[styles.tickLabel, { left: `${tickPct * 100}%` }]}>{Math.round(tickPct * 100)} %</Text>
              </>
            )}
          </View>
        );
      })()}

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
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
    label: { flex: 1, fontSize: 13, fontWeight: '700', color: c.text },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, maxWidth: 150 },
    chipText: { fontSize: 10.5, fontWeight: '800' },
    headline: { fontSize: 16, fontWeight: '800', color: c.text, letterSpacing: -0.2, lineHeight: 22 },
    detail: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 6 },
    track: {
      height: 6, borderRadius: 999, backgroundColor: c.cardBorder,
      marginTop: 12, overflow: 'visible', position: 'relative',
    },
    fill: { height: 6, borderRadius: 999 },
    tick: { position: 'absolute', top: -3, width: 2, height: 12, borderRadius: 2, backgroundColor: c.textSecondary },
    // Le % du seuil, centré sous son trait. La piste réserve la place en dessous (marge) pour que
    // le label ne chevauche pas la ligne de total qui suit.
    trackWithTickLabel: { marginBottom: 16 },
    tickLabel: { position: 'absolute', top: 11, width: 44, marginLeft: -22, textAlign: 'center', fontSize: 10, fontWeight: '700', color: c.textSecondary },
    amount: { fontSize: 11.5, color: c.textSecondary, marginTop: 10, fontWeight: '600' },
  });
}
