/**
 * POULS — le « live ». Monté UNE fois au niveau racine : la réponse apparaît dès qu'une opération
 * est enregistrée, quel que soit l'écran d'où l'utilisateur a validé.
 *
 * Apparition IMMÉDIATE, remplissage sur place : la carte se montre à l'instant de la saisie avec
 * l'EFFET DIRECT (toujours exact : « Dépense : −100 € ») ET le gabarit définitif du signal impacté
 * — libellé, lignes et barre présents, valeurs en TIRETS tant que les chiffres recalculés ne sont
 * pas sûrs (cf. pendingSignal). Ils se remplissent dès que les refetchs aboutissent : jamais de
 * valeur PÉRIMÉE affichée, et aucun saut de mise en page.
 * Filet : si aucun refetch n'arrive (déjà frais / hors ligne), on complète avec le cache à 600 ms.
 *
 * Fermeture : au tap (n'importe où), en balayant vers le haut, ou TOUTE SEULE au bout de 5 s —
 * la carte confirme une saisie, elle n'a rien à faire attendre : la laisser en place obligeait à
 * un geste supplémentaire après chaque opération.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable, PanResponder, Platform, LayoutAnimation, type LayoutAnimationConfig } from 'react-native';
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
import { pulseColor } from './PulseSignalCard';
import type { PulseStatus } from '../lib/pulseEngine';

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

/** Durée d'affichage avant disparition automatique. Assez pour lire les deux pastilles, pas plus. */
const AUTO_DISMISS_MS = 5000;

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
  return v < 0 ? `(−${body})` : `(+${body})`;
}

/** Empreinte du contenu AFFICHÉ → évite les re-rendus quand rien de visible n'a changé.
 *  Le signal n'y figure pas : il n'est plus rendu ici (voir le commentaire dans le JSX), donc ses
 *  variations ne doivent déclencher ni re-rendu ni animation de mise en page. */
function feedbackSignature(f: PulseFeedback): string {
  const eom = f.endOfMonth ? `eom:${f.endOfMonth.amount}:${f.endOfMonth.delta}` : '';
  return f.chips.map((c) => `${c.key}:${c.text}:${c.tone}`).join('|') + '#' + eom;
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
  // L'opération ACTUELLEMENT affichée : conservée tant que la carte est visible → on la RECALCULE
  // à chaque arrivée de données fraîches (le refetch peut aboutir juste après le 1er affichage).
  const active = useRef<Pending | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (autoDismissTimer.current) { clearTimeout(autoDismissTimer.current); autoDismissTimer.current = null; }
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
      date: event.date,
    };
  }, []);

  /** (Re)calcule le retour de l'opération `p`. Tant que les données ne sont pas FRAÎCHES (aucun
   *  refetch abouti depuis la saisie), on passe `after = null` : la carte n'affiche que l'effet
   *  direct — toujours exact — plutôt qu'un Relyka / signal PÉRIMÉS calculés sur l'état d'avant. */
  const renderFor = useCallback((p: Pending) => {
    const fresh = (p.forceFull || p.sawRefetch) && fetchingRef.current === 0 ? pulseRef.current : null;
    const next = computeOpFeedback(
      toOp(p.event),
      p.before?.live ?? null,
      fresh?.live ?? null,
      p.before?.relyka ?? null,
      fresh?.relyka ?? null,
      // Fin de mois : recalculée par ARITHMÉTIQUE depuis l'instantané d'AVANT la saisie. Elle ne
      // dépend donc d'aucun refetch et s'affiche juste, tout de suite — c'est ce qui la rendait
      // inutilisable auparavant (tirets puis remplissage, la carte changeait de hauteur).
      p.before ? { before: p.before.endOfMonthBalance, margin: p.before.safetyMargin } : undefined,
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

  // Disparition automatique. Armée sur l'APPARITION de la carte (pas à chaque recalcul de contenu),
  // sinon chaque vague de refetch repousserait l'échéance.
  useEffect(() => {
    if (!feedback) return;
    if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
    autoDismissTimer.current = setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => { if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!feedback]);

  const dismiss = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true, easing: Easing.in(Easing.cubic) })
      .start(() => {
        setFeedback(null);
        active.current = null;
        clearTimers();
        drag.setValue(0);
      });
  }, [anim, drag, clearTimers]);
  // Référence vivante : le minuteur d'auto-fermeture est armé AVANT que `dismiss` ne soit défini,
  // et ne doit pas capturer une version périmée de la fonction.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

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

        {/* FIN DE MOIS — la seule info du Pouls affichée ici, parce que c'est la seule qui n'a
            besoin d'AUCUN recalcul : le solde projeté varie exactement du montant de l'opération
            (cf. lib/pulseDelta.computeEndOfMonthDelta). Elle est donc juste et instantanée, là où
            la carte de signal complète s'affichait en tirets puis se remplissait en changeant de
            hauteur — ce qui paraissait lent juste après une saisie. Le reste du Pouls est à un tap.
            Pas de ligne quand l'opération ne déplace pas ce solde (datée hors du mois courant, ou
            hors des comptes courants) : on ne répète pas un chiffre qui n'a pas bougé. */}
        {!!feedback.endOfMonth && feedback.endOfMonth.delta !== 0 && (() => {
          const eom = feedback.endOfMonth;
          const tone: PulseStatus = eom.negative ? 'alert' : eom.belowMargin ? 'watch' : 'good';
          const color = pulseColor(COLORS, tone);
          return (
            <View style={[styles.eom, { borderColor: color + '55', backgroundColor: color + '14' }]}>
              <Text style={styles.eomLabel}>🗓️ {firstOfNextMonthLabel()}</Text>
              <Text style={[styles.eomValue, { color }]}>
                {eurSigned(eom.amount, false)}
                <Text style={styles.eomDelta}>  {eurSigned(eom.delta, true)}</Text>
              </Text>
            </View>
          );
        })()}

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

    // Ligne « Fin de mois » : une seule ligne, pas une carte — elle complète les pastilles sans
    // rallonger la confirmation.
    eom: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 10,
    },
    eomLabel: { fontSize: 12.5, fontWeight: '700', color: c.textSecondary },
    eomValue: { fontSize: 14, fontWeight: '800' },
    eomDelta: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    hint: { fontSize: 10.5, color: c.textSecondary, marginTop: 14, textAlign: 'center' },
    grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 999, backgroundColor: c.cardBorder, marginTop: 8 },
  });
}
