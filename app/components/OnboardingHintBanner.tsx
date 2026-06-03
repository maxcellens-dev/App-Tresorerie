/**
 * OnboardingHintBanner — coachmark affiché en haut d'un écran quand l'utilisateur y
 * arrive depuis une étape du guide "Pour bien démarrer" (param ?onb=<clé>).
 * Indique quoi faire ; se ferme d'un tap. Aucune obligation.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { ONBOARDING_HINTS, type OnboardingStepKey } from '../hooks/useOnboarding';

export default function OnboardingHintBanner() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const params = useLocalSearchParams<{ onb?: string }>();
  const key = params.onb as OnboardingStepKey | undefined;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(false); }, [key]);

  const meta = key ? ONBOARDING_HINTS[key] : undefined;
  if (!meta || dismissed) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Ionicons name="bulb" size={16} color={COLORS.bg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{meta.label}</Text>
          <Text style={styles.hint}>{meta.hint}</Text>
        </View>
        <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.close}>
          <Ionicons name="checkmark" size={16} color={COLORS.emerald} />
          <Text style={styles.closeText}>OK</Text>
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
    iconCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 13, fontWeight: '800', color: c.text },
    hint: { fontSize: 12, color: c.textSecondary, marginTop: 1, lineHeight: 16 },
    close: { alignItems: 'center', paddingLeft: 4 },
    closeText: { fontSize: 11, fontWeight: '700', color: c.emerald, marginTop: 1 },
  });
}
