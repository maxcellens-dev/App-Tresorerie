/**
 * L'ÉTAT DES LIEUX — le rendez-vous. Monté UNE fois au niveau racine.
 *
 * UN SEUL RENDEZ-VOUS : le bilan du mois écoulé, qui s'ouvre seul une fois toutes les clôtures
 * faites. (Le « point de la semaine » a été retiré : deux bilans, c'en était un de trop.)
 * Il peut aussi être ouvert à la demande — clôture mensuelle, aperçu admin — via `openPulse()`.
 *
 * ⚠️ AUCUNE COULEUR D'ÉTAT : le bilan donne une vision d'un mois, il ne juge pas (cf. pulseEngine).
 * FERMETURE : par la croix uniquement (c'est le seul rendez-vous qu'on ne revoit pas).
 * GARDE-FOUS : jamais avant la fin du splash, pendant le guide, en consultation admin,
 * ni tant qu'aucun signal n'est calculé.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing, Pressable, PanResponder, Platform,
  useWindowDimensions,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { useAuth } from '../../contexts/AuthContext';
import { useGuide } from '../../contexts/GuideContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import type { AppColors } from '../../theme/palette';
import { usePulse, type PulseData } from '../../hooks/pulse/usePulse';
import { usePulseConfig } from '../../hooks/pulse/usePulseConfig';
import { usePulseSeen, useSavePulseSnapshot, type PulseSeenState } from '../../hooks/pulse/usePulseState';
import { useMonthlyClosure } from '../../hooks/pilotage/useMonthlyClosure';
import { useInterruptSlot } from '../../hooks/engagement/useInterruptSlot';
import { isAppReady, onAppReady } from '../../lib/platform/splashGate';
import { PROFILE_INFO } from '../../lib/finance/financialProfileEngine';
import { monthKey, type PulseSignalId } from '../../lib/pulse/pulseEngine';
import PulseSignalCard from './PulseSignalCard';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';

/**
 * Ouverture manuelle (fin de clôture mensuelle, aperçu admin).
 * `consume: false` → rien n'est marqué vu ni archivé (aperçu admin).
 */
let openManually: ((consume: boolean) => void) | null = null;
export function openPulse(consume = true): void {
  openManually?.(consume);
}

