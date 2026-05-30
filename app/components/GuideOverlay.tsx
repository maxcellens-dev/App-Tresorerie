/**
 * GuideOverlay — guide interactif en "bulles" dynamiques.
 * Pour chaque étape :
 *   1. scrolle automatiquement pour amener la zone cible à l'écran
 *   2. assombrit le reste de l'écran (spotlight sur la cible)
 *   3. affiche une bulle (tooltip) qui pointe vers la zone
 *
 * Chaque étape fournit `getRef()` → ref de la View cible.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  findNodeHandle, Platform, ScrollView, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SW, height: SH } = Dimensions.get('window');

export interface BubbleStep {
  /** Retourne la ref de la View à mettre en avant. */
  getRef: () => React.RefObject<any>;
  icon: string;
  iconColor: string;
  title: string;
  description: string;
}

interface Props {
  visible: boolean;
  steps: BubbleStep[];
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
  scrollRef?: React.RefObject<ScrollView | null>;
  screenTitle?: string;
}

interface Rect { x: number; y: number; w: number; h: number; }

const COLORS = {
  card: '#0f172a',
  border: '#1e293b',
  text: '#ffffff',
  sub: '#94a3b8',
  emerald: '#34d399',
};

const PAD = 8;             // marge autour du spotlight
const BUBBLE_H = 230;      // hauteur estimée de la bulle (pour décider au-dessus/en-dessous)
const TOP_SAFE = 70;       // zone haute réservée (header)

