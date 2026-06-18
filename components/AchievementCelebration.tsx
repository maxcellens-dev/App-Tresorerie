/**
 * AchievementCelebration — overlay GLOBAL qui célèbre un succès dès qu'il est débloqué,
 * quelle que soit la page affichée. Animation d'apparition, on touche pour fermer, et
 * chaque succès n'est célébré qu'UNE seule fois — mémorisé CÔTÉ COMPTE (colonne
 * user_badges.celebrated_at), donc pas de rejeu sur un autre appareil/écran.
 *
 * Les succès déjà débloqués avant cette fonctionnalité ont été marqués comme célébrés par la
 * migration → pas de célébration rétroactive.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useGamification } from '../hooks/useGamification';
import { useProfile } from '../hooks/useProfile';
import { useAppColors } from '../hooks/useAppColors';
import { UNLOCK_COLOR, WELCOME_BADGE_KEY, isImageIcon, formatCurrency, type BadgeDef } from '../lib/gamification';

export default function AchievementCelebration() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { user } = useAuth();
  const { badges, config, markBadgesCelebrated } = useGamification(user?.id);
  const { data: profile } = useProfile(user?.id);
  // Aucune célébration tant que l'onboarding n'est pas terminé : questionnaire répondu
  // ET tuto de présentation vu/fermé. Sinon un pop-up s'affiche par-dessus l'accueil/questionnaire.
  const onboardingDone =
    Boolean((profile as any)?.initial_onboarding_completed) && Boolean((profile as any)?.app_tour_done);

  // Succès déjà pris en charge cette session (évite de re-traiter avant le refetch du serveur).
  const handledRef = useRef<Set<string>>(new Set());
  const [queue, setQueue] = useState<BadgeDef[]>([]);
  const [current, setCurrent] = useState<BadgeDef | null>(null);
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  // Réinitialise à chaque changement de compte.
  useEffect(() => {
    handledRef.current = new Set();
    setQueue([]);
    setCurrent(null);
  }, [user?.id]);

  // Détecte les succès non encore célébrés (celebrated_at null) → file d'attente, puis les marque
  // célébrés côté serveur immédiatement pour qu'ils ne reviennent jamais.
  useEffect(() => {
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
    markBadgesCelebrated(pending.map((b) => b.badge_key));
    const fresh = pending
      .map((b) => config.badges.find((d) => d.key === b.badge_key))
      .filter((d): d is BadgeDef => !!d);
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges, config, user?.id, onboardingDone]);

  // Affiche le suivant.
  useEffect(() => {
    if (current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((q) => q.slice(1));
  }, [queue, current]);

  // Animation d'apparition.
  useEffect(() => {
    if (!current) return;
    scale.setValue(0.6); opacity.setValue(0); glow.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 70, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
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
