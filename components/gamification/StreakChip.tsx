/**
 * StreakChip — pastille « série » de l'en-tête. Ouvre l'écran Succès.
 * Masquée si la gamification est désactivée en admin ou si pas d'utilisateur.
 *
 * LE « +1 » DE LA SEMAINE. À la première visite d'une nouvelle semaine, la série monte d'un cran
 * (cf. useGamification.validateWeek) : la pastille garde alors l'ANCIEN chiffre, attend son tour
 * dans la file des sollicitations — après la clôture du mois et après les succès débloqués —, puis
 * joue la montée : la flamme grossit, le chiffre glisse vers le haut et un « +1 » s'envole.
 * Sans cette mise en scène, le chiffre changeait tout seul entre deux ouvertures, sans que
 * personne ne le remarque.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useGamification } from '../../hooks/engagement/useGamification';
import { useCosmetics } from '../../hooks/theme/useCosmetics';
import { useInterruptSlot } from '../../hooks/engagement/useInterruptSlot';
import { isImageIcon } from '../../lib/engagement/gamification';
import { clearStreakBump, pendingStreakBump, subscribeStreakBump, type StreakBump } from '../../lib/engagement/streakBump';

/**
 * Délai de courtoisie avant de réclamer la parole. Les succès débloqués par la même visite sont
 * enregistrés JUSTE APRÈS le « +1 » (evaluate() suit validateWeek) : sans cette attente, la flamme
 * partirait avant que la célébration ait eu le temps de se signaler dans la file.
 */
const GRACE_MS = 900;

/**
 * Garde-fou : si la parole ne vient jamais (une fenêtre restée ouverte, un écran sans en-tête),
 * on abandonne l'animation et on affiche la vraie valeur. Un chiffre faux dans l'en-tête serait
 * plus gênant qu'une animation manquée.
 */
const MAX_WAIT_MS = 20_000;