export default function GuideOverlay({
  visible, steps, currentStep, onNext, onSkip, scrollRef, screenTitle,
}: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [measuring, setMeasuring] = useState(true);
  const attemptRef = useRef(0);

  const step = steps[currentStep];

  useEffect(() => {
    if (!visible || !step) return;
    let cancelled = false;
    attemptRef.current += 1;
    const myAttempt = attemptRef.current;
    setMeasuring(true);
    setRect(null);

    const node = step.getRef()?.current;
    if (!node) {
      // Pas de cible → bulle centrée
      setMeasuring(false);
      return;
    }

    const measure = (retries = 0) => {
      if (cancelled || myAttempt !== attemptRef.current) return;
      if (typeof node.measureInWindow !== 'function') {
        setMeasuring(false);
        return;
      }
      node.measureInWindow((x: number, y: number, w: number, h: number) => {
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (w === 0 && h === 0 && retries < 5) {
          setTimeout(() => measure(retries + 1), 120);
          return;
        }
        setRect({ x, y, w, h });
        setMeasuring(false);
      });
    };

    // 1) Scroller pour rendre la cible visible (via measureLayout vs ScrollView)
    const scrollNode = scrollRef?.current ? findNodeHandle(scrollRef.current) : null;
    if (scrollNode && typeof node.measureLayout === 'function') {
      node.measureLayout(
        scrollNode,
        (_lx: number, ly: number, _lw: number, lh: number) => {
          if (cancelled || myAttempt !== attemptRef.current) return;
          // Positionner la cible vers le tiers haut de l'écran
          const targetY = Math.max(0, ly - SH * 0.28);
          scrollRef?.current?.scrollTo({ y: targetY, animated: true });
          setTimeout(() => measure(), 380);
        },
        () => measure(),
      );
    } else {
      measure();
    }

    return () => { cancelled = true; };
  }, [visible, currentStep, step]);

  if (!visible || !step) return null;

  const isLast = currentStep === steps.length - 1;

  // Spotlight rect (clampé à l'écran)
  const spot = rect
    ? {
        x: Math.max(0, rect.x - PAD),
        y: Math.max(0, rect.y - PAD),
        w: Math.min(SW, rect.w + PAD * 2),
        h: rect.h + PAD * 2,
      }
    : null;

  // Position de la bulle : sous la cible si la place le permet, sinon au-dessus
  let bubbleTop: number;
  let pointer: 'up' | 'down' | null = null;
  if (spot) {
    const spaceBelow = SH - (spot.y + spot.h);
    if (spaceBelow > BUBBLE_H + 40) {
      bubbleTop = spot.y + spot.h + 14;
      pointer = 'up';
    } else {
      bubbleTop = Math.max(TOP_SAFE, spot.y - BUBBLE_H - 14);
      pointer = 'down';
    }
  } else {
    bubbleTop = SH / 2 - BUBBLE_H / 2;
  }

  // Position horizontale de la flèche (centrée sur la cible)
  const arrowLeft = spot
    ? Math.min(SW - 48, Math.max(24, spot.x + spot.w / 2 - 8))
    : SW / 2 - 8;

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent>
    <View style={styles.fill} pointerEvents="box-none">
      {/* ── Overlay sombre avec trou (spotlight) ── */}
      {spot && !measuring ? (
        <>
          {/* Haut */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: 0, left: 0, right: 0, height: spot.y }]} />
          {/* Bas */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y + spot.h, left: 0, right: 0, bottom: 0 }]} />
          {/* Gauche */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y, left: 0, width: spot.x, height: spot.h }]} />
          {/* Droite */}
          <TouchableOpacity activeOpacity={1} onPress={onSkip}
            style={[styles.mask, { top: spot.y, left: spot.x + spot.w, right: 0, height: spot.h }]} />
          {/* Cadre lumineux autour de la cible */}
          <View pointerEvents="none" style={[styles.highlight, {
            top: spot.y, left: spot.x, width: spot.w, height: spot.h,
          }]} />
        </>
      ) : (
        // Pas de cible mesurée → overlay plein
        <TouchableOpacity activeOpacity={1} onPress={onSkip} style={[styles.mask, StyleSheet.absoluteFillObject]} />
      )}

      {/* ── Flèche pointeur ── */}
      {spot && !measuring && pointer && (
        <View
          pointerEvents="none"
          style={[
            styles.arrow,
            pointer === 'up'
              ? { top: bubbleTop - 8, left: arrowLeft, borderBottomColor: COLORS.card }
              : { top: bubbleTop + BUBBLE_H - 2, left: arrowLeft, borderTopColor: COLORS.card },
            pointer === 'up' ? styles.arrowUp : styles.arrowDown,
          ]}
        />
      )}

      {/* ── Bulle ── */}
      {!measuring && (
        <View style={[styles.bubble, { top: bubbleTop }]} pointerEvents="auto">
          {/* Header */}
          <View style={styles.bubbleHeader}>
            {screenTitle && <Text style={styles.screenTitle}>Guide — {screenTitle}</Text>}
            <TouchableOpacity onPress={onSkip} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.skip}>Passer</Text>
            </TouchableOpacity>
          </View>

          {/* Contenu */}
          <View style={styles.bubbleBody}>
            <View style={[styles.iconBox, { backgroundColor: step.iconColor + '22', borderColor: step.iconColor + '44' }]}>
              <Ionicons name={step.icon as any} size={26} color={step.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.desc}>{step.description}</Text>
            </View>
          </View>

          {/* Dots + bouton */}
          <View style={styles.bubbleFooter}>
            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View key={i} style={[
                  styles.dot,
                  i === currentStep && styles.dotActive,
                  i < currentStep && styles.dotDone,
                ]} />
              ))}
            </View>
            <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
              <Text style={styles.nextLabel}>{isLast ? 'Terminer' : 'Suivant'}</Text>
              <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={16} color="#020617" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  mask: { position: 'absolute', backgroundColor: 'rgba(2, 6, 23, 0.82)' },
  highlight: {
    position: 'absolute', borderRadius: 14,
    borderWidth: 2, borderColor: COLORS.emerald,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 0 0 9999px rgba(2,6,23,0.0), 0 0 24px rgba(52,211,153,0.5)' } as any
      : {}),
  },
  arrow: {
    position: 'absolute', width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  arrowUp: { borderBottomWidth: 8 },
  arrowDown: { borderTopWidth: 8 },
  bubble: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: COLORS.card, borderRadius: 18,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 18, gap: 14,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 12px 40px rgba(0,0,0,0.5)' } as any
      : { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
  },
  bubbleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenTitle: { fontSize: 12, color: COLORS.sub, fontWeight: '600' },
  skip: { fontSize: 13, color: COLORS.sub },
  bubbleBody: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  iconBox: {
    width: 52, height: 52, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  desc: { fontSize: 14, color: '#cbd5e1', lineHeight: 20 },
  bubbleFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: {
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  dotActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald, width: 18 },
  dotDone: { backgroundColor: '#1a3a2a', borderColor: COLORS.emerald },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.emerald, borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 18,
  },
  nextLabel: { fontSize: 14, fontWeight: '700', color: '#020617' },
});
