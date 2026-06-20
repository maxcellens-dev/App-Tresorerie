/**
 * Écran Succès — grille de trophées débloquables (style Duolingo).
 * Chaque badge montre son icône/image, son niveau atteint (Bronze/Argent/Or) et sa description.
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/useAppColors';
import { useGamification } from '../../../hooks/useGamification';
import { useMonthlyClosure } from '../../../hooks/useMonthlyClosure';
import { useNavBack } from '../../../hooks/useNavBack';
import { UNLOCK_COLOR, WELCOME_BADGE_KEY, isImageIcon, currencyPlural, type BadgeDef } from '../../../lib/gamification';

export default function SuccesScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { state, badges, config, markBadgesCelebrated } = useGamification(user?.id);
  const { enabled: closureEnabled } = useMonthlyClosure(user?.id);

  // « Bienvenue » est consommé ici (et non en pop-up) : à la 1ʳᵉ visite de la page Succès,
  // on le marque célébré s'il ne l'est pas encore. Idempotent → no-op aux visites suivantes.
  // En consultation admin : on ne consomme PAS le badge du compte cible (laissé à l'utilisateur).
  useEffect(() => {
    if (isImpersonating) return;
    const welcome = badges.find((b) => b.badge_key === WELCOME_BADGE_KEY && !b.celebrated_at);
    if (welcome) markBadgesCelebrated([WELCOME_BADGE_KEY]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badges, isImpersonating]);

  const unlockedKeys = new Set(badges.map((b) => b.badge_key));
  // Succès affiché en grand au centre de l'écran (au clic sur une carte).
  const [selected, setSelected] = useState<BadgeDef | null>(null);

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
      <TouchableOpacity
        key={def.key}
        style={[styles.card, unlocked && { borderColor: tint + '88' }]}
        onPress={() => setSelected(def)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={def.label}
      >
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
        {/* Récompense affichée uniquement sur les succès À DÉBLOQUER (motivation) ;
            sur les succès déjà obtenus, on la voit en grand au clic. */}
        {!unlocked && def.gems > 0 && (
          <View style={styles.rewardPill}>
            <Ionicons name="diamond" size={11} color={COLORS.textSecondary} />
            <Text style={[styles.rewardText, { color: COLORS.textSecondary }]}>+{def.gems}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
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
            {/* Toucher ses Relyks → boutique (onglet « Recharger en relyks »). */}
            <TouchableOpacity
              style={styles.summaryItem}
              onPress={() => router.push('/(tabs)/(secondary)/boutique?focus=gems' as any)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Recharger en relyks"
            >
              <Ionicons name="diamond" size={22} color={COLORS.blue} />
              <Text style={styles.summaryValue}>{state?.gems ?? 0}</Text>
              <Text style={styles.summaryLabel}>{currencyPlural(config?.identity.currencyName || 'Relyk')}</Text>
            </TouchableOpacity>
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

      {/* Succès agrandi au centre de l'écran */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (() => {
            const unlocked = unlockedKeys.has(selected.key);
            const tint = unlocked ? UNLOCK_COLOR : COLORS.textSecondary;
            const date = badges.find((b) => b.badge_key === selected.key)?.unlocked_at;
            const dateStr = date ? new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
            return (
              <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
                <TouchableOpacity style={styles.modalClose} onPress={() => setSelected(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
                <View style={[styles.modalIcon, { backgroundColor: tint + '22', opacity: unlocked ? 1 : 0.6 }]}>
                  {isImageIcon(selected.icon)
                    ? <Image source={{ uri: selected.icon }} style={styles.modalIconImg} />
                    : <Ionicons name={(selected.icon || 'trophy') as any} size={64} color={tint} />}
                  {!unlocked && (
                    <View style={styles.modalLockOverlay}>
                      <Ionicons name="lock-closed" size={18} color={COLORS.textSecondary} />
                    </View>
                  )}
                </View>
                <Text style={styles.modalLabel}>{selected.label}</Text>
                <Text style={styles.modalDesc}>{selected.description}</Text>
                {selected.gems > 0 && (
                  <View style={[styles.modalReward, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
                    <Ionicons name="diamond" size={15} color={tint} />
                    <Text style={[styles.modalRewardText, { color: tint }]}>+{selected.gems} {currencyPlural(config?.identity.currencyName || 'Relyk')}</Text>
                  </View>
                )}
                <View style={[styles.modalStatusPill, { backgroundColor: unlocked ? UNLOCK_COLOR + '1A' : COLORS.cardBorder + '55' }]}>
                  <Ionicons name={unlocked ? 'checkmark-circle' : 'lock-closed'} size={14} color={unlocked ? UNLOCK_COLOR : COLORS.textSecondary} />
                  <Text style={[styles.modalStatusText, { color: unlocked ? UNLOCK_COLOR : COLORS.textSecondary }]}>
                    {unlocked ? (dateStr ? `Débloqué le ${dateStr}` : 'Débloqué') : 'À débloquer'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })()}
        </TouchableOpacity>
      </Modal>
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
    rewardPill: { position: 'absolute', top: -8, right: -6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
    rewardText: { fontSize: 10.5, fontWeight: '800' },
    // ── Modal « succès en grand » ──
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    modalCard: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 24, paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center' },
    modalClose: { position: 'absolute', top: 12, right: 12, padding: 4, zIndex: 2 },
    modalIcon: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    modalIconImg: { width: 72, height: 72, borderRadius: 16 },
    modalLockOverlay: { position: 'absolute', bottom: 2, right: 2, backgroundColor: c.cardSolid ?? c.card, borderRadius: 14, padding: 5, borderWidth: 1, borderColor: c.cardBorder },
    modalLabel: { fontSize: 22, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 8 },
    modalDesc: { fontSize: 14.5, color: c.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
    modalReward: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 12 },
    modalRewardText: { fontSize: 14, fontWeight: '800' },
    modalStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    modalStatusText: { fontSize: 12.5, fontWeight: '700' },
  });
}
