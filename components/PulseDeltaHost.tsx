/**
 * LE « LIVE ». Monté UNE fois au niveau racine : la réponse apparaît dès qu'une opération
 * est enregistrée, quel que soit l'écran d'où l'utilisateur a validé.
 *
 * Apparition IMMÉDIATE, remplissage sur place : la carte se montre à l'instant de la saisie avec
 * l'EFFET DIRECT (toujours exact : « Dépense : −100 € »), le Relyka en TIRET tant que les chiffres
 * recalculés ne sont pas sûrs, puis le solde de fin de mois. Tout se remplit dès que les refetchs
 * aboutissent : jamais de valeur PÉRIMÉE affichée, et aucun saut de mise en page.
 * Filet : si aucun refetch n'arrive (déjà frais / hors ligne), on complète avec le cache à 180 ms.
 *
 * FERMETURE : par la croix, en tapant la carte, en balayant vers le haut, ou en CHANGEANT DE PAGE.
 * Jamais toute seule. Elle disparaissait au bout de 5 s : le temps de lire les pastilles, puis la
 * ligne « fin de mois », puis le budget du quotidien, elle s'était volatilisée — et les chiffres
 * qu'elle attend (le Relyka recalculé) peuvent justement arriver APRÈS. On ne fait donc plus courser
 * l'utilisateur : c'est lui qui décide quand il a fini de lire.
 *
 * En contrepartie elle ne BLOQUE plus l'écran : plus d'attrape-taps plein écran (tolérable quand la
 * carte partait au bout de 5 s, inacceptable si elle reste). L'app dessous reste utilisable, et le
 * moindre changement de page emporte la carte.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, PanResponder, Platform, LayoutAnimation, type LayoutAnimationConfig } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useIsFetching } from '@tanstack/react-query';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { useAuth } from '../contexts/AuthContext';
import { useAllAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { usePulse, type PulseData } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { subscribePulseOp, type PulseOpEvent } from '../lib/pulseBus';
import { computeOpFeedback, consumesVariableEnvelope, type PulseFeedback, type PulseOp, type PulseTone } from '../lib/pulseDelta';

/**
 * Teinte d'une pastille de confirmation. Elle décrit le GESTE (de l'argent entre / sort, le compte
 * passerait dans le rouge) — ce n'est PAS un jugement de l'état des lieux, qui lui n'a plus ni
 * statut ni couleur. Clés SÉMANTIQUES du thème uniquement → suit le Style Editor.
 */
function toneColor(COLORS: AppColors, tone: PulseTone): string {
  const key = tone === 'positive' ? 'green'
    : tone === 'caution' ? 'orange'
    : tone === 'negative' ? 'danger'
    : 'blue';
  return COLORS[key] ?? COLORS.textSecondary;
}

/** Instantané du Pouls juste avant la saisie (pour mesurer ce qui a bougé). */
interface Pending {
  event: PulseOpEvent;
  before: PulseData | null;
  /** Un refetch a été observé depuis la saisie → une fois fini, les données sont FRAÎCHES. */
  sawRefetch: boolean;
  /** Filet : complète avec le cache même sans refetch observé (déjà frais / hors ligne). */
  forceFull: boolean;
}

/** Requêtes dont dépend le Pouls : on attend qu'elles soient revenues avant d'afficher. */
const WATCHED_QUERIES = new Set(['pilotage_data', 'transactions', 'accounts']);

/**
 * Délai maximal avant de remplir la carte avec le CACHE, quand les refetchs n'ont pas encore
 * abouti. Doit rester sous le seuil de perception (~200 ms) : au-delà, la carte paraît vide.
 */
const FILL_FALLBACK_MS = 180;

/** Transition douce quand la carte change de contenu/hauteur (tirets → valeurs). */
const SEAMLESS_LAYOUT: LayoutAnimationConfig = {
  duration: 260,
  create: { type: 'easeInEaseOut', property: 'opacity' },
  update: { type: 'easeInEaseOut' },
  delete: { type: 'easeInEaseOut', property: 'opacity' },
};