export default function StreakChip() {
  const COLORS = useAppColors();
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const { state, config } = useGamification(user?.id);
  const { flameColor } = useCosmetics(user?.id);

  /** Le « +1 » en attente (ou en cours d'animation). */
  const [bump, setBump] = useState<StreakBump | null>(null);
  const [ready, setReady] = useState(false);   // délai de courtoisie écoulé
  const [playing, setPlaying] = useState(false);
  /** Chiffre réellement affiché : l'ancien tant que l'animation n'a pas eu lieu. */
  const [shown, setShown] = useState<number | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;   // grossissement de la flamme
  const slide = useRef(new Animated.Value(0)).current;   // glissement du chiffre
  const plusOne = useRef(new Animated.Value(0)).current; // « +1 » qui s'envole

  // En consultation admin (« connecté en tant que »), on ne rejoue pas la semaine de quelqu'un d'autre.
  const armed = !!user && !isImpersonating;

  // Récupération à CHAUD (événement) et AU MONTAGE (l'en-tête peut être démonté au moment du « +1 »).
  useEffect(() => {
    if (!armed || !user?.id) return;
    const start = (b: StreakBump) => {
      if (b.userId !== user.id) return;   // « +1 » d'un autre compte (déconnexion / consultation)
      setBump(b); setShown(b.from); setReady(false);
    };
    const already = pendingStreakBump(user.id);
    if (already) start(already);
    return subscribeStreakBump(start);
  }, [armed, user?.id]);

  // Délai de courtoisie : laisse le temps aux succès de la même visite de se signaler.
  // Et garde-fou : au-delà de MAX_WAIT_MS sans avoir obtenu la parole, on renonce.
  useEffect(() => {
    if (!bump) return;
    const grace = setTimeout(() => setReady(true), GRACE_MS);
    const giveUp = setTimeout(() => {
      if (playingRef.current) return;         // l'animation a démarré entre-temps
      clearStreakBump();
      setBump(null); setReady(false); setShown(null);
    }, MAX_WAIT_MS);
    return () => { clearTimeout(grace); clearTimeout(giveUp); };
  }, [bump]);

  // Lecture vivante de `playing` pour le garde-fou ci-dessus (armé avant que l'animation démarre).
  const playingRef = useRef(false);
  playingRef.current = playing;

  const myTurn = useInterruptSlot('streak_bump', !!bump && ready);

  const play = useCallback((b: StreakBump) => {
    setPlaying(true);
    pulse.setValue(0); slide.setValue(0); plusOne.setValue(0);
    Animated.sequence([
      // 1. la flamme respire (on regarde la pastille)
      Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: true, easing: Easing.out(Easing.back(2)) }),
      // 2. l'ancien chiffre part vers le haut
      Animated.timing(slide, { toValue: 1, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
    ]).start(() => {
      // 3. le nouveau chiffre prend sa place et le « +1 » s'envole
      setShown(b.to);
      slide.setValue(-1);
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.sequence([
          Animated.timing(plusOne, { toValue: 1, duration: 520, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
          Animated.timing(plusOne, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]),
        Animated.timing(pulse, { toValue: 0, duration: 420, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ]).start(() => {
        // Terminé : on rend la parole et on repasse sur la valeur réelle de l'état.
        clearStreakBump();
        setBump(null);
        setPlaying(false);
        setShown(null);
        setReady(false);
      });
    });
  }, [pulse, slide, plusOne]);

  useEffect(() => {
    if (myTurn && bump && !playing) play(bump);
  }, [myTurn, bump, playing, play]);

  if (!user || !config?.identity.enabled || !state) return null;
  const streakIcon = config.identity.streakIcon || '🔥';
  const value = shown ?? state.streak;
  const isActive = value > 0;
  // Cosmétique « flamme » équipé → on utilise SA couleur réelle (dorée, bleue, violette…),
  // même si la série est à 0 (le style cosmétique s'applique en permanence).
  const flameTint = flameColor ? flameColor : null;
  const highlight = flameTint ?? COLORS.orange;

  return (
    <TouchableOpacity
      style={[styles.chip, { borderColor: flameTint ?? COLORS.cardBorder, backgroundColor: flameTint ? flameTint + '1A' : COLORS.card }]}
      onPress={() => router.push('/(tabs)/(secondary)/succes' as any)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${value} semaines connectées — succès`}
    >
      <Animated.View
        style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }}
      >
        {isImageIcon(streakIcon)
          ? <Image source={{ uri: streakIcon }} style={styles.iconImg} />
          : flameTint
            // Flamme cosmétique : icône vectorielle colorée (l'emoji 🔥 n'est pas recolorable).
            ? <Ionicons name="flame" size={14} color={flameTint} />
            : streakIcon.length <= 2
              ? <Text style={[styles.emoji, !isActive && { opacity: 0.4 }]}>{streakIcon}</Text>
              : <Ionicons name={streakIcon as any} size={14} color={isActive ? COLORS.orange : COLORS.textSecondary} />}
      </Animated.View>

      {/* Le chiffre glisse : vers le haut en sortant, depuis le bas en entrant. La largeur est
          figée par le conteneur pour que la pastille ne « saute » pas pendant l'animation. */}
      <View style={styles.counter}>
        <Animated.Text
          style={[
            styles.streakText,
            { color: flameTint ?? (isActive ? COLORS.text : COLORS.textSecondary) },
            {
              opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
              transform: [{ translateY: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [9, 0, -9] }) }],
            },
          ]}
        >
          {value}
        </Animated.Text>
      </View>

      {playing && (
        <Animated.Text
          pointerEvents="none"
          style={[
            styles.plusOne,
            { color: highlight },
            {
              opacity: plusOne.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
              transform: [{ translateY: plusOne.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) }],
            },
          ]}
        >
          +1
        </Animated.Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emoji: { fontSize: 13 },
  iconImg: { width: 14, height: 14, borderRadius: 3 },
  // Fenêtre du compteur : hauteur fixe → le chiffre glisse dedans sans déformer la pastille.
  counter: { height: 15, minWidth: 10, justifyContent: 'center', overflow: 'hidden' },
  streakText: { fontSize: 12, fontWeight: '800' },
  plusOne: { position: 'absolute', right: 4, top: -2, fontSize: 12, fontWeight: '900' },
});
