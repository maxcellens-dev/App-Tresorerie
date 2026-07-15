/**
 * AchievementCelebration — overlay GLOBAL qui célèbre un succès dès qu'il est débloqué,
 * quelle que soit la page affichée. Animation d'apparition, on swipe vers le haut pour fermer, et
 * chaque succès n'est célébré qu'UNE seule fois — mémorisé CÔTÉ COMPTE (colonne
 * user_badges.celebrated_at), donc pas de rejeu sur un autre appareil/écran.
 *
 * Les succès déjà débloqués avant cette fonctionnalité ont été marqués comme célébrés par la
 * migration → pas de célébration rétroactive.
 */
import React, { useMemo, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../hooks/useGamification';
import { useAppColors } from '../hooks/useAppColors';
import { useTour } from '../contexts/TourContext';
import { isAppReady, onAppReady } from '../lib/splashGate';
import { UNLOCK_COLOR, WELCOME_BADGE_KEY, isImageIcon, formatCurrency, type BadgeDef } from '../lib/gamification';

export default function AchievementCelebration() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user, isImpersonating } = useAuth();
  const { badges, config, markBadgesCelebrated } = useGamification(user?.id);
  const tour = useTour();
  const segments = useSegments();
  // Quand peut-on célébrer ? Quand l'utilisateur est RÉELLEMENT dans l'app (onglets) et que le guide
  // de présentation n'est pas en cours. On ne se fie plus à `profiles.initial_onboarding_completed` :
  // son écriture est best-effort (questionnaire.tsx l'avale en cas d'échec) et il reste faux sur les
  // comptes créés avant son introduction → plus AUCUNE célébration ne se mettait en file, jamais.
  // Être dans `(tabs)` exclut de fait welcome / login / questionnaire.
  const onboardingDone = segments[0] === '(tabs)' && !tour.active;

  // Succès déjà pris en charge cette session (évite de re-traiter avant le refetch du serveur).
  const handledRef = useRef<Set<string>>(new Set());
  const [queue, setQueue] = useState<BadgeDef[]>([]);
  const [current, setCurrent] = useState<BadgeDef | null>(null);
  // App réellement révélée (le splash animé s'est effacé) : on ne célèbre JAMAIS avant que
  // l'utilisateur soit arrivé sur l'app — sinon l'animation joue derrière l'écran de chargement.
  // MAIS `signalAppReady()` n'est émis que par Pilotage / Accueil / Questionnaire : si la session
  // démarre ailleurs (Boutique, Succès, rafraîchissement web sur une autre page), le signal
  // n'arrivait jamais et la célébration restait bloquée en file d'attente indéfiniment.
  //  • web  : aucun splash animé → prêt immédiatement ;
  //  • natif : on attend le signal, avec un filet de sécurité pour ne jamais rester bloqué.
  const [appReady, setAppReady] = useState(() => isAppReady() || Platform.OS === 'web');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const off = onAppReady(() => setAppReady(true));
    const fallback = setTimeout(() => setAppReady(true), 4000);
    return () => { off(); clearTimeout(fallback); };
  }, []);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  // Paillettes : burst unique 0→1 ; chaque particule a sa direction/couleur/rotation propre.
  const burst = useRef(new Animated.Value(0)).current;
  const CONFETTI_COLORS = ['#f59e0b', '#34d399', '#a78bfa', '#60a5fa', '#f472b6', '#fbbf24'];
  const particles = useMemo(() => {
    // Régénérées à chaque succès affiché (dépend de `current`).
    return Array.from({ length: 18 }, (_, i) => {
      const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 90 + Math.random() * 70;
      return {
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 30, // légère poussée vers le haut
        rot: `${Math.round(Math.random() * 720 - 360)}deg`,
        size: 6 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: Math.random() > 0.5,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key]);

  // Réinitialise à chaque changement de compte.
  useEffect(() => {
    handledRef.current = new Set();
    setQueue([]);
    setCurrent(null);
  }, [user?.id]);

  // Détecte les succès non encore célébrés (celebrated_at null) → file d'attente. Le marquage
  // « célébré » se fait à l'AFFICHAGE (effet suivant), pas ici : si l'app est fermée avant que
  // l'animation soit montrée, le succès se rejouera à la prochaine ouverture (même 10 jours après).
  useEffect(() => {
    if (isImpersonating) return; // consultation admin : ne pas célébrer / marquer les succès du compte cible
    if (!user?.id || !config) return;
    if (!onboardingDone) return; // rien avant la fin du questionnaire + tuto
    const pending = badges.filter(
      (b) =>
        !b.celebrated_at &&
        !handledRef.current.has(b.badge_key) &&
        // « Bienvenue » n'est jamais célébré en pop-up : consommé à la 1ʳᵉ visite de la page Succès.
        b.badge_key !== WELCOME_BADGE_KEY,
    );
    if (pending.length === 0) return;
    pending.forEach((b) => handledRef.current.add(b.badge_key));
    const fresh = pending
      .map((b) => config.badges.find((d) => d.key === b.badge_key))
      .filter((d): d is BadgeDef => !!d);
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges, config, user?.id, onboardingDone, isImpersonating]);

  // Affiche le suivant — seulement une fois l'app RÉELLEMENT révélée (splash effacé), avec un court
  // délai pour ne pas superposer la célébration à la transition d'arrivée. C'est ICI que le succès
  // est marqué célébré côté serveur : il est garanti vu (ou en cours d'affichage).
  useEffect(() => {
    if (current || queue.length === 0 || !appReady) return;
    const next = queue[0];
    const t = setTimeout(() => {
      setCurrent(next);
      setQueue((q) => q.slice(1));
      markBadgesCelebrated([next.key]);
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, current, appReady]);

  // Animation d'apparition + burst de paillettes.
  useEffect(() => {
    if (!current) return;
    scale.setValue(0.6); opacity.setValue(0); glow.setValue(0); burst.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(burst, { toValue: 1, duration: 950, useNativeDriver: true }),
    ]).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const dismiss = () => {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setCurrent(null));
  };

  if (!current) return null;
  const gems = current.gems ?? 0;
  const currency = config?.identity.currencyName ?? 'Relyk';
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.5] });

  return (
    <Animated.View style={[styles.overlay, { opacity }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill as any} activeOpacity={1} onPress={dismiss} />
      <Animated.View style={[styles.card, { transform: [{ scale }] }]} pointerEvents="none">
        {/* Paillettes : burst radial depuis le centre de la carte (fade + rotation). */}
        <View pointerEvents="none" style={styles.confettiLayer}>
          {particles.map((p, i) => (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                width: p.size, height: p.size,
                borderRadius: p.round ? p.size / 2 : 2,
                backgroundColor: p.color,
                opacity: burst.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 0.9, 0] }),
                transform: [
                  { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                  { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
                  { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.rot] }) },
                ],
              }}
            />
          ))}
        </View>
        <Text style={styles.congrats}>🎉 Succès débloqué !</Text>
        <View style={styles.iconWrap}>
          <Animated.View style={[styles.glow, { backgroundColor: UNLOCK_COLOR, opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
          <View style={[styles.iconCircle, { backgroundColor: UNLOCK_COLOR + '22', borderColor: UNLOCK_COLOR + '66' }]}>
            {isImageIcon(current.icon) ? (
              <Image source={{ uri: current.icon }} style={{ width: 44, height: 44, borderRadius: 10 }} />
            ) : (
              <Ionicons name={(current.icon || 'trophy') as any} size={40} color={UNLOCK_COLOR} />
            )}
          </View>
        </View>
        <Text style={styles.title}>{current.label}</Text>
        {!!current.description && <Text style={styles.desc}>{current.description}</Text>}
        {gems > 0 && (
          <View style={styles.reward}>
            <Ionicons name="diamond" size={15} color={COLORS.blue} />
            <Text style={styles.rewardText}>+{formatCurrency(gems, currency)}</Text>
          </View>
        )}
        <Text style={styles.tapHint}>Touchez pour fermer</Text>
      </Animated.View>
    </Animated.View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 28, zIndex: 5000, ...(Platform.OS === 'web' ? { position: 'fixed' as any } : {}) },
    card: { width: '100%', maxWidth: 340, backgroundColor: c.cardSolid ?? c.card, borderRadius: 24, borderWidth: 1, borderColor: UNLOCK_COLOR + '55', padding: 28, alignItems: 'center' },
    congrats: { fontSize: 16, fontWeight: '800', color: UNLOCK_COLOR, marginBottom: 18 },
    confettiLayer: { position: 'absolute', top: '38%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' },
    iconWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    glow: { position: 'absolute', width: 96, height: 96, borderRadius: 48 },
    iconCircle: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 20, fontWeight: '900', color: c.text, textAlign: 'center' },
    desc: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
    reward: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, backgroundColor: c.blue + '1A', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
    rewardText: { fontSize: 14, fontWeight: '800', color: c.text },
    tapHint: { fontSize: 11.5, color: c.textSecondary, marginTop: 18 },
  });
}
