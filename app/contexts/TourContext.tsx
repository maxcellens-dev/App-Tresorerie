/**
 * TourContext — orchestre le tour de présentation OBLIGATOIRE page par page.
 * Chaque écran participant affiche son GuideOverlay (bulles ancrées sur les zones)
 * quand `currentKey` correspond. À la fin des bulles d'un écran, on passe au suivant
 * (navigation automatique). Au terme du dernier écran → message de fin + app_tour_done = true.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthContext';
import { useUpdateOnboarding } from '../hooks/useOnboarding';
import { useAppColors } from '../hooks/useAppColors';

export type TourKey = 'comptes' | 'transactions' | 'pilotage' | 'tresorerie' | 'projection' | 'profile' | 'parametres';

const ORDER: { key: TourKey; route: string }[] = [
  { key: 'comptes',      route: '/(tabs)/comptes' },
  { key: 'transactions', route: '/(tabs)/transactions' },
  { key: 'pilotage',     route: '/(tabs)/pilotage' },
  { key: 'tresorerie',   route: '/(tabs)/tresorerie' },
  { key: 'projection',   route: '/(tabs)/projection' },
  { key: 'parametres',   route: '/(tabs)/(secondary)/parametres' },
];

interface TourCtx {
  active: boolean;
  finished: boolean;
  currentKey: TourKey | null;
  start: () => void;
  completeScreen: (key: TourKey) => void;
}

const Ctx = createContext<TourCtx>({ active: false, finished: false, currentKey: null, start: () => {}, completeScreen: () => {} });

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const COLORS = useAppColors();
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const [active, setActive] = useState(false);
  const [finished, setFinished] = useState(false);
  const [index, setIndex] = useState(0);
  const navTimer = useRef<any>(null);

  // `navigate` : ne crée pas de doublon (réutilise l'écran s'il existe) et évite le
  // « churn » de replace entre onglets/écrans secondaires (qui laissait un écran noir).
  const goTo = (route: string) => {
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => router.navigate(route as any), 80);
  };

  const start = useCallback(() => {
    setFinished(false);
    setIndex(0);
    setActive(true);
    goTo(ORDER[0].route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeScreen = useCallback((key: TourKey) => {
    setIndex((i) => {
      if (ORDER[i]?.key !== key) return i;
      const next = i + 1;
      if (next >= ORDER.length) {
        setActive(false);
        updateOnboarding.mutate({ app_tour_done: true });
        // Fin du tour → message de fin, puis retour sur Comptes.
        setFinished(true);
        goTo('/(tabs)/comptes');
        return i;
      }
      goTo(ORDER[next].route);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateOnboarding]);

  const currentKey = active ? (ORDER[index]?.key ?? null) : null;
  const styles = makeStyles(COLORS);

  return (
    <Ctx.Provider value={{ active, finished, currentKey, start, completeScreen }}>
      {children}
      <Modal visible={finished} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setFinished(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setFinished(false)}>
          <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.emoji}>🎉</Text>
            <Text style={styles.title}>Vous êtes prêt !</Text>
            <Text style={styles.text}>
              Vous avez fait le tour de l'application. Pour vous lancer, suivez la checklist «&nbsp;Pour bien démarrer&nbsp;» accessible via la pastille en haut à droite.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={() => setFinished(false)} accessibilityRole="button">
              <Ionicons name="checkmark" size={18} color={COLORS.bg} />
              <Text style={styles.btnText}>Terminer</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Ctx.Provider>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 28 },
    card: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder, padding: 28, alignItems: 'center', gap: 12 },
    emoji: { fontSize: 52 },
    title: { fontSize: 21, fontWeight: '800', color: c.text, textAlign: 'center' },
    text: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 40, marginTop: 8 },
    btnText: { fontSize: 16, fontWeight: '700', color: c.bg },
  });
}

export const useTour = () => useContext(Ctx);
