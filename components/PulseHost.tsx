/**
 * POULS — les rendez-vous (hebdo & mensuel). Monté UNE fois au niveau racine.
 *
 * HIÉRARCHIE STRICTE : jamais deux sollicitations le même jour.
 *   1. « État des lieux » du mois (le plus fort) — une fois par mois ;
 *   2. « Pouls de la semaine » — une fois par semaine, s'il n'y a pas d'état des lieux à montrer.
 *
 * FERMETURE : au tap (à côté) ou en balayant vers le haut. Aucune auto-disparition — l'utilisateur
 * lit à son rythme. Une fois fermé, on marque la période comme vue (et on archive le bilan).
 *
 * GARDE-FOUS :
 *   • jamais avant que l'app soit réellement révélée (post-splash) ni pendant le guide ;
 *   • jamais en consultation admin (« connecté en tant que ») ;
 *   • jamais tant que l'utilisateur n'a pas de quoi être jugé (aucun signal).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Pressable, PanResponder, Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTour } from '../contexts/TourContext';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { usePulse } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { usePulseSeen, useSavePulseSnapshot } from '../hooks/usePulseState';
import { isAppReady, onAppReady } from '../lib/splashGate';
import { PROFILE_INFO } from '../lib/financialProfileEngine';
import { monthKey, weekKey, weekRangeLabel, type PulseResult } from '../lib/pulseEngine';
import PulseSignalCard, { pulseColor } from './PulseSignalCard';

type PulseKind = 'week' | 'month';

/**
 * Ouverture manuelle du Pouls (pastille du Pilotage, aperçu admin).
 * `consume: false` → l'ouverture ne « brûle » pas la période (aperçu admin : le vrai rendez-vous
 * hebdo doit toujours arriver ensuite, et rien n'est archivé).
 */
let openManually: ((kind: PulseKind, consume: boolean) => void) | null = null;
export function openPulse(kind: PulseKind = 'week', consume = true): void {
  openManually?.(kind, consume);
}

