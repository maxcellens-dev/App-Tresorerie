/**
 * OnboardingHintBanner — coachmark interactif du guide « Pour bien démarrer ».
 * Affiché en haut d'un écran quand on y arrive depuis une étape (param ?onb=<clé>).
 * - Tant que l'étape n'est pas faite : explique quoi faire (fermable, non bloquant).
 * - Dès que l'étape est accomplie : confirme et propose d'enchaîner l'étape suivante.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useOnboarding, type OnboardingStepKey } from '../hooks/useOnboarding';

export default function OnboardingHintBanner() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const ob = useOnboarding(user?.id);
  const params = useLocalSearchParams<{ onb?: string }>();
  const key = params.onb as OnboardingStepKey | undefined;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(false); }, [key]);

  if (!key || dismissed || ob.dismissed) return null;
  const idx = ob.steps.findIndex((s) => s.key === key);
  if (idx === -1) return null;
  const step = ob.steps[idx];
  // Étape suivante non faite : d'abord après la courante, sinon la première restante.
  const next =
    ob.steps.slice(idx + 1).find((s) => !s.done) ??
    ob.steps.find((s) => !s.done && s.key !== key) ??
    null;

  const goToNext = () => {
    if (!next) return;
    setDismissed(true);
    if (next.route === step.route) router.setParams({ onb: next.key });
    else router.replace((next.route + '?onb=' + next.key) as any);
  };

  // ── Étape accomplie : confirmation + enchaînement ──
  if (step.done) {
    return (
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.card, { borderColor: COLORS.green + '66' }]}>
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
            <TouchableOpacity style={styles.nextBtn} onPress={goToNext} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>Suivant</Text>
              <Ionicons name="arrow-forward" size={14} color={COLORS.bg} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
              <Ionicons name="close" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── Étape à réaliser : indication ──
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={[styles.iconCircle, { backgroundColor: COLORS.emerald }]}>
          <Ionicons name="bulb" size={16} color={COLORS.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.step}>Étape {idx + 1}/{ob.total}</Text>
          <Text style={styles.title}>{step.label}</Text>
          <Text style={styles.hint}>{step.hint}</Text>
        </View>
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
          <Ionicons name="close" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { position: 'absolute', top: Platform.OS === 'web' ? 8 : 6, left: 12, right: 12, zIndex: 60 },
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.emerald + '66',
      borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
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
