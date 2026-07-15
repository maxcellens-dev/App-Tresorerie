/**
 * POULS — les rendez-vous. Monté UNE fois au niveau racine.
 *
 * TROIS VUES, pour trois moments :
 *  • 'week'  — le Pouls de la semaine, LÉGER et VISUEL (anneau + 2 lignes + série) : s'ouvre seul
 *              à la 1ʳᵉ ouverture de la semaine.
 *  • 'month' — l'État des lieux du mois écoulé, COMPLET : s'ouvre seul après la fin du mois.
 *  • 'now'   — l'État des lieux d'aujourd'hui, COMPLET : au tap sur la pilule du mois du Pilotage
 *              (ou l'aperçu admin). Ne consomme rien, n'archive rien.
 *
 * HIÉRARCHIE STRICTE : jamais deux rendez-vous le même jour (mensuel > hebdo).
 * FERMETURE : tap à côté ou balayage vers le haut. Aucune auto-disparition.
 * GARDE-FOUS : jamais avant la fin du splash, pendant le guide, en consultation admin,
 * ni tant qu'aucun signal n'est réellement jugé.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Pressable, PanResponder, Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useTour } from '../contexts/TourContext';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { usePulse, type PulseData } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { useGamification } from '../hooks/useGamification';
import { usePulseSeen, useSavePulseSnapshot, type PulseSeenState } from '../hooks/usePulseState';
import { isAppReady, onAppReady } from '../lib/splashGate';
import { PROFILE_INFO } from '../lib/financialProfileEngine';
import { monthKey, weekKey, weekRangeLabel, type PulseResult, type PulseSignalId } from '../lib/pulseEngine';
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
  // Série hebdo de suivi (la même que la flamme du header) — affichée en pied du Pouls hebdo.
  const { state: gamState } = useGamification(user?.id);
  const weekStreak = gamState?.streak ?? 0;

  const [view, setView] = useState<PulseView | null>(null);
  /** Aperçu (admin) : à la fermeture, rien n'est marqué vu ni archivé. */
  const [preview, setPreview] = useState(false);
  /**
   * Périodes consommées CETTE session, tenues en local et synchrones : le `markSeen` serveur est
   * asynchrone — sans ce garde, l'effet d'auto-ouverture relisait l'ancien « vu » juste après une
   * fermeture et rouvrait le hebdo dans la foulée (exactement la double sollicitation interdite).
   */
  const localSeen = useRef<PulseSeenState>({});
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

  // `open` pose seulement la vue : l'animation d'entrée est pilotée par l'effet ci-dessous, qui
  // attend que les DONNÉES soient là (un tap sur la pastille pendant le chargement ne doit pas
  // faire surgir une feuille déjà « ouverte » sans animation quand les données arrivent).
  const open = useCallback((next: PulseView) => { setView(next); }, []);

  const animatedFor = useRef<PulseView | null>(null);
  useEffect(() => {
    if (!view) { animatedFor.current = null; return; }
    if (!pulse || animatedFor.current === view) return;
    animatedFor.current = view;
    drag.setValue(0);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [view, pulse, anim, drag]);

  // Ouvertures manuelles : pastille du Pilotage (consomme la semaine) et aperçu admin (ne consomme rien).
  useEffect(() => {
    openManually = (v, consume) => { setPreview(!consume); open(v); };
    return () => { openManually = null; };
  }, [open]);

  // Quel rendez-vous ouvrir tout seul ? Le mensuel prime — jamais les deux le même jour.
  // On attend d'avoir des signaux réellement JUGÉS : pas de bilan pour dire qu'on ne sait rien.
  useEffect(() => {
    if (!canShow || view || !pulse) return;
    const monthSeen = seen.month === lastMonth || localSeen.current.month === lastMonth;
    const weekSeen = seen.week === currentWeek || localSeen.current.week === currentWeek;
    // L'état des lieux du mois écoulé n'a de sens que si l'utilisateur l'a vécu dans l'app.
    if (config?.monthly && pulse.hadActivityLastMonth && pulse.result.judgedCount > 0 && !monthSeen) {
      open('month');
      return;
    }
    if (config?.weekly && pulse.weekly.judgedCount > 0 && !weekSeen) {
      open('week');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow, view, pulse, seen.month, seen.week, config?.monthly, config?.weekly, currentWeek, lastMonth, open]);

  /**
   * Consomme la période affichée : marquée vue + bilan archivé tel qu'il a été montré.
   *  • 'week'  — consomme la semaine.
   *  • 'month' — consomme le mois ET la semaine (le mensuel absorbe l'hebdo : après un bilan
   *              complet, recevoir un sous-ensemble serait une sollicitation de trop). Le bilan
   *              hebdo est archivé quand même (la série « tout au vert » a besoin d'un point/semaine).
   *  • 'now'   — simple consultation (pastille) : RIEN n'est consommé côté serveur — les rendez-vous
   *              hebdo/mensuel reviendront — mais plus d'auto-ouverture CETTE session (pas de dos-à-dos).
   */
  const consume = useCallback((closing: PulseView) => {
    if (preview || !pulse) return;
    if (closing === 'now') {
      localSeen.current = { week: currentWeek, month: lastMonth };
      return;
    }
    if (closing === 'week') {
      localSeen.current.week = currentWeek;
      markSeen.mutate({ week: currentWeek });
      saveSnapshot.mutate({
        periodKind: 'week', periodKey: currentWeek,
        profileTier: pulse.profileId, result: pulse.weekly, wealth: pulse.wealth,
      });
      return;
    }
    localSeen.current = { week: currentWeek, month: lastMonth };
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
  const title = view === 'week' ? '🧭 Point de la semaine' : '🧭 État des lieux';
  // Les signaux décrivent TOUJOURS la situation d'aujourd'hui : le rendez-vous mensuel est un
  // point d'étape « au sortir du mois écoulé », pas une photo du mois passé — le libellé le dit.
  const period = view === 'week'
    ? weekRangeLabel(today)
    : view === 'month'
      ? new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      : today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Fermer" />
      {/* Wrapper centré : sur web desktop, la feuille reste à largeur « mobile » au centre
          (les hosts sont montés HORS de la colonne d'app — cf. sheetWidth dans lib/appLayout). */}
      <View style={[styles.center, { top: insets.top + 48 }]} pointerEvents="box-none">
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.sheet,
          { maxHeight: screenHeight - insets.top - 60 },
          {
            opacity: anim,
            transform: [
              { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }), drag) },
            ],
          },
        ]}
      >
        <View style={styles.grabber} />

        {/* Titre + date sur la MÊME ligne (gain de place) : « État des lieux · 15 juillet 2026 ». */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Text style={styles.period} numberOfLines={1}>· {period}</Text>
          </View>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        {view === 'week' ? (
          /* ── HEBDO : un POINT D'ÉTAPE visuel et compact — anneau épargné+investi, deux lignes,
                la série. Rien d'autre : pas de synthèse, pas de bouton, pas de note. ── */
          <>
            <ScrollView showsVerticalScrollIndicator={false} style={[styles.list, { marginTop: 12 }]}>
              <View style={styles.weekCard}>
                <View style={styles.weekRow}>
                  {pulse.weeklyStats.capacity >= 20 && (
                    <WeeklyRing stats={pulse.weeklyStats} COLORS={COLORS} />
                  )}
                  <View style={styles.weekStats}>
                    {/* Point HEBDO : pas de pastille d'état (elle masquait les titres) — juste une
                        pointe de couleur + le titre + le chiffre. L'état se lit à la couleur. */}
                    {weeklyRows(result, pulse.weeklyStats.capacity >= 20).map((signal) => {
                      const color = pulseColor(COLORS, signal.status);
                      return (
                        <View key={signal.id} style={styles.weekStatRow}>
                          <View style={styles.weekStatHead}>
                            <View style={[styles.weekStatDot, { backgroundColor: color }]} />
                            <Text style={styles.weekStatLabel} numberOfLines={1}>
                              {signal.emoji} {WEEKLY_SHORT_LABELS[signal.id] ?? signal.label}
                            </Text>
                          </View>
                          <Text style={styles.weekStatSub} numberOfLines={2}>{signal.headline}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
                {pulse.weeklyStats.capacity >= 20 && (
                  <View style={styles.weekLegend}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.green }]} />
                    <Text style={styles.legendTxt}>Épargné {eurFmt(pulse.weeklyStats.saved)}</Text>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.violet }]} />
                    <Text style={styles.legendTxt}>Investi {eurFmt(pulse.weeklyStats.invested)}</Text>
                    <Text style={[styles.legendTxt, { color: COLORS.textSecondary }]}>
                      · capacité : {eurFmt(pulse.weeklyStats.capacity)}
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {weekStreak > 0 && (
              <View style={styles.weekFooter}>
                <Text style={styles.streakTxt}>
                  🔥 <Text style={{ fontWeight: '800', color: COLORS.text }}>{weekStreak} semaine{weekStreak > 1 ? 's' : ''}</Text> de suivi d’affilée
                </Text>
              </View>
            )}
          </>
        ) : (
          /* ── COMPLET (mensuel / aujourd'hui) : tous les signaux du profil, en détail. ── */
          <>
            {/* Le profil + une pastille par signal jugé : l'état se lit sans lire une ligne. */}
            <View style={[styles.summary, { marginBottom: 4 }]}>
              <Text style={styles.profile} numberOfLines={1}>{info.emoji} {info.name}</Text>
              <StatusDots result={result} COLORS={COLORS} />
            </View>

            <ScrollView
              style={[styles.list, { marginTop: 12 }]}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {result.signals.map((signal, index) => (
                <PulseSignalCard key={`${view}-${signal.id}`} signal={signal} delay={120 + index * 90} />
              ))}
            </ScrollView>
          </>
        )}
      </Animated.View>
      </View>
    </View>
  );
}

const eurFmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`;

/** Libellés courts des lignes hebdo (compacts à côté de l'anneau). */
const WEEKLY_SHORT_LABELS: Partial<Record<PulseSignalId, string>> = {
  spending: 'Dépenses variables',
  end_of_month: 'Fin de mois',
  saving: 'Épargne',
  investing: 'Invest',
};

/**
 * Lignes compactes du Pouls hebdo. Quand l'anneau est affiché, il représente déjà l'épargne et
 * l'investissement du mois → seuls « Dépenses » et « Fin de mois » passent en ligne ; sans anneau
 * (aucune capacité ce mois-ci), tous les signaux hebdo passent en ligne.
 */
function weeklyRows(result: PulseResult, ringShown: boolean) {
  if (!ringShown) return result.signals;
  return result.signals.filter((s) => s.id === 'spending' || s.id === 'end_of_month');
}

/** L'anneau du Pouls hebdo : épargné (vert) + investi (violet) vs la capacité du mois. */
function WeeklyRing({ stats, COLORS }: { stats: PulseData['weeklyStats']; COLORS: AppColors }) {
  const size = 112;
  const strokeWidth = 11;
  const cx = size / 2;
  const r = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * r;

  const total = stats.saved + stats.invested;
  const filled = stats.capacity > 0 ? Math.min(1, total / stats.capacity) : 0;
  const pct = stats.capacity > 0 ? Math.round((total / stats.capacity) * 100) : 0;
  // Petit écart entre les deux segments quand les deux existent (lisibilité).
  const gap = stats.saved > 0 && stats.invested > 0 ? 3 : 0;
  const savedLen = Math.max(0, C * filled * (total > 0 ? stats.saved / total : 0) - gap);
  const investedLen = Math.max(0, C * filled * (total > 0 ? stats.invested / total : 0) - gap);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke={COLORS.cardBorder} strokeWidth={strokeWidth} />
        {savedLen > 0 && (
          <Circle
            cx={cx} cy={cx} r={r} fill="none"
            stroke={COLORS.green} strokeWidth={strokeWidth}
            strokeDasharray={`${savedLen} ${C - savedLen}`}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        )}
        {investedLen > 0 && (
          <Circle
            cx={cx} cy={cx} r={r} fill="none"
            stroke={COLORS.violet} strokeWidth={strokeWidth}
            strokeDasharray={`${investedLen} ${C - investedLen}`}
            strokeDashoffset={-(savedLen + gap)}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        )}
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Text style={{ fontSize: 21, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 }}>{pct} %</Text>
        <Text style={{ fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 12, maxWidth: 76 }}>
          épargne + invest{'\n'}du mois
        </Text>
      </View>
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
    center: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
    sheet: {
      width: '100%', maxWidth: 560,
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 24, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
        android: { elevation: 16 },
        default: { boxShadow: '0 10px 30px rgba(0,0,0,0.25)' } as any,
      }),
    },
    grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginBottom: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    titleRow: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    title: { flexShrink: 1, fontSize: 18, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
    period: { flexShrink: 0, fontSize: 12, color: c.textSecondary, textTransform: 'capitalize' },
    closeBtn: { padding: 4 },
    summary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      marginTop: 12, paddingVertical: 9, paddingHorizontal: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
    },
    profile: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    headline: { fontSize: 13.5, color: c.textSecondary, lineHeight: 19, marginTop: 10, marginBottom: 12 },
    list: { flexGrow: 0 },

    // ── Point hebdo (point d'étape compact) ──
    weekCard: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 18, padding: 14,
    },
    weekRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    weekStats: { flex: 1, gap: 10, minWidth: 0 },
    weekStatRow: {
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 13, paddingVertical: 9, paddingHorizontal: 11,
    },
    weekStatHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    weekStatDot: { width: 8, height: 8, borderRadius: 999, flexShrink: 0 },
    weekStatLabel: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    weekStatSub: { fontSize: 11, color: c.textSecondary, marginTop: 3, lineHeight: 15 },
    weekLegend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 12 },
    legendDot: { width: 8, height: 8, borderRadius: 999 },
    legendTxt: { fontSize: 11, fontWeight: '600', color: c.text, marginRight: 6 },
    weekFooter: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      marginTop: 12, paddingHorizontal: 2,
    },
    streakTxt: { fontSize: 12, color: c.textSecondary },

    footer: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 10 },
  });
}
