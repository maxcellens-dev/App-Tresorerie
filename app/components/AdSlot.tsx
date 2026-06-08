/**
 * AdSlot — zone de publicité « maison » activable. N'affiche rien si les pubs sont désactivées
 * (admin) ou si l'utilisateur est Premium. Sinon montre une bannière configurée (image/texte).
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from '../hooks/useAppColors';
import { usePlan } from '../hooks/usePlan';
import { useAdsConfig } from '../hooks/useAdsConfig';

export default function AdSlot({ index = 0 }: { index?: number }) {
  const COLORS = useAppColors();
  const { user } = useAuth();
  const { showAds } = usePlan(user?.id);
  const { data } = useAdsConfig();

  if (!showAds) return null;
  const banners = data?.banners ?? [];
  if (banners.length === 0) return null;
  const banner = banners[index % banners.length];
  const open = () => { if (banner.url) Linking.openURL(banner.url).catch(() => {}); };

  return (
    <TouchableOpacity
      style={[styles.slot, { backgroundColor: COLORS.card, borderColor: COLORS.cardBorder }]}
      onPress={open}
      activeOpacity={banner.url ? 0.85 : 1}
      disabled={!banner.url}
    >
      <Text style={[styles.tag, { color: COLORS.textSecondary }]}>Sponsorisé</Text>
      {banner.image ? (
        <Image source={{ uri: banner.image }} style={styles.img} resizeMode="cover" />
      ) : (
        <View style={styles.textRow}>
          <Ionicons name="megaphone-outline" size={18} color={COLORS.emerald} />
          <Text style={[styles.text, { color: COLORS.text }]} numberOfLines={2}>{banner.text ?? banner.label ?? 'Découvrez nos partenaires'}</Text>
          {banner.url ? <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} /> : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  slot: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10, overflow: 'hidden', ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  tag: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  img: { width: '100%', height: 70, borderRadius: 8 },
  textRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 13, fontWeight: '600' },
});