/** « au 1er août » — l'échéance que la ligne « Fin de mois » annonce. */
function firstOfNextMonthLabel(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `au 1er ${d.toLocaleDateString('fr-FR', { month: 'long' })}`;
}

/** Montant en euros, avec signe explicite pour un écart (`delta`). */
function eurSigned(n: number, withSign: boolean): string {
  const v = Math.round(n);
  const body = `${Math.abs(v).toLocaleString('fr-FR')} €`;
  if (!withSign) return v < 0 ? `−${body}` : body;
  return v < 0 ? `−${body}` : `+${body}`;
}

/** Empreinte du contenu AFFICHÉ → évite les re-rendus quand rien de visible n'a changé. */
function feedbackSignature(f: PulseFeedback): string {
  const eom = f.endOfMonth ? `eom:${f.endOfMonth.amount}:${f.endOfMonth.delta}` : '';
  const env = f.envelope ? `env:${f.envelope.remaining}:${f.envelope.initial}:${f.envelope.used}` : '';
  return f.chips.map((c) => `${c.key}:${c.text}:${c.tone}`).join('|') + '#' + eom + '#' + env;
}

export default function PulseDeltaHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: config } = usePulseConfig();
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const pulse = usePulse();
  const pathname = usePathname();
  const fetching = useIsFetching({ predicate: (q) => WATCHED_QUERIES.has(String(q.queryKey[0])) });

  const [feedback, setFeedback] = useState<PulseFeedback | null>(null);
  // L'opération ACTUELLEMENT affichée : conservée tant que la carte est visible → on la RECALCULE
  // à chaque arrivée de données fraîches (le refetch peut aboutir juste après le 1er affichage).
  const active = useRef<Pending | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Page sur laquelle la carte est apparue : en changer, c'est passer à autre chose. */
  const pathAtOpen = useRef<string | null>(null);

  // Valeurs vivantes, lues sans re-souscrire (l'abonnement au bus reste monté une fois).
  const pulseRef = useRef<PulseData | null>(null);
  pulseRef.current = pulse;
  const fetchingRef = useRef(0);
  fetchingRef.current = fetching;
  const accountsRef = useRef<any[]>(accounts);
  accountsRef.current = accounts;
  const categoriesRef = useRef<any[]>(categories);
  categoriesRef.current = categories;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  const liveEnabled = !!config?.enabled && !!config?.live;

  const clearTimers = useCallback(() => {
    if (fallbackTimer.current) { clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
  }, []);

  /** Événement → opération jugeable : c'est ici qu'on résout les TYPES de comptes et de catégories
   *  (l'hôte les a déjà en cache ; les mutations n'ont pas à aller les chercher). */
  const toOp = useCallback((event: PulseOpEvent): PulseOp => {
    const typeOf = (id?: string) =>
      id ? (accountsRef.current.find((a: any) => a.id === id)?.type as string | undefined) : undefined;
    const accountType = typeOf(event.accountId);
    // Consomme l'enveloppe variable ? Règle PARTAGÉE avec le patch optimiste (cf. lib/pulseDelta).
    const category = event.categoryId
      ? categoriesRef.current.find((c: any) => c.id === event.categoryId)
      : null;
    const hitsVariableEnvelope = consumesVariableEnvelope({
      kind: event.kind,
      accountType,
      isRecurring: event.isRecurring,
      projectId: event.projectId,
      categoryId: event.categoryId,
      categoryType: category?.type ?? null,
    });
    return {
      kind: event.kind,
      amount: event.amount,
      accountType,
      fromType: typeOf(event.fromAccountId),
      toType: typeOf(event.toAccountId),
      isFuture: event.isFuture,
      date: event.date,
      regulCovered: event.regulCovered,
      hitsVariableEnvelope,
    };
  }, []);

  /** (Re)calcule le retour de l'opération `p`. Tant que les données ne sont pas FRAÎCHES (aucun
   *  refetch abouti depuis la saisie), on passe `after = null` : la carte n'affiche que l'effet
   *  direct — toujours exact — plutôt qu'un Relyka / signal PÉRIMÉS calculés sur l'état d'avant. */
  const renderFor = useCallback((p: Pending) => {
    const fresh = (p.forceFull || p.sawRefetch) && fetchingRef.current === 0 ? pulseRef.current : null;
    // Fin de mois : on ne remplace l'estimation que par un solde VRAIMENT recalculé — un refetch
    // ABOUTI depuis la saisie. Jamais le cache du filet (`forceFull`, 180 ms) : à cet instant les
    // invalidations n'ont souvent pas encore eu lieu, et on annoncerait « inchangé » sur des
    // données d'avant la saisie.
    const settled = p.sawRefetch && fetchingRef.current === 0 ? pulseRef.current : null;
    const next = computeOpFeedback(
      toOp(p.event),
      p.before?.relyka ?? null,
      fresh?.relyka ?? null,
      // Fin de mois : ESTIMÉE par arithmétique depuis l'instantané d'AVANT (donc affichée tout de
      // suite, sans tirets ni saut de hauteur), puis remplacée par le solde RECALCULÉ dès qu'il est
      // frais — le seul juste dans tous les cas de saisie (cf. lib/pulseDelta).
      p.before
        ? {
            before: p.before.endOfMonthBalance,
            after: settled?.endOfMonthBalance ?? null,
            margin: settled?.safetyMargin ?? p.before.safetyMargin,
            // Enveloppe d'AVANT la saisie : la carte montre elle-même ce que l'opération vient d'y
            // prendre. Reprendre le restant recalculé ferait disparaître la soustraction sous les yeux.
            variableEnvelopeRemaining: p.before.variableEnvelopeRemaining,
            variableEnvelopeInitial: p.before.variableEnvelopeInitial,
          }
        : undefined,
    );
    setFeedback((prev) => {
      // Rien n'a changé (renderFor est appelé à chaque vague de refetch) → on NE re-rend PAS :
      // c'était une source de clignotement gratuit.
      if (prev && feedbackSignature(prev) === feedbackSignature(next)) return prev;
      // Le contenu change (tirets → valeurs, pastille ajoutée…) : la carte grandit. On anime la
      // transition de mise en page pour que ça GLISSE au lieu d'apparaître d'un bloc.
      if (prev) LayoutAnimation.configureNext(SEAMLESS_LAYOUT);
      return next;
    });
  }, [toOp]);

  // Abonnement au bus (monté une fois) : la carte apparaît IMMÉDIATEMENT (effet direct), puis
  // s'enrichit (Relyka + signal) quand les refetchs aboutissent.
  useEffect(() => {
    if (!liveEnabled) return;
    return subscribePulseOp((event) => {
      clearTimers();
      const p: Pending = { event, before: pulseRef.current, sawRefetch: false, forceFull: false };
      active.current = p;
      // La page d'ARRIVÉE fait référence : les écrans de saisie rendent la main (router.back) AVANT
      // que l'insert n'aboutisse, donc au moment où la carte s'ouvre on est déjà sur l'écran final.
      pathAtOpen.current = pathnameRef.current;
      renderFor(p);
      drag.setValue(0);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 11 }).start();
      // Filet : les refetchs n'ont pas abouti à temps (ou aucun n'a démarré : données déjà fraîches,
      // hors ligne…) → on compose la carte avec le cache. Si des données plus fraîches arrivent
      // ensuite, l'effet ci-dessous la recalcule (et la transition est animée).
      //
      // ⚠️ 600 ms était trop long : sur mobile en production, la carte s'ouvrait instantanément mais
      // restait remplie de tirets assez longtemps pour qu'on la croie vide — on tapait à côté avant
      // d'avoir lu quoi que ce soit. À 180 ms l'attente est imperceptible, et on garde l'intention
      // d'origine (ne pas afficher un chiffre périmé si les données fraîches arrivent tout de suite).
      fallbackTimer.current = setTimeout(() => {
        if (active.current === p) { p.forceFull = true; renderFor(p); }
      }, FILL_FALLBACK_MS);
    });
  }, [liveEnabled, renderFor, anim, drag, clearTimers]);

  // Chaque fois que l'état des requêtes ou le Pouls bouge : marquer le refetch observé, et
  // RECALCULER la carte visible avec les données fraîches (« rien de placé » → « 100 € placés »).
  useEffect(() => {
    const p = active.current;
    if (!p) return;
    if (fetchingRef.current > 0) { p.sawRefetch = true; return; }
    renderFor(p);
  }, [fetching, pulse, renderFor]);

  // Nettoyage à la dépose (déconnexion, etc.).
  useEffect(() => () => clearTimers(), [clearTimers]);

  const dismiss = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        setFeedback(null);
        active.current = null;
        pathAtOpen.current = null;
        clearTimers();
        drag.setValue(0);
      });
  }, [anim, drag, clearTimers]);
  // Référence vivante : `dismiss` est appelé depuis des effets montés avant sa définition.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  /* CHANGER DE PAGE, C'EST PASSER À AUTRE CHOSE. La carte ne part plus toute seule : sans ce
     garde-fou, elle suivrait l'utilisateur d'écran en écran en parlant d'une opération qu'il a
     déjà oubliée. On compare à la page d'ARRIVÉE mémorisée à l'ouverture (cf. pathAtOpen), pas à
     celle de la saisie — l'écran de saisie a déjà rendu la main quand la carte apparaît. */
  useEffect(() => {
    if (!feedback || pathAtOpen.current == null) return;
    if (pathname !== pathAtOpen.current) dismissRef.current();
  }, [pathname, feedback]);

  // Balayage vers le HAUT → on referme (la carte repart par où elle est venue).
  const panResponder = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy < 0) drag.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -40) dismiss();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, tension: 80, friction: 9 }).start();
      },
    }),
    [drag, dismiss],
  );

  if (!feedback) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* AUCUN attrape-taps plein écran : la carte reste tant qu'on ne la ferme pas, elle ne doit
          donc pas geler l'app derrière elle. Seule la carte elle-même reçoit les gestes.
          Wrapper centré : sur web desktop, la carte reste à largeur « mobile » au centre
          (le host est monté HORS de la colonne d'app — cf. sheetWidth dans lib/appLayout). */}
      <View style={[styles.center, { top: insets.top + 58 }]} pointerEvents="box-none">
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.card,
          {
            opacity: anim,
            transform: [
              { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }), drag) },
            ],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>C’est enregistré 🧭</Text>
          <Pressable onPress={dismiss} hitSlop={14} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={19} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.chips}>
          {feedback.chips.map((chip) => {
            const color = toneColor(COLORS, chip.tone);
            return (
              <View key={chip.key} style={[styles.chip, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
                <Text style={[styles.chipText, { color }]}>{chip.text}</Text>
              </View>
            );
          })}
        </View>

        {/* BUDGET DU QUOTIDIEN — CE QUI A BOUGÉ.
            Une dépense du quotidien ne déplace ni le Relyka ni la fin de mois : elle était déjà
            provisionnée dans l'enveloppe variable. Juste, mais déroutant — on saisit, et rien ne
            change à l'écran. On montre donc l'enveloppe : elle, elle a bougé, et le Relyka stable
            devient la conséquence lisible d'un budget respecté plutôt qu'un doute sur la saisie. */}
        {!!feedback.envelope && (() => {
          const env = feedback.envelope;
          const pct = Math.max(0, Math.min(1, env.remaining / Math.max(1, env.initial)));
          const color = env.overflow > 0 ? toneColor(COLORS, 'caution') : toneColor(COLORS, 'positive');
          return (
            <View style={[styles.env, { borderColor: color + '55', backgroundColor: color + '14' }]}>
              <Text style={styles.envText}>
                🛒 Budget du quotidien : <Text style={[styles.envValue, { color }]}>{eurSigned(env.remaining, false)}</Text>
                {' '}restants ce mois sur {eurSigned(env.initial, false)}
              </Text>
              <View style={styles.envTrack}>
                <View style={[styles.envFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
              </View>
              <Text style={styles.envHint}>
                {env.absorbed
                  ? `Ces ${eurSigned(env.used, false)} y étaient déjà prévus : ton Relyka ne bouge pas.`
                  : `Ces ${eurSigned(env.used, false)} dépassent de ${eurSigned(env.overflow, false)} ce qu’il te restait — c’est cette part qui creuse ta fin de mois.`}
              </Text>
            </View>
          );
        })()}

        {/* FIN DE MOIS — affichée SANS attendre : estimation arithmétique immédiate, puis solde
            recalculé (cf. lib/pulseDelta).
            Ligne affichée dès que l'opération CONCERNE ce solde (mois courant, compte courant), même
            si l'écart est nul : c'est le cas d'une dépense variable déjà provisionnée ou d'une
            opération comprise dans la régularisation du jour — le solde reste l'info attendue, seul
            le « (−X €) » disparaît, parce que rien n'a bougé. */}
        {!!feedback.endOfMonth && feedback.endOfMonth.concerns && (() => {
          const eom = feedback.endOfMonth;
          const tone: PulseTone = eom.negative ? 'negative' : eom.belowMargin ? 'caution' : 'positive';
          const color = toneColor(COLORS, tone);
          const moved = Math.round(eom.delta) !== 0;
          return (
            <View style={[styles.eom, { borderColor: color + '55', backgroundColor: color + '14' }]}>
              {/* Une PHRASE, pas deux colonnes de chiffres : on dit ce que le solde sera, quand, et
                  sur quoi (les comptes COURANTS — l'épargne n'est pas dedans). */}
              <Text style={styles.eomText}>
                🗓️ {firstOfNextMonthLabel()}, tu devrais avoir{' '}
                <Text style={[styles.eomValue, { color }]}>{eurSigned(eom.amount, false)}</Text>
                {' '}sur tes comptes courants
                {moved
                  ? <Text style={styles.eomDelta}> ({eurSigned(eom.delta, true)})</Text>
                  : <Text style={styles.eomDelta}> — inchangé par cette opération</Text>}
              </Text>
            </View>
          );
        })()}

        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Fermer">
          <Text style={styles.hint}>Balaie vers le haut ou tape ici pour fermer</Text>
          <View style={styles.grabber} />
        </Pressable>
      </Animated.View>
      </View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, zIndex: 60, elevation: 60 },
    center: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
    card: {
      width: '100%', maxWidth: 560,
      backgroundColor: c.cardSolid, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 20, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
        android: { elevation: 12 },
        default: { boxShadow: '0 8px 24px rgba(0,0,0,0.22)' } as any,
      }),
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    title: { flex: 1, fontSize: 15, fontWeight: '800', color: c.text },
    closeBtn: { padding: 2, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { fontSize: 12.5, fontWeight: '800' },

    // Ligne « Fin de mois » : une seule ligne, pas une carte — elle complète les pastilles sans
    // rallonger la confirmation.
    eom: {
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10,
    },
    // Ligne « Budget du quotidien » : le chiffre qu'une dépense variable déplace RÉELLEMENT.
    env: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10 },
    envText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, lineHeight: 18 },
    envValue: { fontSize: 14, fontWeight: '800' },
    envTrack: { height: 5, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 8, overflow: 'hidden' },
    envFill: { height: '100%', borderRadius: 999 },
    envHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15, marginTop: 6 },

    eomText: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, lineHeight: 18 },
    eomValue: { fontSize: 14, fontWeight: '800' },
    eomDelta: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
    hint: { fontSize: 10.5, color: c.textSecondary, marginTop: 14, textAlign: 'center' },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 8 },
  });
}
