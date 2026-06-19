/**
 * AppTourModal — tour de présentation OBLIGATOIRE affiché après le questionnaire.
 * Présente le menu et chaque écran. L'utilisateur doit dérouler toutes les étapes
 * (pas de fermeture/skip). À la fin → onFinish() (qui marque app_tour_done).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';

interface Slide { icon: string; color: keyof ReturnType<typeof slideColors> | string; title: string; text: string; }

function slideColors(c: any) {
  return { green: c.green, blue: c.blue, violet: c.violet, orange: c.orange, teal: c.teal, accent: c.emerald };
}

interface Props { visible: boolean; onFinish: () => void; }

export default function AppTourModal({ visible, onFinish }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [step, setStep] = useState(0);

  const slides: { icon: string; color: string; title: string; text: string }[] = [
    { icon: 'sparkles-outline', color: COLORS.emerald, title: 'Bienvenue sur Relyka 👋', text: 'Pas d\'inquiétude : tout est simple et rapide. Quelques infos à saisir une fois, et l\'app s\'occupe du reste — vos finances deviennent claires, sans prise de tête.' },
    { icon: 'apps-outline', color: COLORS.emerald, title: 'Tout au même endroit', text: 'En bas : Comptes, Transactions, Pilotage, Tréso et Projection. Vous passez de l\'un à l\'autre en un geste. En haut à droite : votre profil et vos réglages.' },
    { icon: 'wallet-outline', color: COLORS.checking, title: 'Comptes', text: 'Ajoutez vos comptes en quelques secondes. Une fois faits, vos soldes se mettent à jour tout seuls — fini les calculs à la main.' },
    { icon: 'list-outline', color: COLORS.emerald, title: 'Transactions', text: 'Notez une dépense ou une recette en deux tapes. Les opérations récurrentes (loyer, salaire…) se répètent automatiquement : vous ne saisissez qu\'une fois.' },
    { icon: 'home-outline', color: COLORS.emerald, title: 'Pilotage', text: 'Votre tableau de bord clair : ce qu\'il vous reste à allouer et des recommandations sur mesure. L\'app vous guide, vous décidez sereinement.' },
    { icon: 'calendar-outline', color: COLORS.blue, title: 'Tréso', text: 'Voyez vos prochains mois d\'un coup d\'œil. Plus de mauvaises surprises : vous anticipez tranquillement.' },
    { icon: 'trending-up-outline', color: COLORS.violet, title: 'Projection', text: 'Visualisez votre épargne grandir dans le temps. Un vrai coup de pouce pour développer votre patrimoine, à votre rythme.' },
    { icon: 'settings-outline', color: COLORS.orange, title: 'Toujours là pour vous', text: 'Personnalisez l\'app et contactez l\'assistance quand vous voulez. Allez, on commence — on vous guide pas à pas, rien d\'obligatoire.' },
  ];

  const isLast = step === slides.length - 1;
  const s = slides[step];

  const finish = () => { setStep(0); onFinish(); };
  const next = () => { if (isLast) finish(); else setStep(step + 1); };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={finish}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Passer — ferme le guide immédiatement (§guide) */}
          {!isLast && (
            <TouchableOpacity style={styles.skipBtn} onPress={finish} hitSlop={8}>
              <Text style={styles.skipText}>Passer</Text>
            </TouchableOpacity>
          )}

          <View style={[styles.iconCircle, { backgroundColor: s.color + '22', borderColor: s.color + '55' }]}>
            <Ionicons name={s.icon as any} size={36} color={s.color} />
          </View>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.text}>{s.text}</Text>

          <View style={styles.dots}>
            {slides.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && { backgroundColor: COLORS.emerald, width: 18 }]} />
            ))}
          </View>

          <TouchableOpacity style={styles.btn} onPress={next} activeOpacity={0.85}>
            <Text style={styles.btnText}>{isLast ? 'Commencer' : 'Suivant'}</Text>
            <Ionicons name={isLast ? 'checkmark' : 'arrow-forward'} size={18} color={COLORS.bg} />
          </TouchableOpacity>
          <Text style={styles.counter}>{step + 1} / {slides.length}</Text>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder, padding: 28, alignItems: 'center' },
    skipBtn: { alignSelf: 'flex-end', marginBottom: 6 },
    skipText: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 18 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 10, letterSpacing: -0.3 },
    text: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
    dots: { flexDirection: 'row', gap: 6, marginVertical: 22 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.cardBorder },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 32, width: '100%' },
    btnText: { fontSize: 16, fontWeight: '700', color: c.bg },
    counter: { fontSize: 12, color: c.textSecondary, marginTop: 12 },
  });
}
