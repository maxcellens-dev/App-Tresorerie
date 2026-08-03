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
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { usePulse, type PulseData } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { useGamification } from '../hooks/useGamification';
import { usePulseSeen, useSavePulseSnapshot, type PulseSeenState } from '../hooks/usePulseState';
import { useMonthlyClosure } from '../hooks/useMonthlyClosure';
import { useInterruptSlot } from '../hooks/useInterruptSlot';
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
  const { user, isImpersonating } = useAuth();

  const { data: config } = usePulseConfig();
  const { data: profile } = useProfile(user?.id);
  const pulse = usePulse();
  const { seen, isLoading: seenLoading, markSeen } = usePulseSeen(user?.id);
  // L'état des lieux attend que les clôtures soient faites (cf. l'effet d'auto-ouverture).
  const { enabled: closureEnabled, pendingMonths, closures } = useMonthlyClosure(user?.id);
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

  // COMPTE TOUT NEUF : pas de « Point de la semaine » avant 7 jours d'ancienneté. Il tombait
  // à la seconde même de la création, par-dessus la découverte, pour ne dire à peu près rien
  // (« 0 € dépensés ce mois-ci ») : un bilan n'a de sens qu'une fois une période vécue.
  const accountAgeDays = (() => {
    const created = (profile as any)?.created_at;
    if (!created) return Infinity;                 // âge inconnu → on ne bloque pas
    const ms = Date.now() - new Date(created).getTime();
    return Number.isFinite(ms) ? ms / 86_400_000 : Infinity;
  })();
  const oldEnough = accountAgeDays >= 7;

  /* Garde-fous COMMUNS aux deux rendez-vous. L'ancienneté du compte n'en fait pas partie : elle ne
     concerne que le point hebdo (cf. monthlyWants / weeklyWants plus bas). */
  const canShowBase = appReady && inTabs && !isImpersonating && !seenLoading
    && !!config?.enabled && !!pulse;
  const canShow = canShowBase && oldEnough;

  // `open` pose seulement la vue : l'animation d'entrée est pilotée par l'effet ci-dessous, qui
  // attend que les DONNÉES soient là (un tap sur la pastille pendant le chargement ne doit pas
  // faire surgir une feuille déjà « ouverte » sans animation quand les données arrivent).
  const open = useCallback((next: PulseView) => { setView(next); }, []);

  const animatedFor = useRef<PulseView | null>(null);
  useEffect(() => {
    if (!view) { animatedFor.current = null; return; }
    if (!pulse || animatedFor.current === view) return;
    animatedFor.current = view;
    // Nouvelle vue = nouvelle liste : on repart d'une mesure vierge (onLayout / onContentSizeChange
    // la refont immédiatement au montage, bien avant qu'un geste soit possible).
    lastOffset.current = 0;
    contentH.current = 0;
    viewportH.current = 0;
    scrollableRef.current = false;
    lockedRef.current = true;
    setScrollLocked(true);
    drag.setValue(0);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [view, pulse, anim, drag]);

  // Ouvertures manuelles : pastille du Pilotage (consomme la semaine) et aperçu admin (ne consomme rien).
  useEffect(() => {
    openManually = (v, consume) => { setPreview(!consume); open(v); };
    return () => { openManually = null; };
  }, [open]);

  /* QUI A DROIT DE PARLER ? Le bilan mensuel et le pouls hebdo sont deux des cinq sollicitations
     possibles à l'ouverture (avec la clôture, le changement de profil et les succès). L'ordre est
     arbitré une fois pour toutes par lib/interruptQueue : ici on se contente de dire qu'on attend.

     L'ÉTAT DES LIEUX ARRIVE APRÈS LA CLÔTURE, pas le 1er du mois. Au 1er, l'utilisateur n'a encore
     rien vérifié : ni régularisation, ni solde à jour. Le bilan tombait donc sur des chiffres qu'il
     n'avait pas confirmés. On attend qu'il n'y ait PLUS AUCUN mois à clôturer.
     (Clôture désactivée en admin → on retombe sur l'ancien déclencheur, l'activité du mois.) */
  const monthSeen = seen.month === lastMonth || localSeen.current.month === lastMonth;
  const weekSeen = seen.week === currentWeek || localSeen.current.week === currentWeek;
  const closureSettled = !closureEnabled || pendingMonths.length === 0;
  /* « A vécu le mois » : une activité dans le mois, OU une clôture confirmée pour ce mois-là.
     Sans ce second cas, un compte créé en fin de mois précédent — trop peu de transactions pour
     que la première condition passe — ne voyait JAMAIS son bilan, alors qu'il venait précisément
     de clôturer ce mois : clôturer, c'est déjà l'avoir vécu. */
  const closedLastMonth = closures.some((c) => c.month_key === lastMonth && (c.status ?? 'confirmed') === 'confirmed');
  const livedLastMonth = pulse?.hadActivityLastMonth || closedLastMonth;

  /* DEUX VERROUS SE CUMULAIENT et rendaient le bilan mensuel inatteignable sur un compte récent :

     1. `judgedCount > 0` — en confiance BASSE (le cas de tout compte neuf : aucune vérification de
        solde derrière soi), le moteur passe TOUS les signaux en « estimé » et ne juge plus rien.
        judgedCount tombait donc à 0, et le bilan n'arrivait jamais. Or un bilan « estimé » a du
        sens : il récapitule le mois écoulé, il ne distribue pas des bons points. On exige donc
        seulement qu'il y ait des signaux À MONTRER.
     2. `oldEnough` (7 jours d'ancienneté) — cette règle protège le point HEBDO d'un compte créé le
        matin même. Elle n'a rien à faire ici : avoir clôturé un mois, c'est par définition l'avoir
        vécu. Le bilan mensuel se garde donc par `livedLastMonth`, pas par l'âge du compte. */
  const monthlyWants = !!canShowBase && !!pulse && !!config?.monthly && livedLastMonth
    && pulse.monthly.signals.length > 0 && !monthSeen && closureSettled;
  const weeklyWants = !!canShowBase && oldEnough && !!pulse && !!config?.weekly
    && pulse.weekly.judgedCount > 0 && !weekSeen;

  const monthlyTurn = useInterruptSlot('pulse_month', monthlyWants);
  // Le hebdo se tait tant qu'un mensuel est dû : deux bilans coup sur coup, c'est un de trop.
  const weeklyTurn = useInterruptSlot('pulse_week', weeklyWants && !monthlyWants);

  useEffect(() => {
    if (view || !pulse) return;
    if (monthlyTurn) { open('month'); return; }
    if (weeklyTurn) open('week');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthlyTurn, weeklyTurn, view, pulse, open]);

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
      // On archive CE QUI A ÉTÉ MONTRÉ : la vue mensuelle réordonnée, pas l'état des lieux générique.
      periodKind: 'month', periodKey: lastMonth,
      profileTier: pulse.profileId, result: pulse.monthly, wealth: pulse.wealth,
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

  /**
   * BALAYAGE VERS LE HAUT POUR FERMER, EN COHABITATION AVEC LE DÉFILEMENT DE LA LISTE.
   *
   * Le geste vertical est disputé entre la feuille (fermer) et la liste (défiler). Négocier via le
   * système de responder ne marche pas : un ScrollView natif qui défile ne rend JAMAIS la main, même
   * à un ancêtre en phase de capture — d'où l'impression de « ne bouger que la liste », et une
   * fermeture possible seulement sur les bords hors liste.
   *
   * On ne dispute donc plus rien : on VERROUILLE la liste (`scrollEnabled={false}`) dès qu'elle est
   * arrivée au bout — ou si elle tient entièrement à l'écran. Plus aucun concurrent : le balayage
   * vers le haut appartient à la feuille et la ferme, où qu'on pose le doigt, cartes comprises.
   * Au premier geste vers le BAS on redonne la main à la liste, qui reprend son défilement natif
   * (avec inertie) dès l'événement suivant ; elle se reverrouille en revenant au bout.
   */
  const [scrollLocked, setScrollLocked] = useState(true);
  const lockedRef = useRef(true);
  const scrollableRef = useRef(false);
  const lastOffset = useRef(0);
  const contentH = useRef(0);
  const viewportH = useRef(0);

  const setLocked = useCallback((next: boolean) => {
    if (lockedRef.current === next) return;
    lockedRef.current = next;
    setScrollLocked(next);
  }, []);
  const syncLock = useCallback(() => {
    // Pas encore mesuré → liste considérée courte (cas nominal d'une feuille qui tient à l'écran).
    const scrollable = viewportH.current > 0 && contentH.current > viewportH.current + 2;
    scrollableRef.current = scrollable;
    setLocked(!scrollable || lastOffset.current + viewportH.current >= contentH.current - 12);
  }, [setLocked]);

  /** À brancher sur chaque ScrollView de la feuille. */
  const scrollProbe = useMemo(() => ({
    scrollEnabled: !scrollLocked,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      lastOffset.current = e.nativeEvent.contentOffset.y;
      syncLock();
    },
    onContentSizeChange: (_w: number, h: number) => { contentH.current = h; syncLock(); },
    onLayout: (e: LayoutChangeEvent) => { viewportH.current = e.nativeEvent.layout.height; syncLock(); },
  }), [scrollLocked, syncLock]);

  /* Le PanResponder est mémoïsé une fois pour toutes : il ne verrait pas un changement de `view`.
     On lui donne donc une référence, toujours à jour. */
  const viewRef = useRef<PulseView | null>(null);
  viewRef.current = view;

  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => {
        if (Math.abs(g.dy) <= Math.abs(g.dx)) return false;
        if (!lockedRef.current) return false; // la liste défile : on ne lui prend rien
        // Geste vers le bas sur une liste verrouillée = « je veux remonter la liste » → on la
        // déverrouille et on décline ; elle prend le geste dès l'événement suivant.
        if (g.dy > 6) { if (scrollableRef.current) setLocked(false); return false; }
        return g.dy < -6;
      },
      // Zones hors liste (poignée, en-tête) : toujours actif, sans condition.
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -8 && Math.abs(g.dy) > Math.abs(g.dx),
      // Une fois le geste de fermeture engagé, la liste ne le récupère pas.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => { if (g.dy < 0) drag.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        // Même raison que le fond : le bilan mensuel ne part pas sur un geste réflexe. La feuille
        // suit quand même le doigt, puis revient en place — le geste est compris, mais sans effet.
        if (g.dy < -50 && viewRef.current !== 'month') close();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, tension: 80, friction: 9 }).start();
      },
    }),
    [drag, close, setLocked],
  );

  if (!view || !pulse) return null;

  const result: PulseResult = view === 'week' ? pulse.weekly : view === 'month' ? pulse.monthly : pulse.result;
  const info = PROFILE_INFO[pulse.profileId];
  const title = view === 'week' ? '🧭 Point de la semaine' : '🧭 État des lieux';
  /** Mois écoulé, en toutes lettres — celui que raconte le bilan mensuel. */
  const periodLabelMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  /* BILAN MENSUEL — ce qui va dans la CARTE UNIQUE, et ce qui garde sa propre carte.
     Les quatre repères du mois se lisent ensemble : les séparer en quatre cartes obligeait à
     dérouler pour reconstituer un récapitulatif. « Ton projet » et « Fin de mois » restent des
     cartes à part : ce sont des sujets, pas des chiffres du mois écoulé. */
  const monthLeadSignals = view === 'month'
    ? result.signals.filter((s) => MONTHLY_LEAD_IDS.includes(s.id))
    : [];
  const monthCardSignals = view === 'month'
    ? result.signals.filter((s) => !MONTHLY_LEAD_IDS.includes(s.id) && !MONTHLY_HIDDEN_IDS.includes(s.id))
    : result.signals;
  /* L'anneau mensuel montre une RÉPARTITION : il n'a de sens que s'il y a quelque chose à répartir.
     Le critère n'est donc plus la capacité du mois (celle de l'hebdo) mais la somme des trois
     gestes — sans elle, on afficherait un cercle vide occupant la moitié de la carte. */
  const monthRingShown = !!pulse
    && (pulse.monthlyStats.saved + pulse.monthlyStats.invested + pulse.monthlyStats.kept) > 0;
  // Les signaux décrivent TOUJOURS la situation d'aujourd'hui : le rendez-vous mensuel est un
  // point d'étape « au sortir du mois écoulé », pas une photo du mois passé — le libellé le dit.
  const period = view === 'week'
    ? weekRangeLabel(today)
    : view === 'month'
      ? new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      : today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* L'ÉTAT DES LIEUX DU MOIS ne se ferme QUE par la croix.
          C'est le seul rendez-vous qu'on ne revoit pas : il arrive une fois, après la clôture. Le
          refermer d'un tap à côté — le geste qu'on fait sans y penser en arrivant sur l'app — le
          faisait disparaître pour de bon. Le hebdo, lui, revient la semaine suivante : il garde le
          tap à côté et le balayage. */}
      <Pressable
        style={styles.backdrop}
        onPress={view === 'month' ? undefined : close}
        accessibilityRole={view === 'month' ? 'none' : 'button'}
        accessibilityLabel={view === 'month' ? undefined : 'Fermer'}
      />
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
            {/* Point HEBDO : pas de plage de dates en tête (redondante, alourdit le titre) — on
                ne montre la date que pour l'État des lieux mensuel / du jour. */}
            {view !== 'week' && <Text style={styles.period} numberOfLines={1}>· {period}</Text>}
          </View>
          <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={20} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        {view === 'week' ? (
          /* ── HEBDO : un POINT D'ÉTAPE visuel et compact — anneau épargné+investi, deux lignes,
                la série. Rien d'autre : pas de synthèse, pas de bouton, pas de note. ── */
          <>
            <ScrollView {...scrollProbe} showsVerticalScrollIndicator={false} style={[styles.list, { marginTop: 12 }]}>
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
              {...scrollProbe}
              style={[styles.list, { marginTop: 12 }]}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* BILAN DU MOIS — MÊME FORME QUE LE POINT DE LA SEMAINE.
                  Une SEULE carte : l'anneau (épargné + investi DU MOIS ÉCOULÉ) et, à côté, les
                  repères du mois en lignes compactes — dépenses variables, matelas de sécurité,
                  épargne, investissement. Quatre cartes séparées pour dire ce qui tient en un
                  coup d'œil transformaient un récapitulatif en liste à dérouler.
                  Seuls « Ton projet » et « Fin de mois » gardent leur carte : ce sont des sujets
                  à part entière, pas des chiffres du mois. */}
              {view === 'month' && monthLeadSignals.length > 0 && (
                <View style={[styles.weekCard, { marginBottom: 12 }]}>
                  <View style={styles.weekRow}>
                    {monthRingShown && <MonthlyRing stats={pulse.monthlyStats} COLORS={COLORS} />}
                    <View style={styles.weekStats}>
                      {monthLeadSignals.map((signal) => {
                        const color = pulseColor(COLORS, signal.status);
                        return (
                          <View key={signal.id} style={styles.weekStatRow}>
                            <View style={styles.weekStatHead}>
                              <View style={[styles.weekStatDot, { backgroundColor: color }]} />
                              <Text style={styles.weekStatLabel} numberOfLines={1}>
                                {signal.emoji} {MONTHLY_SHORT_LABELS[signal.id] ?? signal.label}
                              </Text>
                            </View>
                            <Text style={styles.weekStatSub} numberOfLines={2}>{signal.headline}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  {/* Les trois gestes du mois, ici et NULLE PART AILLEURS dans cette carte.
                      « Conservé » est affiché même à 0 € : c'est une information — ne rien avoir
                      mis de côté fait partie du bilan, l'omettre laisserait croire à un oubli. */}
                  {/* La période EN TÊTE de la légende : accrochée en fin de ligne, elle se
                      retrouvait rejetée à la ligne suivante et se lisait comme un quatrième poste. */}
                  <Text style={styles.legendPeriod}>En {periodLabelMonth}</Text>
                  <View style={[styles.weekLegend, { marginTop: 4 }]}>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.green }]} />
                    <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.saved)} mis de côté</Text>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.violet }]} />
                    <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.invested)} placés</Text>
                    <View style={[styles.legendDot, { backgroundColor: COLORS.blue }]} />
                    <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.kept)} conservés</Text>
                  </View>
                </View>
              )}
              {(view === 'month' ? monthCardSignals : result.signals).map((signal, index) => (
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
 * Les repères du mois écoulé, réunis dans UNE carte au format du point de la semaine.
 * Le matelas de sécurité y prend la place que « Fin de mois » occupe dans l'hebdo : une fois le
 * mois terminé, ce qui compte n'est plus ce qu'il reste à tenir, mais l'état de la réserve.
 */
/* Épargne et investissement N'Y FIGURENT PAS : l'anneau et sa légende les disent déjà, juste à
   côté — deux bandeaux de plus ne faisaient que répéter les mêmes montants. */
const MONTHLY_LEAD_IDS: PulseSignalId[] = ['spending', 'cushion'];

/**
 * Signaux ENTIÈREMENT couverts par l'anneau et sa légende : leur donner en plus une carte revenait
 * à répéter les mêmes montants trois fois dans le même écran.
 */
const MONTHLY_HIDDEN_IDS: PulseSignalId[] = ['saving', 'investing'];

const MONTHLY_SHORT_LABELS: Partial<Record<PulseSignalId, string>> = {
  spending: 'Dépenses variables',
  cushion: 'Matelas de sécurité',
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
/**
 * L'anneau du BILAN MENSUEL — différent de celui de la semaine, et volontairement.
 *
 * L'hebdo mesure un REMPLISSAGE : « où en es-tu de ta capacité du mois ? », d'où un pourcentage et
 * un anneau partiellement rempli. Le bilan mensuel, lui, regarde un mois TERMINÉ : il n'y a plus de
 * capacité à atteindre, seulement une répartition à lire. L'anneau fait donc le tour complet et se
 * partage entre les trois gestes — mis de côté, placé, conservé — chacun à sa part exacte.
 * Au centre : le total, puisque c'est lui que les trois parts composent.
 */
function MonthlyRing({ stats, COLORS }: { stats: PulseData['monthlyStats']; COLORS: AppColors }) {
  const size = 112;
  const strokeWidth = 11;
  const cx = size / 2;
  const r = (size - strokeWidth) / 2;
  const C = 2 * Math.PI * r;

  const parts = [
    { value: Math.max(0, stats.saved), color: COLORS.green },
    { value: Math.max(0, stats.invested), color: COLORS.violet },
    { value: Math.max(0, stats.kept), color: COLORS.blue },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0);
  // Un léger écart entre parts, seulement s'il y en a plusieurs (sinon on couperait un cercle plein).
  const gap = parts.length > 1 ? 3 : 0;

  let offset = 0;
  const arcs = parts.map((p, i) => {
    const len = Math.max(0, (C * p.value) / total - gap);
    const arc = { len, offset, color: p.color, key: i };
    offset += (C * p.value) / total;
    return arc;
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke={COLORS.cardBorder} strokeWidth={strokeWidth} />
        {arcs.map((a) => (
          <Circle
            key={a.key}
            cx={cx} cy={cx} r={r} fill="none"
            stroke={a.color} strokeWidth={strokeWidth}
            strokeDasharray={`${a.len} ${C - a.len}`}
            strokeDashoffset={-a.offset}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        ))}
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Text style={{ fontSize: 19, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 }}>{eurFmt(total)}</Text>
        <Text style={{ fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 12, maxWidth: 78 }}>
          non dépensés{'\n'}sur le mois
        </Text>
      </View>
    </View>
  );
}

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
    // Période du bilan : posée AU-DESSUS des trois montants, pas accrochée à leur suite.
    legendPeriod: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'capitalize', marginTop: 10 },
    weekFooter: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      marginTop: 12, paddingHorizontal: 2,
    },
    streakTxt: { fontSize: 12, color: c.textSecondary },

    footer: { fontSize: 10.5, color: c.textSecondary, textAlign: 'center', marginTop: 10 },
  });
}
