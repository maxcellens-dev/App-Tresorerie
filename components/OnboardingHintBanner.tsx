/**
 * OnboardingHintBanner — coachmark interactif du guide « Pour bien démarrer ».
 * Affiché en bas d'un écran quand on y arrive depuis une étape (param ?onb=<clé>).
 * - Tant que l'étape n'est pas faite : explique quoi faire (fermable, non bloquant).
 * - Dès que l'étape est accomplie : confirme. « Suivant » ferme le coachmark et ouvre la
 *   checklist « Pour bien démarrer » (vue d'ensemble simple des prochaines étapes).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, PanResponder, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useOnboarding, type OnboardingStepKey } from '../hooks/useOnboarding';
import { openOnboardingChecklist } from '../lib/onboardingChecklist';

export default function OnboardingHintBanner() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const ob = useOnboarding(user?.id);
  const params = useLocalSearchParams<{ onb?: string }>();
  const key = params.onb as OnboardingStepKey | undefined;
  const [dismissed, setDismissed] = useState(false);

  const idx = key ? ob.steps.findIndex((s) => s.key === key) : -1;
  const step = idx >= 0 ? ob.steps[idx] : null;
  const next = step
    ? (ob.steps.slice(idx + 1).find((s) => !s.done) ?? ob.steps.find((s) => !s.done && s.key !== key) ?? null)
    : null;

  // Fermer = masquer le coachmark ET retirer la surbrillance (on efface le param ?onb).
  const dismissRef = useRef(() => {});
  dismissRef.current = () => { setDismissed(true); router.setParams({ onb: '' as any }); };
  const dismiss = () => dismissRef.current();

  // « Suivant » : ferme le coachmark puis ouvre la checklist « Pour bien démarrer ».
  const openChecklist = () => { dismiss(); openOnboardingChecklist(); };

  // Swipe horizontal pour fermer.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => { if (Math.abs(g.dx) > 60) dismissRef.current(); },
    })
  ).current;

  useEffect(() => { setDismissed(false); }, [key]);

  if (!key || dismissed || ob.dismissed || !step) return null;

  // ── Étape accomplie : confirmation + accès à la checklist (toucher ailleurs = fermer) ──
  if (step.done) {
    return (
      <View style={StyleSheet.absoluteFill as any} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        <View style={styles.wrap}>
          <View style={[styles.card, { borderColor: COLORS.green + '66' }]} {...pan.panHandlers}>
            <View style={[styles.iconCircle, { backgroundColor: COLORS.green }]}>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Étape validée : {step.label}</Text>
              {next
                ? <Text style={styles.hint}>Prochaine étape : {next.label}</Text>
                : <Text style={styles.hint}>🎉 Bravo, vous avez terminé le guide !</Text>}
            </View>
            {next ? (
              <TouchableOpacity style={styles.nextBtn} onPress={openChecklist} activeOpacity={0.85}>
                <Text style={styles.nextBtnText}>Suivant</Text>
                <Ionicons name="arrow-forward" size={14} color={COLORS.bg} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
                <Ionicons name="close" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  // ── Étape à réaliser : indication (non bloquant) ──
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card} {...pan.panHandlers}>
        <View style={[styles.iconCircle, { backgroundColor: COLORS.emerald }]}>
          <Ionicons name="bulb" size={16} color={COLORS.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.step}>Étape {idx + 1}/{ob.total}</Text>
          <Text style={styles.title}>{step.label}</Text>
          <Text style={styles.hint}>{step.hint}</Text>
        </View>
        <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
          <Ionicons name="close" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { position: 'absolute', bottom: Platform.OS === 'web' ? 90 : 86, left: 12, right: 12, zIndex: 60 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.emerald + '66',
      borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
      // Web : les props shadow* ne s'appliquent pas → la carte (blanche) se fond dans le fond clair.
      // On utilise boxShadow sur web (séparation nette), shadow*/elevation sur natif.
      ...(Platform.OS === 'web'
        ? { boxShadow: '0 8px 28px rgba(0,0,0,0.18)' } as any
        : { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6 }),
    },
    iconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    step: { fontSize: 10, fontWeight: '800', color: c.emerald, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 1 },
    title: { fontSize: 13, fontWeight: '800', color: c.text },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 1, lineHeight: 16 },
    nextBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    nextBtnText: { fontSize: 12, fontWeight: '800', color: c.bg },
    close: { padding: 4 },
  });
}
