/**
 * Boutique — dépense les gemmes gagnées (gels de série, thèmes, et plus tard bons hors-app).
 * Les abonnés Premium bénéficient d'une remise globale (premium_discount_pct).
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, ActivityIndicator, Modal } from 'react-native';
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

type ShopTab = 'app' | 'relyka';

/** Services Relyka — à développer dans le futur (rendez-vous, paiement à l'usage…). */
const RELYKA_SERVICES = [
  { icon: 'sparkles', title: 'Conseiller IA', desc: 'Une IA dédiée à ta gestion financière, paiement à l’usage.', soon: true },
  { icon: 'videocam', title: 'Conseiller en visio (1-on-1)', desc: 'Un échange en direct avec un conseiller pour t’aider sur ta gestion.', soon: true },
] as const;

export default function BoutiqueScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { state, config, inventory, buyItem } = useGamification(user?.id);
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<ShopTab>('app');
  const [confirmItem, setConfirmItem] = useState<{ key: string; label: string; price: number } | null>(null);

  const gems = state?.gems ?? 0;
  const discountPct = config?.premium_discount_pct ?? 0;
  const priceOf = (base: number) => (isPremium ? Math.round(base * (1 - discountPct / 100)) : base);
  const currencyName = config?.identity.currencyName ?? 'gemmes';

  // L'onglet « Relyka » est masquable en admin : si masqué, pas de barre d'onglets (seulement « App »).
  const relykaTabEnabled = config?.relyka_tab_enabled ?? true;
  const activeTab: ShopTab = relykaTabEnabled ? tab : 'app';

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

        {/* Onglets : App (gemmes/items) · Relyka (services) — la barre disparaît si Relyka masqué en admin */}
        {relykaTabEnabled && (
          <View style={styles.tabsRow}>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'app' && styles.tabBtnActive]} onPress={() => setTab('app')} activeOpacity={0.85}>
              <Ionicons name="diamond-outline" size={15} color={activeTab === 'app' ? COLORS.emerald : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'app' && styles.tabTextActive]}>App</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tabBtn, activeTab === 'relyka' && styles.tabBtnActive]} onPress={() => setTab('relyka')} activeOpacity={0.85}>
              <Ionicons name="sparkles-outline" size={15} color={activeTab === 'relyka' ? COLORS.emerald : COLORS.textSecondary} />
              <Text style={[styles.tabText, activeTab === 'relyka' && styles.tabTextActive]}>Relyka</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {activeTab === 'app' ? (
            <>
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
                    <TouchableOpacity style={[styles.buyBtn, { backgroundColor: canBuy ? COLORS.emerald : COLORS.cardBorder }]} onPress={() => canBuy && setConfirmItem({ key: item.key, label: item.label, price })} disabled={!canBuy} activeOpacity={0.85}>
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
            </>
          ) : (
            <>
              <Text style={styles.sectionIntro}>Des accompagnements humains et IA pour t’aider à mieux gérer tes finances.</Text>
              {RELYKA_SERVICES.map((svc) => (
                <View key={svc.title} style={styles.card}>
                  <View style={[styles.itemIcon, { backgroundColor: COLORS.emerald + '22' }]}>
                    <Ionicons name={svc.icon as any} size={22} color={COLORS.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemLabel}>{svc.title}</Text>
                    <Text style={styles.itemDesc}>{svc.desc}</Text>
                  </View>
                  {svc.soon && (
                    <View style={styles.soonPill}>
                      <Text style={styles.soonText}>Bientôt</Text>
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Confirmation d'achat (évite les dépenses accidentelles en un clic) */}
      <Modal visible={!!confirmItem} transparent animationType="fade" onRequestClose={() => setConfirmItem(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIcon, { backgroundColor: COLORS.blue + '22' }]}>
              <Ionicons name="diamond" size={26} color={COLORS.blue} />
            </View>
            <Text style={styles.modalTitle}>Confirmer l'achat</Text>
            <Text style={styles.modalText}>
              Acheter « {confirmItem?.label} » pour{' '}
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{confirmItem?.price} {currencyName}</Text> ?
            </Text>
            <Text style={styles.modalBalance}>Solde après achat : {Math.max(0, gems - (confirmItem?.price ?? 0))} {currencyName}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setConfirmItem(null)} activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirm}
                onPress={() => { const k = confirmItem!.key; setConfirmItem(null); onBuy(k); }}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.modalConfirmText}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    title: { fontSize: 26, fontWeight: '800', color: c.text },
    gemPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    gemText: { fontSize: 14, fontWeight: '800', color: c.text },
    tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    tabBtnActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    tabText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.emerald },
    sectionIntro: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginBottom: 14 },
    soonPill: { backgroundColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    soonText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
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
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    modalCard: { width: '100%', maxWidth: 380, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, padding: 24, alignItems: 'center' },
    modalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 8 },
    modalText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
    modalBalance: { fontSize: 12, color: c.textSecondary, marginTop: 8 },
    modalBtns: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
    modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 13 },
    modalCancelText: { fontSize: 14, fontWeight: '700', color: c.text },
    modalConfirm: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13 },
    modalConfirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  });
}
