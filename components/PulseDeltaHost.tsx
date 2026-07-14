/**
 * POULS — le « live ». Monté UNE fois au niveau racine : la réponse apparaît donc dès qu'une
 * opération est enregistrée, quel que soit l'écran d'où l'utilisateur a validé (saisie, virement,
 * détail de compte, saisie rapide…).
 *
 * Deux temps, pour ne jamais faire attendre :
 *   1. IMMÉDIAT — l'effet direct du geste (« Épargne : +200 € »), sans attendre le réseau ;
 *   2. ENRICHI  — dès que les données sont revenues : le Relyka, et le SIGNAL que ce geste a bougé
 *      (l'enveloppe du mois après une dépense, le matelas après un virement d'épargne…).
 *
 * Fermeture : au tap (n'importe où) ou en balayant vers le haut. JAMAIS d'auto-disparition —
 * l'utilisateur doit avoir le temps de lire.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, PanResponder, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
}

export default function PulseDeltaHost() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { data: config } = usePulseConfig();
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const pulse = usePulse();

  const [feedback, setFeedback] = useState<PulseFeedback | null>(null);
  const pending = useRef<Pending | null>(null);

  // Le Pouls courant, lu SANS re-souscrire à chaque rendu (l'abonnement au bus reste monté une fois).
  const pulseRef = useRef<PulseData | null>(null);
  pulseRef.current = pulse;
  const accountsRef = useRef<any[]>(accounts);
  accountsRef.current = accounts;

  const anim = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  const liveEnabled = !!config?.enabled && !!config?.live;

  const dismiss = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        setFeedback(null);
        pending.current = null;
        drag.setValue(0);
      });
  }, [anim, drag]);

  // Balayage vers le HAUT → on referme (la carte descend du haut : elle repart par où elle est venue).
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

  // Abonnement au bus (monté une fois) : réponse IMMÉDIATE à la saisie.
  useEffect(() => {
    if (!liveEnabled) return;
    return subscribePulseOp((event) => {
      pending.current = { event, before: pulseRef.current };
      setFeedback(computeOpFeedback(toOp(event), null, null, null, null));
      drag.setValue(0);
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 70, friction: 11 }).start();
    });
  }, [liveEnabled, toOp, anim, drag]);

  // Les données sont revenues → on enrichit (Relyka + le signal que le geste vient de faire bouger).
  useEffect(() => {
    const p = pending.current;
    if (!p || !pulse) return;
    // Même objet qu'avant la saisie → le rafraîchissement n'est pas encore arrivé, on attend.
    if (p.before && p.before.result === pulse.result) return;
    setFeedback(
      computeOpFeedback(
        toOp(p.event),
        p.before?.result ?? null,
        pulse.result,
        p.before?.relyka ?? null,
        pulse.relyka,
      ),
    );
    pending.current = null;
  }, [pulse, toOp]);

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
            <PulseSignalCard key={feedback.signal.id} signal={feedback.signal} delay={80} />
          </View>
        )}

        <Text style={styles.hint}>Touche l’écran pour fermer</Text>
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
      borderRadius: 20, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
        android: { elevation: 12 },
        default: { boxShadow: '0 8px 24px rgba(0,0,0,0.22)' } as any,
      }),
    },
    title: { fontSize: 14, fontWeight: '800', color: c.text, marginBottom: 10 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
    chipText: { fontSize: 12, fontWeight: '800' },
    // La carte de signal amène sa propre marge basse : on la neutralise ici.
    signalWrap: { marginTop: 12, marginBottom: -10 },
    hint: { fontSize: 10.5, color: c.textSecondary, marginTop: 12, textAlign: 'center' },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 8 },
  });
}
