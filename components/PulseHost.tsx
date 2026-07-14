/**
 * POULS — les rendez-vous. Monté UNE fois au niveau racine.
 *
 * TROIS VUES, pour trois moments :
 *  • 'week'  — le Pouls de la semaine, LÉGER (3 signaux max) : s'ouvre seul à la 1ʳᵉ ouverture de
 *              la semaine, et au tap sur la pastille 🫀 du Pilotage. Un lien en bas ouvre la vue
 *              complète pour qui veut creuser.
 *  • 'month' — l'État des lieux du mois écoulé, COMPLET : s'ouvre seul après la fin du mois.
 *  • 'now'   — l'État des lieux d'aujourd'hui, COMPLET : à la demande (depuis la vue hebdo ou
 *              l'aperçu admin). Ne consomme rien, n'archive rien.
 *
 * HIÉRARCHIE STRICTE : jamais deux rendez-vous le même jour (mensuel > hebdo).
 * FERMETURE : tap à côté ou balayage vers le haut. Aucune auto-disparition.
 * GARDE-FOUS : jamais avant la fin du splash, pendant le guide, en consultation admin,
 * ni tant qu'aucun signal n'est réellement jugé.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Pressable, PanResponder, Platform,
  TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
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

type PulseView = 'week' | 'month' | 'now';

/**
 * Ouverture manuelle (pastille du Pilotage, aperçu admin).
 * `consume: false` → rien n'est marqué vu ni archivé (aperçu admin).
 */
let openManually: ((view: PulseView, consume: boolean) => void) | null = null;
export function openPulse(view: PulseView = 'week', consume = true): void {
  openManually?.(view, consume);
}

export default function PulseHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const segments = useSegments();
  const tour = useTour();
  const { user, isImpersonating } = useAuth();

  const { data: config } = usePulseConfig();
  const pulse = usePulse();
  const { seen, isLoading: seenLoading, markSeen } = usePulseSeen(user?.id);
  const saveSnapshot = useSavePulseSnapshot();

  const [view, setView] = useState<PulseView | null>(null);
  /** Aperçu (admin) : à la fermeture, rien n'est marqué vu ni archivé. */
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
  const lastMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const inTabs = segments[0] === '(tabs)';
  const canShow = appReady && inTabs && !tour.active && !isImpersonating && !seenLoading && !!config?.enabled && !!pulse;

  const open = useCallback((next: PulseView) => {
    setView(next);
    drag.setValue(0);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [anim, drag]);

  // Ouvertures manuelles : pastille du Pilotage (consomme la semaine) et aperçu admin (ne consomme rien).
  useEffect(() => {
    openManually = (v, consume) => { setPreview(!consume); open(v); };
    return () => { openManually = null; };
  }, [open]);

  // Quel rendez-vous ouvrir tout seul ? Le mensuel prime — jamais les deux le même jour.
  // On attend d'avoir des signaux réellement JUGÉS : pas de bilan pour dire qu'on ne sait rien.
  useEffect(() => {
    if (!canShow || view || !pulse) return;
    // L'état des lieux du mois écoulé n'a de sens que si l'utilisateur l'a vécu dans l'app.
    if (config?.monthly && pulse.hadActivityLastMonth && pulse.result.judgedCount > 0 && seen.month !== lastMonth) {
      open('month');
      return;
    }
    if (config?.weekly && pulse.weekly.judgedCount > 0 && seen.week !== currentWeek) {
      open('week');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow, view, pulse, seen.month, seen.week, config?.monthly, config?.weekly, currentWeek, lastMonth, open]);

  /** Consomme la période affichée : marquée vue + bilan archivé tel qu'il a été montré. */
  const consume = useCallback((closing: PulseView) => {
    if (preview || !pulse || closing === 'now') return;
    if (closing === 'week') {
      markSeen.mutate({ week: currentWeek });
      saveSnapshot.mutate({
        periodKind: 'week', periodKey: currentWeek,
        profileTier: pulse.profileId, result: pulse.weekly, wealth: pulse.wealth,
      });
      return;
    }
    // Mensuel : il couvre aussi la semaine (jamais deux rendez-vous d'affilée) → semaine marquée vue
    // ET archivée quand même (la série « tout au vert » a besoin d'un bilan hebdo chaque semaine).
    markSeen.mutate({ month: lastMonth, week: currentWeek });
    saveSnapshot.mutate({
      periodKind: 'month', periodKey: lastMonth,
      profileTier: pulse.profileId, result: pulse.result, wealth: pulse.wealth,
    });
    saveSnapshot.mutate({
      periodKind: 'week', periodKey: currentWeek,
      profileTier: pulse.profileId, result: pulse.weekly, wealth: pulse.wealth,
    });
  }, [preview, pulse, currentWeek, lastMonth, markSeen, saveSnapshot]);

  const close = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        if (view) consume(view);
        setView(null);
        setPreview(false);
        drag.setValue(0);
      });
  }, [anim, drag, view, consume]);

  /** Hebdo → état des lieux complet : la semaine est consommée, la vue complète ne consomme rien. */
  const expandToNow = useCallback(() => {
    consume('week');
    setPreview(true);
    setView('now');
  }, [consume]);

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

  if (!view || !pulse) return null;

  const result: PulseResult = view === 'week' ? pulse.weekly : pulse.result;
  const info = PROFILE_INFO[pulse.profileId];
  const title = view === 'week' ? '🫀 Pouls de la semaine' : '📍 État des lieux';
  // Les signaux décrivent TOUJOURS la situation d'aujourd'hui : le rendez-vous mensuel est un
  // point d'étape « au sortir du mois écoulé », pas une photo du mois passé — le libellé le dit.
  const period = view === 'week'
    ? weekRangeLabel(today)
    : view === 'month'
      ? `après ton mois de ${new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`
      : today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

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

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.period}>{period}</Text>
          </View>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        {/* Le profil + une pastille par signal jugé : l'état se lit sans lire une ligne. */}
        <View style={styles.summary}>
          <Text style={styles.profile} numberOfLines={1}>{info.emoji} {info.name}</Text>
          <StatusDots result={result} COLORS={COLORS} />
        </View>

        <Text style={styles.headline}>{result.headline}</Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {result.signals.map((signal, index) => (
            <PulseSignalCard key={`${view}-${signal.id}`} signal={signal} delay={120 + index * 90} />
          ))}
        </ScrollView>

        {/* Hebdo → accès à la vue complète, pour qui veut creuser. */}
        {view === 'week' && (
          <TouchableOpacity style={styles.expand} onPress={expandToNow} accessibilityRole="button">
            <Text style={styles.expandTxt}>Mon état des lieux complet</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.emerald} />
          </TouchableOpacity>
        )}

        <Text style={styles.footer}>Repères liés à ton profil, réévalués chaque mois.</Text>
      </Animated.View>
    </View>
  );
}

/** Une pastille par signal jugé, dans l'ordre d'affichage. */
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
    period: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    closeBtn: { padding: 4 },
    summary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      marginTop: 12, paddingVertical: 9, paddingHorizontal: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
    },
    profile: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    headline: { fontSize: 13.5, color: c.textSecondary, lineHeight: 19, marginTop: 10, marginBottom: 12 },
    list: { flexGrow: 0 },
    expand: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderWidth: 1, borderColor: c.emerald + '66', borderRadius: 12, paddingVertical: 11, marginTop: 2,
    },
    expandTxt: { fontSize: 13, fontWeight: '800', color: c.emerald },
    footer: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 10 },
  });
}
