/**
 * StreakChip — pastille « série + gemmes » affichée dans l'en-tête. Ouvre l'écran Succès.
 * Masquée si la gamification est désactivée en admin ou si pas d'utilisateur.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { useGamification } from '../hooks/useGamification';
import { useCosmetics } from '../hooks/useCosmetics';
import { isImageIcon } from '../lib/gamification';

export default function StreakChip() {
  const COLORS = useAppColors();
  const router = useRouter();
  const { user } = useAuth();
  const { state, config } = useGamification(user?.id);
  const { flameColor } = useCosmetics(user?.id);

  if (!user || !config?.identity.enabled || !state) return null;
  const streakIcon = config.identity.streakIcon || '🔥';
  const isActive = state.streak > 0;
  // Cosmétique « flamme dorée » équipé → teinte dorée (sur l'icône emoji ET Ionicons).
  const goldFlame = isActive && !!flameColor;

  return (
    <TouchableOpacity
      style={[styles.chip, { borderColor: goldFlame ? '#FFD700' : COLORS.cardBorder, backgroundColor: goldFlame ? '#FFD7001A' : COLORS.card }]}
      onPress={() => router.push('/(tabs)/(secondary)/succes' as any)}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="Succès et série"
    >
      {isImageIcon(streakIcon)
        ? <Image source={{ uri: streakIcon }} style={styles.iconImg} />
        : streakIcon.length <= 2
          ? <Text style={[styles.emoji, !isActive && { opacity: 0.4 }, goldFlame && styles.goldEmoji]}>{streakIcon}</Text>
          : <Ionicons name={streakIcon as any} size={14} color={goldFlame ? '#FFD700' : isActive ? COLORS.orange : COLORS.textSecondary} />}
      <Text style={[styles.streakText, { color: goldFlame ? '#FFD700' : isActive ? COLORS.text : COLORS.textSecondary }]}>{state.streak}</Text>
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
  // Halo doré (cosmétique « flamme dorée ») — léger glow + teinte chaude sur l'emoji.
  goldEmoji: { textShadowColor: '#FFD700', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 },
  iconImg: { width: 14, height: 14, borderRadius: 3 },
  streakText: { fontSize: 12, fontWeight: '800' },
});
