/**
 * AdSlot — zone de publicité « maison » par emplacement (1 par page principale).
 * - N'affiche rien si pubs désactivées (admin), utilisateur Premium, ou aucune bannière
 *   pour cet emplacement.
 * - Plusieurs bannières sur le même emplacement → rotation en fondu enchaîné, durée
 *   paramétrable en admin (rotation_seconds).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, Platform, Animated, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { usePlan } from '../hooks/usePlan';
import { useAdsConfig, bannerPlacements, type AdPlacement } from '../hooks/useAdsConfig';
import { logEvent } from '../lib/analytics';

// Impressions déjà comptées dans la session (1 par bannière × emplacement) → évite le flood.
const seenImpressions = new Set<string>();

export default function AdSlot({ placement, compact = false, style }: { placement: AdPlacement; compact?: boolean; style?: ViewStyle }) {
  const COLORS = useAppColors();
  const { user } = useAuth();
  const { showAds } = usePlan(user?.id);
  const { data } = useAdsConfig();

  // Masquage global (admin) → aucune bannière. Sinon on exclut les bannières masquées une à une.
  const adsDisabled = !!data?.disabled;
  const banners = adsDisabled ? [] : (data?.banners ?? []).filter((b) => !b.hidden && bannerPlacements(b).includes(placement));
  const count = banners.length;
  const rotationMs = Math.max(2, data?.rotation_seconds ?? 6) * 1000;
  // Opacité globale des bannières (réglable en admin).
  const baseOpacity = Math.max(0, Math.min(1, (data?.opacity ?? 100) / 100));

  const [idx, setIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  // Rotation en fondu si plusieurs bannières au même emplacement.
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setIdx((i) => (i + 1) % count);
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    }, rotationMs);
    return () => clearInterval(t);
  }, [count, rotationMs, opacity]);

  // Garder l'index dans les bornes si la liste change.
  useEffect(() => { if (idx >= count && count > 0) setIdx(0); }, [count, idx]);

  // Impression publicitaire (1 fois par bannière et par emplacement dans la session).
  useEffect(() => {
    if (!showAds || count === 0) return;
    const b = banners[Math.min(idx, count - 1)];
    if (!b) return;
    const key = `${placement}:${b.id}`;
    if (seenImpressions.has(key)) return;
    seenImpressions.add(key);
    logEvent('ad_impression', placement, { bannerId: b.id, label: b.label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, count, showAds, placement]);

  if (!showAds || count === 0) return null;
  const banner = banners[Math.min(idx, count - 1)];
  const open = () => {
    logEvent('ad_click', placement, { bannerId: banner.id, label: banner.label });
    if (banner.url) Linking.openURL(banner.url).catch(() => {});
  };

  return (
    <Animated.View style={[{ opacity }, compact ? styles.compactWrap : null, style]}>
      <TouchableOpacity
        style={[styles.slot, compact && styles.slotCompact, { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, opacity: baseOpacity }]}
        onPress={open}
        activeOpacity={banner.url ? 0.85 : 1}
        disabled={!banner.url}
      >
        {banner.image ? (
          // Image quasi pleine zone + tag « Sponsorisé » en overlay (pastille sombre
          // + ombre du texte → lisible quelle que soit l'image).
          <>
            <Image source={{ uri: banner.image }} style={compact ? styles.imgCompact : styles.img} resizeMode="cover" />
            <View style={styles.tagOverlay}>
              <Text style={styles.tagOverlayText}>Sponsorisé</Text>
            </View>
          </>
        ) : (
          <View style={compact ? styles.textWrapCompact : styles.textWrap}>
            {!compact && <Text style={[styles.tag, { color: COLORS.textSecondary }]}>Sponsorisé</Text>}
            <Animated.View style={styles.textRow}>
              <Ionicons name="megaphone-outline" size={compact ? 15 : 18} color={COLORS.emerald} />
              <Text style={[compact ? styles.textCompact : styles.text, { color: COLORS.text }]} numberOfLines={2}>{banner.text ?? banner.label ?? 'Découvrez nos partenaires'}</Text>
              {banner.url ? <Ionicons name="chevron-forward" size={compact ? 13 : 16} color={COLORS.textSecondary} /> : null}
            </Animated.View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { borderWidth: 1, borderRadius: 14, marginVertical: 6, overflow: 'hidden', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  // Variante compacte : remplit l'espace dispo à côté d'autres éléments (ex. actions Comptes).
  compactWrap: { flex: 1 },
  slotCompact: { marginVertical: 0, height: 64, justifyContent: 'center' },
  imgCompact: { width: '100%', height: 64 },
  textWrapCompact: { paddingHorizontal: 10, paddingVertical: 8 },
  textCompact: { flex: 1, fontSize: 11.5, fontWeight: '600' },
  // Image pleine largeur à RATIO FORCÉ (≈3,5:1) → même forme sur toutes les pages, quelle que
  // soit la largeur disponible. Uploader au ratio 3,5:1 (ex. 1400×400) pour éviter tout recadrage.
  img: { width: '100%', aspectRatio: 3.5 },
  tagOverlay: { position: 'absolute', top: 7, left: 7, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  tagOverlayText: { fontSize: 8.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, color: '#fff', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  textWrap: { padding: 12 },
  tag: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 13, fontWeight: '600' },
});
