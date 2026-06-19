/**
 * ConseilsBanner — UN seul conseil visible à la fois, en haut du Pilotage.
 * Ordre : "Pour vous" (contextuel) d'abord, puis général. Rotation auto toutes les 5 s
 * s'il y a 2 conseils. Croix → fermé pour la journée.
 */
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useConseilDuJour, interpolate } from '../hooks/useConseils';
import type { PilotageData } from '../hooks/usePilotageData';

interface Props {
  userId?: string;
  pilotage?: PilotageData;
  transactions?: any[];
  projects?: any[];
  accounts?: any[];
}

interface Slide { id: string; label: string; icon: string; iconColor: string; text: string }

export default function ConseilsBanner({ userId, pilotage, transactions = [], projects = [], accounts = [] }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { general, contextuel, dismiss } = useConseilDuJour(userId, pilotage, transactions, projects, accounts);

  // Liste ordonnée : "Pour vous" puis général.
  const slides: Slide[] = [];
  if (contextuel) slides.push({ id: contextuel.id, label: 'Pour vous', icon: 'person-circle-outline', iconColor: COLORS.violet, text: interpolate(contextuel.message, contextuel.vars) });
  if (general) slides.push({ id: general.id, label: 'Le saviez-vous', icon: 'bulb-outline', iconColor: COLORS.yellow, text: general.message });
  const slidesLen = slides.length;

  // ── Tous les hooks AVANT tout return conditionnel ──
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const slideX = useRef(new Animated.Value(0)).current;

  const currentId = slides[Math.min(index, Math.max(0, slidesLen - 1))]?.id;

  // Actions (plain closures recréées à chaque render, exposées via ref pour le PanResponder).
  const doDismiss = () => {
    Animated.timing(slideX, { toValue: -500, duration: 220, useNativeDriver: true }).start(() => {
      slideX.setValue(0);
      if (currentId) dismiss(currentId);
    });
  };
  const doNext = () => {
    if (slidesLen < 2) return;
    Animated.timing(fade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setIndex((i) => (i + 1) % slidesLen);
      Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    });
  };
  const apiRef = useRef({ len: slidesLen, doDismiss, doNext });
  apiRef.current = { len: slidesLen, doDismiss, doNext };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => {
        // Swiper ne ferme JAMAIS : ça passe simplement à l'autre conseil du jour (en boucle).
        // S'il n'en reste qu'un (l'autre a été fermé), doNext est sans effet → il revient seul.
        if (Math.abs(g.dx) > 60) apiRef.current.doNext();
      },
    })
  ).current;

  // Garde l'index dans les bornes si la liste change.
  useEffect(() => {
    if (index >= slidesLen && slidesLen > 0) setIndex(0);
  }, [slidesLen, index]);

  // Rotation auto toutes les 5 s (seulement si 2 conseils).
  useEffect(() => {
    if (slidesLen < 2) return;
    const t = setInterval(() => apiRef.current.doNext(), 8000);
    return () => clearInterval(t);
  }, [slidesLen]);

  if (slidesLen === 0) return null;
  const current = slides[Math.min(index, slidesLen - 1)];

  return (
    <Animated.View style={[styles.card, { opacity: fade, transform: [{ translateX: slideX }] }]} {...pan.panHandlers}>
      <View style={styles.labelRow}>
        <Ionicons name={current.icon as any} size={14} color={current.iconColor} />
        <Text style={[styles.label, { color: current.iconColor }]}>{current.label}</Text>
        {slidesLen > 1 && (
          <View style={styles.dots}>
            {slides.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && { backgroundColor: current.iconColor }]} />
            ))}
          </View>
        )}
      </View>
      <Text style={styles.text}>{current.text}</Text>
      <TouchableOpacity style={styles.closeBtn} onPress={() => apiRef.current.doDismiss()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 13, paddingRight: 32, marginBottom: 10 },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
    label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    dots: { flexDirection: 'row', gap: 4, marginLeft: 6 },
    dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.cardBorder },
    text: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18 },
    closeBtn: { position: 'absolute', top: 10, right: 10, padding: 2 },
  });
}
