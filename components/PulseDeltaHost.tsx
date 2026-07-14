/**
 * POULS — le « live ». Monté UNE fois au niveau racine : la réponse apparaît dès qu'une opération
 * est enregistrée, quel que soit l'écran d'où l'utilisateur a validé.
 *
 * Apparition EN UNE FOIS : on n'affiche rien tant que les données recalculées ne sont pas revenues
 * (sinon la carte se montrait en deux temps, et le signal pouvait dire « rien de placé » juste après
 * un virement d'investissement — calculé sur les données d'AVANT la saisie). Concrètement :
 *   1. saisie → on mémorise l'opération et l'état d'avant ;
 *   2. on attend que les requêtes (pilotage, transactions, comptes) aient fini de se recharger ;
 *   3. la carte apparaît complète : effet direct + Relyka + le signal impacté, à jour.
 * Filet de sécurité : si le réseau traîne (> 3,5 s), on affiche ce qu'on a.
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
import type { PulseResult } from '../lib/pulseEngine';
import PulseSignalCard, { pulseColor } from './PulseSignalCard';

/** Instantané du Pouls juste avant la saisie (pour mesurer ce qui a bougé). */
interface Pending {
  event: PulseOpEvent;
  before: PulseData | null;
}

/** Requêtes dont dépend le Pouls : on attend qu'elles soient revenues avant d'afficher. */
const WATCHED_QUERIES = new Set(['pilotage_data', 'transactions', 'accounts']);

/**
 * Espace de recherche du signal impacté : hebdo D'ABORD (il contient toujours « Dépenses du mois »
 * et « Fin de mois », même pour un profil P5 qui ne les affiche pas dans sa vue complète), puis le
 * reste de la vue complète (matelas, invest…).
 */
function unionResult(d: PulseData): PulseResult {
  const weeklyIds = new Set(d.weekly.signals.map((s) => s.id));
  return {
    ...d.result,
    signals: [...d.weekly.signals, ...d.result.signals.filter((s) => !weeklyIds.has(s.id))],
  };
}

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
  const pending = useRef<Pending | null>(null);
  const minDelayDone = useRef(false);
  const minDelayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (minDelayTimer.current) { clearTimeout(minDelayTimer.current); minDelayTimer.current = null; }
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

  /** Affiche la carte, complète, avec l'état LE PLUS FRAIS disponible. */
  const showNow = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimers();
    const now = pulseRef.current;
    setFeedback(
      computeOpFeedback(
        toOp(p.event),
        p.before ? unionResult(p.before) : null,
        now ? unionResult(now) : null,
        p.before?.relyka ?? null,
        now?.relyka ?? null,
      ),
    );
    drag.setValue(0);
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 11 }).start();
  }, [toOp, anim, drag, clearTimers]);

  /** Montre la carte SI le délai minimal est passé ET que plus rien ne se recharge. */
  const attemptShow = useCallback(() => {
    if (!pending.current || !minDelayDone.current) return;
    if (fetchingRef.current > 0) return;
    showNow();
  }, [showNow]);

  // Abonnement au bus (monté une fois).
  useEffect(() => {
    if (!liveEnabled) return;
    return subscribePulseOp((event) => {
      pending.current = { event, before: pulseRef.current };
      clearTimers();
      // Délai minimal : laisse le temps aux invalidations de DÉMARRER leurs refetchs
      // (sinon « plus rien ne charge » serait vrai un instant avant qu'ils commencent).
      minDelayDone.current = false;
      minDelayTimer.current = setTimeout(() => { minDelayDone.current = true; attemptShow(); }, 350);
      // Filet : réseau lent → on affiche ce qu'on a plutôt que rien.
      fallbackTimer.current = setTimeout(showNow, 3500);
    });
  }, [liveEnabled, attemptShow, showNow, clearTimers]);

  // Chaque fois que l'état des requêtes ou le Pouls bouge : nouvelle tentative d'affichage.
  useEffect(() => { attemptShow(); }, [fetching, pulse, attemptShow]);

  // Nettoyage à la dépose (déconnexion, etc.).
  useEffect(() => () => clearTimers(), [clearTimers]);

  const dismiss = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        setFeedback(null);
        pending.current = null;
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
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.card,
          { top: insets.top + 58 }, // sous l'en-tête, comme le bandeau « prochain geste »
          {
            opacity: anim,
            transform: [
              { translateY: Animated.add(anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }), drag) },
            ],
          },
        ]}
      >
        <Text style={styles.title}>C’est enregistré 🫀</Text>

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

        <Text style={styles.hint}>Touche pour fermer</Text>
        <View style={styles.grabber} />
      </Animated.View>
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, zIndex: 60, elevation: 60 },
    card: {
      position: 'absolute', left: 12, right: 12,
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
