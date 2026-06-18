/**
 * Composant guide "première visite"
 * Affiche une bottom sheet animée avec les étapes du guide, une par une.
 * Reproposé si non terminé lors des sessions suivantes.
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Animated, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface GuideStep {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  locationHint?: string;
}

interface Props {
  visible: boolean;
  steps: GuideStep[];
  currentStep: number;
  onNext: () => void;
  onSkip: () => void;
  screenTitle?: string;
}


export default function OnboardingGuide({
  visible, steps, currentStep, onNext, onSkip, screenTitle,
}: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  // Animate step change
  useEffect(() => {
    cardAnim.setValue(30);
    Animated.spring(cardAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }).start();
  }, [currentStep]);

  if (!visible) return null;

  const step = steps[currentStep];
  if (!step) return null;
  const isLast = currentStep === steps.length - 1;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
      {/* Overlay semi-transparent */}
      <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
        <TouchableOpacity style={styles.overlayTap} onPress={onSkip} activeOpacity={1} />
      </Animated.View>

      {/* Bottom sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>

        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          {screenTitle && <Text style={styles.screenTitle}>Guide — {screenTitle}</Text>}
          <TouchableOpacity onPress={onSkip} style={styles.skipBtn}>
            <Text style={styles.skipLabel}>Passer</Text>
          </TouchableOpacity>
        </View>

        {/* Step dots */}
        <View style={styles.dots}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === currentStep && styles.dotActive, i < currentStep && styles.dotDone]}
            />
          ))}
        </View>

        {/* Step content */}
        <Animated.View style={[styles.stepContent, { transform: [{ translateY: cardAnim }] }]}>
          {/* Icon */}
          <View style={[styles.iconBox, { backgroundColor: step.iconColor + '20', borderColor: step.iconColor + '40' }]}>
            <Ionicons name={step.icon as any} size={36} color={step.iconColor} />
          </View>

          {/* Text */}
          <Text style={styles.stepTitle}>{step.title}</Text>
          <Text style={styles.stepDesc}>{step.description}</Text>

          {/* Location hint */}
          {step.locationHint && (
            <View style={styles.hintRow}>
              <Ionicons name="location-outline" size={14} color={COLORS.sub} />
              <Text style={styles.hintText}>{step.locationHint}</Text>
            </View>
          )}
        </Animated.View>

        {/* Buttons */}
        <View style={styles.footer}>
          <Text style={styles.stepCounter}>{currentStep + 1} / {steps.length}</Text>
          <TouchableOpacity style={styles.nextBtn} onPress={onNext}>
            <Text style={styles.nextLabel}>{isLast ? 'Terminer' : 'Suivant'}</Text>
            <Ionicons name={isLast ? 'checkmark-circle' : 'arrow-forward'} size={18} color={COLORS.bg} />
          </TouchableOpacity>
        </View>

      </Animated.View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
  },
  overlayTap: { flex: 1 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: c.cardSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: c.border,
    paddingBottom: 40,
    paddingHorizontal: 24,
    paddingTop: 16,
    minHeight: 360,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.cardBorder, alignSelf: 'center', marginBottom: 12,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  screenTitle: { fontSize: 13, color: c.sub, fontWeight: '600' },
  skipBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  skipLabel: { fontSize: 13, color: c.sub },

  dots: { flexDirection: 'row', gap: 6, marginBottom: 24, justifyContent: 'center' },
  dot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: c.cardBorder,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  dotActive: { backgroundColor: c.emerald, borderColor: c.emerald, width: 20 },
  dotDone: { backgroundColor: '#1a3a2a', borderColor: c.emerald },

  stepContent: { alignItems: 'center', gap: 12, marginBottom: 28 },
  iconBox: {
    width: 80, height: 80, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 4,
  },
  stepTitle: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
  stepDesc: { fontSize: 15, color: '#cbd5e1', textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  hintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.cardBorder, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  hintText: { fontSize: 12, color: c.sub, fontWeight: '500' },

  footer: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepCounter: { fontSize: 13, color: c.sub, fontWeight: '600' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.emerald, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 24,
  },
  nextLabel: { fontSize: 15, fontWeight: '700', color: c.bg },
});
}
