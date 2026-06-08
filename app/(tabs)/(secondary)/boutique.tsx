/**
 * Boutique — dépense les gemmes gagnées (gels de série, thèmes, et plus tard bons hors-app).
 * Les abonnés Premium bénéficient d'une remise globale (premium_discount_pct).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/ScreenGradient';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { useGamification } from '../../hooks/useGamification';
import { usePlan } from '../../hooks/usePlan';
import { isImageIcon } from '../../lib/gamification';

export default function BoutiqueScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { state, config, inventory, buyItem } = useGamification(user?.id);
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const gems = state?.gems ?? 0;
  const discountPct = config?.premium_discount_pct ?? 0;
  const priceOf = (base: number) => (isPremium ? Math.round(base * (1 - discountPct / 100)) : base);

  const onBuy = async (key: string) => {
    setBusyKey(key); setMsg(null);
    const res = await buyItem(key);
    setBusyKey(null);
    setMsg(res.ok ? 'Acheté ✓' : `Impossible : ${res.reason}`);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Boutique</Text>
          <View style={styles.gemPill}>
            <Ionicons name="diamond" size={14} color={COLORS.blue} />
            <Text style={styles.gemText}>{gems}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Bandeau premium */}
          {premiumEnabled && (
            isPremium ? (
              <View style={[styles.premiumBanner, { borderColor: COLORS.emerald + '66' }]}>
                <Ionicons name="star" size={16} color={COLORS.emerald} />
                <Text style={styles.premiumText}>Premium actif — remise de {discountPct}% appliquée.</Text>
              </View>
            ) : (
              <TouchableOpacity style={[styles.premiumBanner, { borderColor: COLORS.yellow + '66' }]} onPress={() => router.push('/(tabs)/(secondary)/premium' as any)} activeOpacity={0.85}>
                <Ionicons name="star-outline" size={16} color={COLORS.yellow} />
                <Text style={styles.premiumText}>Passez Premium : −{discountPct}% sur la boutique + zéro pub.</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )
          )}

          {(config?.shop ?? []).map((item) => {
            const owned = inventory.find((i) => i.item_key === item.key)?.qty ?? 0;
            const price = priceOf(item.price);
            const canBuy = gems >= price && busyKey !== item.key;
            return (
              <View key={item.key} style={styles.card}>
                <View style={[styles.itemIcon, { backgroundColor: COLORS.blue + '22' }]}>
                  {isImageIcon(item.icon) ? <Image source={{ uri: item.icon! }} style={styles.itemImg} /> : <Ionicons name={(item.icon || 'pricetag') as any} size={22} color={COLORS.blue} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemLabel}>{item.label}{owned > 0 ? ` · ${owned}` : ''}</Text>
                  {!!item.description && <Text style={styles.itemDesc}>{item.description}</Text>}
                </View>
                <TouchableOpacity style={[styles.buyBtn, { backgroundColor: canBuy ? COLORS.emerald : COLORS.cardBorder }]} onPress={() => canBuy && onBuy(item.key)} disabled={!canBuy} activeOpacity={0.85}>
                  {busyKey === item.key ? <ActivityIndicator size="small" color="#fff" /> : (
                    <>
                      <Ionicons name="diamond" size={12} color={canBuy ? '#fff' : COLORS.textSecondary} />
                      <Text style={[styles.buyText, { color: canBuy ? '#fff' : COLORS.textSecondary }]}>{price}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
          {(config?.shop ?? []).length === 0 && <Text style={styles.empty}>La boutique est vide pour le moment.</Text>}
          {msg && <Text style={[styles.msg, { color: msg.startsWith('Acheté') ? COLORS.emerald : COLORS.danger }]}>{msg}</Text>}
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
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { fontSize: 26, fontWeight: '800', color: c.text },
    gemPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    gemText: { fontSize: 14, fontWeight: '800', color: c.text },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 60 },
    premiumBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
    premiumText: { flex: 1, fontSize: 12.5, color: c.text, fontWeight: '600' },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    itemIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    itemImg: { width: 28, height: 28, borderRadius: 6 },
    itemLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    itemDesc: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 15 },
    buyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, minWidth: 64, justifyContent: 'center' },
    buyText: { fontSize: 13, fontWeight: '800' },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 30 },
    msg: { textAlign: 'center', marginTop: 12, fontWeight: '600' },
  });
}
