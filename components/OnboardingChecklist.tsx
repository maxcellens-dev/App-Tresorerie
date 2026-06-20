/**
 * OnboardingChecklist — badge "Pour bien démarrer" (header, à gauche du profil) + modale checklist.
 * - Le badge affiche l'avancement (x/total) et disparaît une fois tout validé ou le guide refusé.
 * - Chaque étape est cliquable → navigue vers l'écran concerné avec un indice (param ?onb=).
 * - L'utilisateur peut refuser le guide ("Passer le guide").
 */
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useOnboarding, type OnboardingStep } from '../hooks/useOnboarding';
import { useTour } from '../contexts/TourContext';
import { subscribeOpenChecklist } from '../lib/onboardingChecklist';

export default function OnboardingChecklist() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const ob = useOnboarding(user?.id);
  const tour = useTour();
  const [open, setOpen] = useState(false);
  const autoOpened = useRef(false);

  // Ouverture déclenchée depuis l'extérieur (ex. « Suivant » du coachmark d'étape validée).
  useEffect(() => subscribeOpenChecklist(() => setOpen(true)), []);

  // Après le tour, on n'ouvre plus la checklist automatiquement : le bouton « Commencer »
  // du message de fin envoie directement sur la 1re étape (coachmark). On marque juste l'intro.
  useEffect(() => {
    if (isImpersonating) return; // consultation admin : pas d'écriture sur le compte cible
    if (ob.shouldAutoOpenChecklist && !tour.finished && !autoOpened.current) {
      autoOpened.current = true;
      ob.markFlag('checklist_intro_shown');
    }
  }, [ob.shouldAutoOpenChecklist, tour.finished, isImpersonating]);

  // Fige les étapes accomplies (validées pour toujours, même si l'élément créé est supprimé).
  useEffect(() => {
    if (isImpersonating) return; // consultation admin : ne pas figer/valider les étapes du compte cible
    if (ob.pendingPersist.length) ob.persistDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ob.pendingPersist.join(','), isImpersonating]);

  // En consultation admin : pas de badge « Pour bien démarrer » (élément lié à l'utilisateur).
  if (isImpersonating) return null;
  if (!ob.badgeVisible) return null;

  const goToStep = (step: OnboardingStep) => {
    if (step.done) return;
    setOpen(false);
    router.push((step.route + '?onb=' + step.key) as any);
  };

  return (
    <>
      <TouchableOpacity style={styles.badge} onPress={() => setOpen(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Guide de démarrage">
        <Ionicons name="rocket-outline" size={18} color={COLORS.emerald} />
        <View style={styles.badgeCount}>
          <Text style={styles.badgeCountText}>{ob.doneCount}/{ob.total}</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Pour bien démarrer</Text>
                <Text style={styles.subtitle}>Quelques actions rapides pour profiter pleinement de votre suivi · {ob.doneCount}/{ob.total}</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(ob.doneCount / ob.total) * 100}%` }]} />
            </View>

            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
              {ob.steps.map((step, i) => (
                <TouchableOpacity
                  key={step.key}
                  style={styles.stepRow}
                  activeOpacity={step.done ? 1 : 0.7}
                  onPress={() => goToStep(step)}
                  disabled={step.done}
                >
                  <View style={[styles.stepCheck, step.done && { backgroundColor: COLORS.green, borderColor: COLORS.green }]}>
                    {step.done
                      ? <Ionicons name="checkmark" size={15} color="#fff" />
                      : <Text style={styles.stepNum}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.stepLabel, step.done && styles.stepLabelDone]}>{step.label}</Text>
                    {!step.done && <Text style={styles.stepHint} numberOfLines={2}>{step.hint}</Text>}
                  </View>
                  {!step.done && <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.dismissBtn} onPress={() => { ob.dismiss(); setOpen(false); }} activeOpacity={0.7}>
              <Text style={styles.dismissText}>Passer le guide</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.emerald + '1A', borderWidth: 1, borderColor: c.emerald + '44', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
    badgeCount: { },
    badgeCountText: { fontSize: 12, fontWeight: '800', color: c.emerald },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.cardBorder, padding: 20, paddingBottom: 32 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
    title: { fontSize: 20, fontWeight: '800', color: c.text },
    subtitle: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
    progressTrack: { height: 6, borderRadius: 3, backgroundColor: c.cardBorder, overflow: 'hidden', marginBottom: 8 },
    progressFill: { height: '100%', borderRadius: 3, backgroundColor: c.emerald },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.cardBorder },
    stepCheck: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: c.cardBorder, alignItems: 'center', justifyContent: 'center' },
    stepNum: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    stepLabel: { fontSize: 15, fontWeight: '600', color: c.text },
    stepLabelDone: { color: c.textSecondary, textDecorationLine: 'line-through' },
    stepHint: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    dismissBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
    dismissText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  });
}
