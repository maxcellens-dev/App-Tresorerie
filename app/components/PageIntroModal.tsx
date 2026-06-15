/**
 * PageIntroModal — présentation simple et centrée d'une page, à la 1ʳᵉ visite.
 * Pas d'enchaînement : l'utilisateur lit puis ferme. Ne revient plus (drapeau onboarding),
 * sauf s'il relance le tuto depuis le support.
 *
 * Usage :
 *   <PageIntroModal pageKey="transactions" />          // déclenché au focus de l'écran
 *   <PageIntroModal pageKey="menu" active={menuOpen} /> // déclenché par un état explicite
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useAppColors } from '../hooks/useAppColors';
import { usePageIntro } from '../hooks/usePageIntro';
import type { PageIntroKey } from '../hooks/useOnboarding';

interface IntroContent { icon: string; color: keyof ReturnType<typeof palette> | string; title: string; text: string; }

function palette(c: any) {
  return { green: c.emerald, blue: c.blue, violet: c.violet, orange: c.orange, teal: c.teal };
}

const CONTENT: Record<PageIntroKey, { icon: string; colorKey: string; title: string; text: string }> = {
  transactions: {
    icon: 'list-outline', colorKey: 'green', title: 'Transactions',
    text: "Note tes dépenses et tes recettes en deux tapes. Les opérations qui reviennent (loyer, salaire…) se répètent automatiquement : tu ne les saisis qu'une seule fois.",
  },
  pilotage: {
    icon: 'home-outline', colorKey: 'green', title: 'Pilotage',
    text: "Ton tableau de bord : ce qu'il te reste à allouer, tes recommandations personnalisées et le suivi de ton mois, d'un coup d'œil.",
  },
  projets: {
    icon: 'flag-outline', colorKey: 'blue', title: 'Projets',
    text: "Définis tes projets d'épargne (voyage, voiture, apport…) et suis leur progression mois après mois. L'app met de côté ce qu'il faut.",
  },
  projection: {
    icon: 'trending-up-outline', colorKey: 'violet', title: 'Projection',
    text: "Visualise l'évolution de ton épargne et de ton patrimoine dans le temps, selon tes hypothèses. De quoi te projeter sereinement.",
  },
  menu: {
    icon: 'person-circle-outline', colorKey: 'orange', title: 'Ton menu',
    text: "Profil, apparence, abonnement, assistance et réglages : tout est ici. Reviens-y quand tu veux personnaliser l'app ou nous contacter.",
  },
};

interface Props {
  pageKey: PageIntroKey;
  /** Si fourni, pilote l'affichage (sinon : focus de l'écran courant). */
  active?: boolean;
}

export default function PageIntroModal({ pageKey, active }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const focused = useIsFocused();
  const { seen, ready, dismiss } = usePageIntro(pageKey);
  const [open, setOpen] = useState(false);

  const trigger = active !== undefined ? active : focused;

  // Ouvre une fois la page active, le profil chargé et la présentation jamais vue.
  // Petit délai pour laisser l'écran se stabiliser (évite un flash pendant la navigation).
  useEffect(() => {
    if (trigger && ready && !seen) {
      const t = setTimeout(() => setOpen(true), 350);
      return () => clearTimeout(t);
    }
    if (!trigger) setOpen(false);
  }, [trigger, ready, seen]);

  const close = () => {
    setOpen(false);
    if (!seen) dismiss();
  };

  if (!open) return null;

  const c = CONTENT[pageKey];
  const color = (palette(COLORS) as any)[c.colorKey] ?? COLORS.emerald;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <View style={[styles.iconCircle, { backgroundColor: color + '22', borderColor: color + '55' }]}>
            <Ionicons name={c.icon as any} size={34} color={color} />
          </View>
          <Text style={styles.title}>{c.title}</Text>
          <Text style={styles.text}>{c.text}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: color }]} onPress={close} activeOpacity={0.85}>
            <Text style={styles.btnText}>J'ai compris</Text>
            <Ionicons name="checkmark" size={18} color={COLORS.bg} />
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder, padding: 28, alignItems: 'center' },
    closeBtn: { position: 'absolute', top: 12, right: 12, padding: 4 },
    iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 18 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 10, letterSpacing: -0.3 },
    text: { fontSize: 15, color: c.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 22 },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 32, width: '100%' },
    btnText: { fontSize: 16, fontWeight: '700', color: c.bg },
  });
}
