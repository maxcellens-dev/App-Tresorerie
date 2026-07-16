/**
 * POULS — le « live ». Monté UNE fois au niveau racine : la réponse apparaît dès qu'une opération
 * est enregistrée, quel que soit l'écran d'où l'utilisateur a validé.
 *
 * Apparition IMMÉDIATE, enrichissement progressif : la carte se montre à l'instant de la saisie
 * avec l'EFFET DIRECT (toujours exact : « Dépense : −100 € ») — c'est la confirmation visuelle
 * instantanée. Le Relyka et le signal impacté, qui dépendent des données recalculées, s'ajoutent
 * dès que les refetchs aboutissent (jamais de valeur PÉRIMÉE affichée : tant que les données
 * fraîches ne sont pas là, ces éléments sont simplement absents — pas faux).
 * Filet : si aucun refetch n'arrive (déjà frais / hors ligne), on complète avec le cache à 1,5 s.
 *
 * Fermeture : au tap (n'importe où) ou en balayant vers le haut. JAMAIS d'auto-disparition.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, PanResponder, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFetching } from '@tanstack/react-query';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { useAuth } from '../contexts/AuthContext';
import { useAllAccounts } from '../hooks/useAccounts';
import { usePulse, type PulseData } from '../hooks/usePulse';
import { usePulseConfig } from '../hooks/usePulseConfig';
import { subscribePulseOp, type PulseOpEvent } from '../lib/pulseBus';
import { computeOpFeedback, type PulseFeedback, type PulseOp } from '../lib/pulseDelta';
import PulseSignalCard, { pulseColor } from './PulseSignalCard';

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

export default function PulseDeltaHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: config } = usePulseConfig();
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const pulse = usePulse();
  const fetching = useIsFetching({ predicate: (q) => WATCHED_QUERIES.has(String(q.queryKey[0])) });

  const [feedback, setFeedback] = useState<PulseFeedback | null>(null);
  // L'opération ACTUELLEMENT affichée : conservée tant que la carte est visible → on la RECALCULE
  // à chaque arrivée de données fraîches (le refetch peut aboutir juste après le 1er affichage).
  const active = useRef<Pending | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Valeurs vivantes, lues sans re-souscrire (l'abonnement au bus reste monté une fois).
  const pulseRef = useRef<PulseData | null>(null);
  pulseRef.current = pulse;
  const fetchingRef = useRef(0);
  fetchingRef.current = fetching;
  const accountsRef = useRef<any[]>(accounts);
  accountsRef.current = accounts;

  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  const liveEnabled = !!config?.enabled && !!config?.live;

  const clearTimers = useCallback(() => {
    if (fallbackTimer.current) { clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
  }, []);

  /** Événement → opération jugeable : c'est ici qu'on résout les TYPES de comptes. */
  const toOp = useCallback((event: PulseOpEvent): PulseOp => {
    const typeOf = (id?: string) =>
      id ? (accountsRef.current.find((a: any) => a.id === id)?.type as string | undefined) : undefined;
    return {
      kind: event.kind,
      amount: event.amount,
      accountType: typeOf(event.accountId),
      fromType: typeOf(event.fromAccountId),
      toType: typeOf(event.toAccountId),
      isFuture: event.isFuture,
    };
  }, []);

  /** (Re)calcule le retour de l'opération `p`. Tant que les données ne sont pas FRAÎCHES (aucun
   *  refetch abouti depuis la saisie), on passe `after = null` : la carte n'affiche que l'effet
   *  direct — toujours exact — plutôt qu'un Relyka / signal PÉRIMÉS calculés sur l'état d'avant. */
  const renderFor = useCallback((p: Pending) => {
    const fresh = (p.forceFull || p.sawRefetch) && fetchingRef.current === 0 ? pulseRef.current : null;
    setFeedback(
      computeOpFeedback(
        toOp(p.event),
        p.before?.live ?? null,
        fresh?.live ?? null,
        p.before?.relyka ?? null,
        fresh?.relyka ?? null,
      ),
    );
  }, [toOp]);

  // Abonnement au bus (monté une fois) : la carte apparaît IMMÉDIATEMENT (effet direct), puis
  // s'enrichit (Relyka + signal) quand les refetchs aboutissent.
  useEffect(() => {
    if (!liveEnabled) return;
    return subscribePulseOp((event) => {
      clearTimers();
      const p: Pending = { event, before: pulseRef.current, sawRefetch: false, forceFull: false };
      active.current = p;
      renderFor(p);
      drag.setValue(0);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 11 }).start();
      // Filet : aucun refetch observé (données déjà fraîches, hors ligne…) → compléter avec le cache.
      fallbackTimer.current = setTimeout(() => {
        if (active.current === p) { p.forceFull = true; renderFor(p); }
      }, 1500);
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
        clearTimers();
        drag.setValue(0);
      });
  }, [anim, drag, clearTimers]);

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
      {/* Tap n'importe où → on referme. Non bloquant : rien n'est modal. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Fermer" />
      {/* Wrapper centré : sur web desktop, la carte reste à largeur « mobile » au centre
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
        <Text style={styles.title}>C’est enregistré 🧭</Text>

        <View style={styles.chips}>
          {feedback.chips.map((chip) => {
            const color = pulseColor(COLORS, chip.tone);
            return (
              <View key={chip.key} style={[styles.chip, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
                <Text style={[styles.chipText, { color }]}>{chip.text}</Text>
              </View>
            );
          })}
        </View>

        {/* Le signal que ce geste vient de faire bouger : sa barre se remplit sous les yeux. */}
        {feedback.signal && (
          <View style={styles.signalWrap}>
            <PulseSignalCard key={feedback.signal.id} signal={feedback.signal} delay={120} />
          </View>
        )}

        <Text style={styles.hint}>Swipe vers le haut pour fermer</Text>
        <View style={styles.grabber} />
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
    title: { fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    chipText: { fontSize: 12.5, fontWeight: '800' },
    // La carte de signal amène sa propre marge basse : on la neutralise ici.
    signalWrap: { marginTop: 14, marginBottom: -10 },
    hint: { fontSize: 10.5, color: c.textSecondary, marginTop: 14, textAlign: 'center' },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 8 },
  });
}