export default function PulseHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const segments = useSegments();
  const { user, isImpersonating } = useAuth();

  const { data: config } = usePulseConfig();
  const pulse = usePulse();
  const { seen, isLoading: seenLoading, markSeen } = usePulseSeen(user?.id);
  // L'état des lieux attend que les clôtures soient faites (cf. l'effet d'auto-ouverture).
  const { enabled: closureEnabled, pendingMonths, closures } = useMonthlyClosure(user?.id);
  const saveSnapshot = useSavePulseSnapshot();

  const [open_, setOpen] = useState(false);
  /** Aperçu (admin) : à la fermeture, rien n'est marqué vu ni archivé. */
  const [preview, setPreview] = useState(false);
  /**
   * Mois consommé CETTE session, tenu en local et synchrone : le `markSeen` serveur est
   * asynchrone — sans ce garde, l'effet d'auto-ouverture relisait l'ancien « vu » juste après une
   * fermeture et rouvrait le bilan dans la foulée.
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
  const lastMonth = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const inTabs = segments[0] === '(tabs)';

  const canShow = appReady && inTabs && !isImpersonating && !seenLoading
    && !!config?.enabled && !!pulse;

  // `show` pose seulement l'état : l'animation d'entrée est pilotée par l'effet ci-dessous, qui
  // attend que les DONNÉES soient là.
  const show = useCallback(() => { setOpen(true); }, []);

  const animated = useRef(false);
  useEffect(() => {
    if (!open_) { animated.current = false; return; }
    if (!pulse || animated.current) return;
    animated.current = true;
    // Nouvelle ouverture = nouvelle liste : on repart d'une mesure vierge (onLayout /
    // onContentSizeChange la refont immédiatement au montage).
    lastOffset.current = 0;
    contentH.current = 0;
    viewportH.current = 0;
    scrollableRef.current = false;
    lockedRef.current = true;
    setScrollLocked(true);
    drag.setValue(0);
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.cubic) }).start();
  }, [open_, pulse, anim, drag]);

  // Ouvertures manuelles : fin de clôture (consomme) et aperçu admin (ne consomme rien).
  useEffect(() => {
    openManually = (consume) => { setPreview(!consume); show(); };
    return () => { openManually = null; };
  }, [show]);

  /* QUI A DROIT DE PARLER ? Le bilan mensuel est l'une des sollicitations possibles à l'ouverture
     (avec la clôture, le changement de profil et les succès). L'ordre est arbitré une fois pour
     toutes par lib/interruptQueue : ici on se contente de dire qu'on attend.

     L'ÉTAT DES LIEUX ARRIVE APRÈS LA CLÔTURE, pas le 1er du mois. Au 1er, l'utilisateur n'a encore
     rien vérifié : ni régularisation, ni solde à jour. Le bilan tombait donc sur des chiffres qu'il
     n'avait pas confirmés. On attend qu'il n'y ait PLUS AUCUN mois à clôturer.
     (Clôture désactivée en admin → on retombe sur l'ancien déclencheur, l'activité du mois.) */
  const monthSeen = seen.month === lastMonth || localSeen.current.month === lastMonth;
  const closureSettled = !closureEnabled || pendingMonths.length === 0;
  /* « A vécu le mois » : une activité dans le mois, OU une clôture confirmée pour ce mois-là.
     Sans ce second cas, un compte créé en fin de mois précédent — trop peu de transactions pour
     que la première condition passe — ne voyait JAMAIS son bilan, alors qu'il venait précisément
     de clôturer ce mois : clôturer, c'est déjà l'avoir vécu. */
  const closedLastMonth = closures.some((c) => c.month_key === lastMonth && (c.status ?? 'confirmed') === 'confirmed');
  const livedLastMonth = pulse?.hadActivityLastMonth || closedLastMonth;

  /* On n'exige QUE des signaux à montrer : un bilan « estimé » (compte récent, solde jamais
     vérifié) a du sens — il récapitule le mois écoulé. L'ancienneté du compte n'entre pas non
     plus en jeu : avoir clôturé un mois, c'est par définition l'avoir vécu. */
  /* Le PARCOURS DE DÉMARRAGE passe avant tout le reste — il n'est pas dans la file, il la précède.
     Un compte encore en installation n'a pas de mois écoulé à raconter, et le bilan viendrait se
     poser par-dessus l'étape en cours. */
  const guide = useGuide();
  const wants = !!canShow && !!pulse && !!config?.monthly && livedLastMonth
    && pulse.monthly.signals.length > 0 && !monthSeen && closureSettled && !guide.active;

  const turn = useInterruptSlot('pulse_month', wants);

  useEffect(() => {
    if (open_ || !pulse) return;
    if (turn) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, open_, pulse, show]);

  /** Consomme le mois affiché : marqué vu + bilan archivé tel qu'il a été montré. */
  const consume = useCallback(() => {
    if (preview || !pulse) return;
    localSeen.current.month = lastMonth;
    markSeen.mutate({ month: lastMonth });
    saveSnapshot.mutate({
      periodKey: lastMonth,
      profileTier: pulse.profileId,
      result: pulse.monthly,
      wealth: pulse.wealth,
    });
  }, [preview, pulse, lastMonth, markSeen, saveSnapshot]);

  const close = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        consume();
        setOpen(false);
        setPreview(false);
        drag.setValue(0);
      });
  }, [anim, drag, consume]);

  /**
   * BALAYAGE VERS LE HAUT, EN COHABITATION AVEC LE DÉFILEMENT DE LA LISTE.
   *
   * Le geste vertical est disputé entre la feuille et la liste. Négocier via le système de
   * responder ne marche pas : un ScrollView natif qui défile ne rend JAMAIS la main, même à un
   * ancêtre en phase de capture. On VERROUILLE donc la liste (`scrollEnabled={false}`) dès qu'elle
   * est arrivée au bout — ou si elle tient entièrement à l'écran. Au premier geste vers le BAS on
   * redonne la main à la liste, qui reprend son défilement natif ; elle se reverrouille au bout.
   *
   * ⚠️ Le balayage ne FERME PAS le bilan : c'est le seul rendez-vous qu'on ne revoit pas, il ne
   * doit pas partir sur un geste réflexe. La feuille suit le doigt puis revient en place.
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

  /** À brancher sur le ScrollView de la feuille. */
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
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => { if (g.dy < 0) drag.setValue(g.dy); },
      onPanResponderRelease: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, tension: 80, friction: 9 }).start();
      },
    }),
    [drag, setLocked],
  );

  if (!open_ || !pulse) return null;

  const result = pulse.monthly;
  // Filet : `usePulse` résout déjà l'identifiant, mais aucun écran ne doit tomber sur un profil inconnu.
  const info = PROFILE_INFO[pulse.profileId] ?? PROFILE_INFO.P0;
  /** Mois écoulé, en toutes lettres — celui que raconte le bilan. */
  const periodLabel = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  /* CE QUI VA DANS LA CARTE UNIQUE, ET CE QUI GARDE SA PROPRE CARTE.
     Les repères du mois se lisent ensemble : les séparer en cartes obligeait à dérouler pour
     reconstituer un récapitulatif. Les autres signaux (projet, fin de mois, patrimoine, série)
     restent des cartes à part : ce sont des sujets, pas des chiffres du mois écoulé. */
  const leadSignals = result.signals.filter((s) => LEAD_IDS.includes(s.id));
  const cardSignals = result.signals.filter((s) => !LEAD_IDS.includes(s.id));
  /* L'anneau montre une RÉPARTITION : il n'a de sens que s'il y a quelque chose à répartir.
     Sans ça, on afficherait un cercle vide occupant la moitié de la carte. */
  const ringShown = (pulse.monthlyStats.saved + pulse.monthlyStats.invested + pulse.monthlyStats.kept) > 0;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* L'ÉTAT DES LIEUX ne se ferme QUE par la croix. C'est le seul rendez-vous qu'on ne revoit
          pas : il arrive une fois, après la clôture. Le refermer d'un tap à côté — le geste qu'on
          fait sans y penser en arrivant sur l'app — le faisait disparaître pour de bon. */}
      <Pressable style={styles.backdrop} accessibilityRole="none" />
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

          {/* Titre + mois sur la MÊME ligne : « État des lieux · juillet 2026 ». */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>🧭 État des lieux</Text>
              <Text style={styles.period} numberOfLines={1}>· {periodLabel}</Text>
            </View>
            <Pressable onPress={close} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.summary}>
            <Text style={styles.profile} numberOfLines={1}>{info.emoji} {info.name}</Text>
          </View>

          {/* Chiffres non confirmés : on le DIT, plutôt que de faire semblant. */}
          {result.estimated && (
            <Text style={styles.estimated}>
              Chiffres indicatifs : ton solde n’a pas été vérifié récemment.
            </Text>
          )}

          <ScrollView
            {...scrollProbe}
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {/* RÉCAPITULATIF DU MOIS — une SEULE carte : l'anneau (mis de côté + placé + conservé
                DU MOIS ÉCOULÉ) et, à côté, les repères du mois en lignes compactes. */}
            {leadSignals.length > 0 && (
              <View style={[styles.leadCard, { marginBottom: 12 }]}>
                <View style={styles.leadRow}>
                  {ringShown && <MonthlyRing stats={pulse.monthlyStats} COLORS={COLORS} />}
                  <View style={styles.leadStats}>
                    {leadSignals.map((signal) => (
                      <View key={signal.id} style={styles.leadStatRow}>
                        <Text style={styles.leadStatLabel} numberOfLines={1}>
                          {signal.emoji} {LEAD_SHORT_LABELS[signal.id] ?? signal.label}
                        </Text>
                        <Text style={styles.leadStatSub} numberOfLines={2}>{signal.headline}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                {/* Les trois gestes du mois, ici et NULLE PART AILLEURS dans cette carte.
                    « Conservé » est affiché même à 0 € : c'est une information — ne rien avoir
                    mis de côté fait partie du bilan, l'omettre laisserait croire à un oubli.
                    La période EN TÊTE de la légende : accrochée en fin de ligne, elle se
                    retrouvait rejetée à la ligne suivante et se lisait comme un quatrième poste. */}
                <Text style={styles.legendPeriod}>En {periodLabel}</Text>
                <View style={styles.legend}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.green }]} />
                  <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.saved)} mis de côté</Text>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.violet }]} />
                  <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.invested)} placés</Text>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.blue }]} />
                  <Text style={styles.legendTxt}>{eurFmt(pulse.monthlyStats.kept)} conservés</Text>
                </View>
              </View>
            )}
            {cardSignals.map((signal, index) => (
              <PulseSignalCard key={signal.id} signal={signal} delay={120 + index * 90} />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

const eurFmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

/**
 * Les deux repères du mois écoulé, réunis dans UNE carte avec l'anneau. Épargne et investissement
 * n'y figurent pas comme lignes : l'anneau et sa légende les disent déjà, juste à côté.
 */
const LEAD_IDS: PulseSignalId[] = ['spending', 'cushion'];

const LEAD_SHORT_LABELS: Partial<Record<PulseSignalId, string>> = {
  spending: 'Dépenses variables',
  cushion: 'Matelas de sécurité',
};

/**
 * L'ANNEAU DU BILAN — une RÉPARTITION, pas un remplissage.
 *
 * Le mois est TERMINÉ : il n'y a plus de capacité à atteindre, seulement une répartition à lire.
 * L'anneau fait donc le tour complet et se partage entre les trois gestes — mis de côté, placé,
 * conservé — chacun à sa part exacte. Au centre : le total, puisque c'est lui que les trois parts
 * composent. (Les trois teintes sont celles des CATÉGORIES épargne / investissement / réservé dans
 * toute l'app — une légende, pas un jugement.)
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
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
        <Text style={{ fontSize: 19, fontWeight: '800', color: COLORS.text, letterSpacing: -0.5 }}>{eurFmt(total)}</Text>
        <Text style={{ fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 12, maxWidth: 78 }}>
          non dépensés{'\n'}sur le mois
        </Text>
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { ...StyleSheet.absoluteFill, zIndex: 55, elevation: 55 },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
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
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginTop: 12, marginBottom: 4, paddingVertical: 9, paddingHorizontal: 12,
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder,
    },
    profile: { flex: 1, fontSize: 12.5, fontWeight: '700', color: c.text },
    estimated: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 8, fontStyle: 'italic' },
    list: { flexGrow: 0, marginTop: 12 },

    // ── Carte de récapitulatif (anneau + repères du mois) ──
    leadCard: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 18, padding: 14,
    },
    leadRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    leadStats: { flex: 1, gap: 10, minWidth: 0 },
    leadStatRow: {
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 13, paddingVertical: 9, paddingHorizontal: 11,
    },
    leadStatLabel: { fontSize: 12.5, fontWeight: '700', color: c.text },
    leadStatSub: { fontSize: 11, color: c.textSecondary, marginTop: 3, lineHeight: 15 },
    legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
    legendDot: { width: 8, height: 8, borderRadius: 999 },
    legendTxt: { fontSize: 11, fontWeight: '600', color: c.text, marginRight: 6 },
    // Période du bilan : posée AU-DESSUS des trois montants, pas accrochée à leur suite.
    legendPeriod: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'capitalize', marginTop: 10 },
  });
}
