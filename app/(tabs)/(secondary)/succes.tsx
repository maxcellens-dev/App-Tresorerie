/**
 * Écran Succès — grille de trophées débloquables (style Duolingo).
 * Chaque badge montre son icône/image, son niveau atteint (Bronze/Argent/Or) et sa description.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/ScreenGradient';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useGamification } from '../../hooks/useGamification';
import { useMonthlyClosure } from '../../hooks/useMonthlyClosure';
import { useNavBack } from '../../hooks/useNavBack';
import { UNLOCK_COLOR, isImageIcon, currencyPlural } from '../../lib/gamification';

export default function SuccesScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { state, badges, config } = useGamification(user?.id);
  const { enabled: closureEnabled } = useMonthlyClosure(user?.id);

  const unlockedKeys = new Set(badges.map((b) => b.badge_key));

  // Masque les badges liés à la clôture si la fonctionnalité est désactivée.
  const visibleBadges = (config?.badges ?? []).filter((d) => d.metric !== 'closures_count' || closureEnabled);
  // Succès débloqués triés du plus récent au plus ancien (date de déverrouillage)
  const unlockedBadges = visibleBadges
    .filter((d) => unlockedKeys.has(d.key))
    .sort((a, b) => {
      const aDate = badges.find((ub) => ub.badge_key === a.key)?.unlocked_at ?? '';
      const bDate = badges.find((ub) => ub.badge_key === b.key)?.unlocked_at ?? '';
      return bDate.localeCompare(aDate);
    });
  const lockedBadges = visibleBadges.filter((d) => !unlockedKeys.has(d.key));
  const unlockedCount = unlockedBadges.length;

  const renderBadge = (def: typeof visibleBadges[number]) => {
    const unlocked = unlockedKeys.has(def.key);
    const tint = unlocked ? UNLOCK_COLOR : COLORS.textSecondary;
    return (
      <View key={def.key} style={[styles.card, unlocked && { borderColor: tint + '88' }]}>
        <View style={[styles.badgeIcon, { backgroundColor: tint + '22', opacity: unlocked ? 1 : 0.5 }]}>
          {isImageIcon(def.icon)
            ? <Image source={{ uri: def.icon }} style={styles.badgeImg} />
            : <Ionicons name={(def.icon || 'trophy') as any} size={26} color={tint} />}
          {!unlocked && (
            <View style={styles.lockOverlay}>
              <Ionicons name="lock-closed" size={12} color={COLORS.textSecondary} />
            </View>
          )}
        </View>
        <Text style={styles.badgeLabel} numberOfLines={2}>{def.label}</Text>
        <Text style={styles.badgeDesc} numberOfLines={3}>{def.description}</Text>
        {def.gems > 0 && (
          <View style={[styles.rewardPill, unlocked && { backgroundColor: tint + '22' }]}>
            <Ionicons name="diamond" size={11} color={unlocked ? tint : COLORS.textSecondary} />
            <Text style={[styles.rewardText, { color: unlocked ? tint : COLORS.textSecondary }]}>+{def.gems}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack} accessibilityRole="button">
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Succès</Text>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Résumé série / gemmes */}
          <View style={styles.summary}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryEmoji}>{config?.identity.streakIcon || '🔥'}</Text>
              <Text style={styles.summaryValue}>{state?.streak ?? 0}</Text>
              <Text style={styles.summaryLabel}>{(state?.streak ?? 0) > 1 ? 'semaines' : 'semaine'} d'affilée{'\n'}(record {state?.best_streak ?? 0})</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="diamond" size={22} color={COLORS.blue} />
              <Text style={styles.summaryValue}>{state?.gems ?? 0}</Text>
              <Text style={styles.summaryLabel}>{currencyPlural(config?.identity.currencyName || 'Relyk')}</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="trophy" size={22} color={COLORS.yellow} />
              <Text style={styles.summaryValue}>{unlockedCount}</Text>
              <Text style={styles.summaryLabel}>Succès</Text>
            </View>
          </View>

          {/* Accès Boutique */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(tabs)/(secondary)/boutique' as any)} activeOpacity={0.85}>
              <Ionicons name="bag-handle-outline" size={16} color={COLORS.emerald} />
              <Text style={styles.actionText}>Boutique</Text>
            </TouchableOpacity>
          </View>

          {/* Succès débloqués */}
          {unlockedBadges.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Débloqués ({unlockedBadges.length})</Text>
              <View style={styles.grid}>{unlockedBadges.map(renderBadge)}</View>
            </>
          )}

          {/* Succès à débloquer */}
          {lockedBadges.length > 0 && (
            <>
              <Text style={styles.groupTitle}>À débloquer ({lockedBadges.length})</Text>
              <View style={styles.grid}>{lockedBadges.map(renderBadge)}</View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 26, fontWeight: '800', color: c.text, marginBottom: 12 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 60 },
    summary: { flexDirection: 'row', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, paddingVertical: 16, marginBottom: 18 },
    summaryItem: { flex: 1, alignItems: 'center', gap: 3 },
    summaryDivider: { width: 1, backgroundColor: c.cardBorder, marginVertical: 4 },
    summaryEmoji: { fontSize: 22 },
    summaryValue: { fontSize: 20, fontWeight: '800', color: c.text },
    summaryLabel: { fontSize: 10, color: c.textSecondary, textAlign: 'center', paddingHorizontal: 4 },
    actions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 12 },
    actionText: { fontSize: 13, fontWeight: '700', color: c.text },
    groupTitle: { fontSize: 13, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start', marginBottom: 16 },
    card: { width: '31%', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 16, padding: 10, alignItems: 'center', gap: 3 },
    badgeIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
    badgeImg: { width: 34, height: 34, borderRadius: 8 },
    lockOverlay: { position: 'absolute', bottom: -2, right: -2, backgroundColor: c.card, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: c.cardBorder },
    badgeLabel: { fontSize: 12, fontWeight: '700', color: c.text, textAlign: 'center' },
    badgeLevel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
    badgeDesc: { fontSize: 11, color: c.textSecondary, textAlign: 'center', lineHeight: 15 },
    rewardPill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: c.cardBorder + '55', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
    rewardText: { fontSize: 11, fontWeight: '800' },
  });
}