export default function PulseHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const router = useRouter();
  const segments = useSegments();
  const tour = useTour();
  const { user, isImpersonating } = useAuth();

  const { data: config } = usePulseConfig();
  const pulse = usePulse();
  const { seen, markSeen } = usePulseSeen(user?.id);
  const saveSnapshot = useSavePulseSnapshot();

  const [kind, setKind] = useState<PulseKind | null>(null);
  /** Aperçu (admin) : à la fermeture, on ne marque rien comme vu et on n'archive pas. */
  const [preview, setPreview] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  // Post-splash : on ne montre jamais un bilan derrière l'écran de chargement.
  const [appReady, setAppReady] = useState(() => isAppReady() || Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const off = onAppReady(() => setAppReady(true));
    const fallback = setTimeout(() => setAppReady(true), 4000);
    return () => { off(); clearTimeout(fallback); };
  }, []);

  const today = new Date();
  const currentWeek = weekKey(today);
  const inTabs = segments[0] === '(tabs)';
  // Rien à juger (utilisateur tout neuf) → on ne le sollicite pas pour lui dire qu'on ne sait rien.
  const hasSignals = (pulse?.result.signals.length ?? 0) > 0;
  const canShow = appReady && inTabs && !tour.active && !isImpersonating && !!config?.enabled && hasSignals;

  const open = useCallback((next: PulseKind) => {
    setKind(next);
    drag.setValue(0);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [anim, drag]);

  // Ouvertures manuelles : pastille du Pilotage (consomme la période) et aperçu admin (ne consomme rien).
  useEffect(() => {
    openManually = (k, consume) => { setPreview(!consume); open(k); };
    return () => { openManually = null; };
  }, [open]);

  // Quel rendez-vous montrer ? Le mensuel prime toujours sur l'hebdo — jamais les deux le même jour.
  useEffect(() => {
    if (!canShow || kind) return;
    // L'état des lieux du mois écoulé n'a de sens que si l'utilisateur l'a VÉCU dans l'app : sinon on
    // lui servirait le bilan d'un mois où il n'existait pas.
    const lastMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    if (config?.monthly && pulse?.hadActivityLastMonth && seen.month !== lastMonth) { open('month'); return; }
    if (config?.weekly && seen.week !== currentWeek) { open('week'); return; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow, kind, seen.month, seen.week, config?.monthly, config?.weekly, currentWeek, pulse?.hadActivityLastMonth, open]);

  const close = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        const closing = kind;
        setKind(null);
        drag.setValue(0);
        if (preview) { setPreview(false); return; } // aperçu admin : rien n'est consommé ni archivé
        if (!closing || !pulse) return;
        // Vu → ne revient plus cette période. Et on ARCHIVE le constat tel qu'il a été montré
        // (évolution du patrimoine, série « tout au vert », statistiques admin).
        const periodKey = closing === 'week'
          ? currentWeek
          : monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
        markSeen.mutate(closing === 'week' ? { week: currentWeek } : { month: periodKey });
        saveSnapshot.mutate({
          periodKind: closing,
          periodKey,
          profileTier: pulse.profileId,
          result: pulse.result,
          wealth: pulse.wealth,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim, drag, kind, preview, pulse, currentWeek, markSeen, saveSnapshot]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy < 0) drag.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -50) close();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, tension: 80, friction: 9 }).start();
      },
    }),
    [drag, close],
  );

  if (!kind || !pulse) return null;
  const { result } = pulse;
  const isMonth = kind === 'month';
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const info = PROFILE_INFO[pulse.profileId];

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Fermer" />
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.sheet,
          { maxHeight: screenHeight - insets.top - 60, marginTop: insets.top + 48 },
          {
            opacity: anim,
            transform: [
              { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }), drag) },
            ],
          },
        ]}
      >
        <View style={styles.grabber} />

        {/* En-tête : le titre, la période, et le profil qui donne les repères. */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {isMonth ? '📍 État des lieux' : '🫀 Pouls de la semaine'}
            </Text>
            <Text style={styles.period}>
              {isMonth
                ? previousMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
                : weekRangeLabel(today)}
            </Text>
          </View>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        {/* Le profil + les pastilles d'état : lisible sans lire une ligne de texte. */}
        <View style={styles.summary}>
          <Text style={styles.profile} numberOfLines={1}>
            {info.emoji} {info.name}
          </Text>
          <StatusDots result={result} COLORS={COLORS} />
        </View>

        <Text style={styles.headline}>{result.headline}</Text>

        {/* Les signaux — scrollables : il peut y en avoir plus que la hauteur d'écran. */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {result.signals.map((signal, index) => (
            <PulseSignalCard
              key={signal.id}
              signal={signal}
              delay={120 + index * 90}
              onAction={(route) => { close(); router.push(route as any); }}
            />
          ))}
        </ScrollView>

        <Text style={styles.footer}>
          Repères liés à ton profil, réévalués chaque mois. Balaie vers le haut pour fermer.
        </Text>
      </Animated.View>
    </View>
  );
}

/** Les pastilles de résumé : une par signal jugé, dans l'ordre. */
function StatusDots({ result, COLORS }: { result: PulseResult; COLORS: AppColors }) {
  const judged = result.signals.filter((s) => s.status !== 'neutral');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {judged.map((s) => (
        <View
          key={s.id}
          style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: pulseColor(COLORS, s.status) }}
        />
      ))}
      {result.judgedCount > 0 && (
        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.textSecondary, marginLeft: 3 }}>
          {result.greenCount}/{result.judgedCount}
        </Text>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, zIndex: 55, elevation: 55 },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      position: 'absolute', left: 12, right: 12, top: 0,
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
        android: { elevation: 16 },
        default: { boxShadow: '0 10px 30px rgba(0,0,0,0.25)' } as any,
      }),
    },
    grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginBottom: 12 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 19, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
    period: { fontSize: 12, color: c.textSecondary, marginTop: 2, textTransform: 'capitalize' },
    closeBtn: { padding: 4 },
    summary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      marginTop: 12, paddingVertical: 9, paddingHorizontal: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
    },
    profile: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    headline: { fontSize: 13.5, color: c.textSecondary, lineHeight: 19, marginTop: 10, marginBottom: 12 },
    list: { flexGrow: 0 },
    footer: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 15 },
  });
}
