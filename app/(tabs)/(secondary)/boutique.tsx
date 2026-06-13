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
import { useProfile } from '../../hooks/useProfile';
import { useAppColors } from '../../hooks/useAppColors';
import { useGamification } from '../../hooks/useGamification';
import { usePlan } from '../../hooks/usePlan';
import { useNavBack } from '../../hooks/useNavBack';
import { isImageIcon, formatCurrency, SHOP_CATEGORY_ORDER, SHOP_CATEGORY_LABELS, type ShopItem, type ShopCategory } from '../../lib/gamification';
import { purchaseGemsPack, PURCHASES_SUPPORTED } from '../../lib/purchases';

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
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = (profile as any)?.is_admin === true;
  const { state, config, inventory, buyItem, creditGems, canClaimDailyGems } = useGamification(user?.id);
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<ShopTab>('app');
  const [confirmItem, setConfirmItem] = useState<{ key: string; label: string; price: number } | null>(null);

  const gems = state?.gems ?? 0;
  const freezes = state?.freezes ?? 0;
  const discountPct = config?.premium_discount_pct ?? 0;
  const priceOf = (base: number) => (isPremium ? Math.round(base * (1 - discountPct / 100)) : base);
  const currencyName = config?.identity.currencyName ?? 'Relyk';
  // Libellé / description calculés pour les articles « monnaie » (toujours au nom courant + pluriel).
  const gemsOf = (item: ShopItem) => Number((item.payload as any)?.gems) || 0;
  const itemLabel = (item: ShopItem) => (item.type === 'gems_iap' ? formatCurrency(gemsOf(item), currencyName) : item.label);
  const itemDesc = (item: ShopItem) => (item.type === 'daily_gems'
    ? `${formatCurrency(gemsOf(item) || 5, currencyName)} offert${(gemsOf(item) || 5) > 1 ? 's' : ''}, une fois par jour.`
    : item.description);

  // L'onglet « Relyka » est masquable en admin : si masqué, pas de barre d'onglets (seulement « App »).
  const relykaTabEnabled = config?.relyka_tab_enabled ?? true;
  const activeTab: ShopTab = relykaTabEnabled ? tab : 'app';

  // Articles regroupés par catégorie (dans l'ordre défini).
  // « Récupération de série » (streak_restore) n'est PAS en boutique : proposé à la connexion si la série est perdue.
  // 'accent_pack' retiré : la personnalisation de la couleur d'accent est désormais réservée au Premium.
  const shopItems = (config?.shop ?? []).filter((s) => s.type !== 'streak_restore' && s.type !== 'accent_pack');
  const shopByCategory = SHOP_CATEGORY_ORDER
    .map((cat) => ({ cat, items: shopItems.filter((s) => (s.category ?? 'series') === cat) }))
    .filter((g) => g.items.length > 0);

  const onBuy = async (key: string) => {
    setBusyKey(key); setMsg(null);
    const res = await buyItem(key);
    setBusyKey(null);
    setMsg(res.ok ? 'Acheté ✓' : `Impossible : ${res.reason}`);
  };

  // Pack de gemmes en argent réel (RevenueCat) → crédite les gemmes si l'achat aboutit.
  const onBuyGems = async (item: ShopItem) => {
    const productId = String((item.payload as any)?.productId ?? '');
    const gemsAmount = Number((item.payload as any)?.gems) || 0;
    setBusyKey(item.key); setMsg(null);
    const res = await purchaseGemsPack(productId);
    if (res.ok) { await creditGems(gemsAmount); setMsg(`+${formatCurrency(gemsAmount, currencyName)} ✓`); }
    else if (res.reason === 'cancelled') setMsg('Achat annulé.');
    else setMsg(res.message ?? 'Achat indisponible.');
    setBusyKey(null);
  };

  // Bouton d'achat selon le type d'article (cadeau du jour / pack gemmes / achat en gemmes).
  const renderBuyButton = (item: ShopItem) => {
    const busy = busyKey === item.key;
    if (item.type === 'daily_gems') {
      return (
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: canClaimDailyGems ? COLORS.green : COLORS.cardBorder, paddingHorizontal: 14 }]} onPress={() => canClaimDailyGems && onBuy(item.key)} disabled={!canClaimDailyGems || busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.buyText, { color: canClaimDailyGems ? '#fff' : COLORS.textSecondary }]}>{canClaimDailyGems ? 'Réclamer' : 'Demain'}</Text>}
        </TouchableOpacity>
      );
    }
    if (item.type === 'gems_iap') {
      return (
        <TouchableOpacity style={[styles.buyBtn, { backgroundColor: COLORS.yellow, paddingHorizontal: 14 }]} onPress={() => !busy && onBuyGems(item)} disabled={busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.buyText, { color: '#fff' }]}>Acheter</Text>}
        </TouchableOpacity>
      );
    }
    const price = priceOf(item.price);
    const canBuy = gems >= price && !busy;
    return (
      <TouchableOpacity style={[styles.buyBtn, { backgroundColor: canBuy ? COLORS.emerald : COLORS.cardBorder }]} onPress={() => canBuy && setConfirmItem({ key: item.key, label: item.label, price })} disabled={!canBuy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator size="small" color="#fff" /> : (
          <>
            <Ionicons name="diamond" size={12} color={canBuy ? '#fff' : COLORS.textSecondary} />
            <Text style={[styles.buyText, { color: canBuy ? '#fff' : COLORS.textSecondary }]}>{price}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Boutique</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Admin uniquement : crédite 100 relyks pour tester les achats facilement. */}
            {isAdmin && (
              <TouchableOpacity
                style={styles.adminGemBtn}
                onPress={async () => { await creditGems(100); setMsg('+100 relyks (admin)'); }}
                activeOpacity={0.85}
                accessibilityLabel="Ajouter 100 relyks (admin)"
              >
                <Ionicons name="add" size={14} color="#fff" />
                <Text style={styles.adminGemBtnText}>100</Text>
              </TouchableOpacity>
            )}
            <View style={styles.gemPill}>
              <Ionicons name="diamond" size={14} color={COLORS.blue} />
              <Text style={styles.gemText}>{gems}</Text>
            </View>
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

              {shopByCategory.map(({ cat, items }) => {
                const compact = cat === 'gems' || cat === 'series';
                return (
                  <View key={cat}>
                    <Text style={styles.catHeader}>{SHOP_CATEGORY_LABELS[cat as ShopCategory]}</Text>
                    {compact ? (
                      <View style={styles.compactGrid}>
                        {items.map((item) => {
                          const accentColor = item.type === 'gems_iap' ? COLORS.yellow : COLORS.blue;
                          return (
                            <View key={item.key} style={[styles.compactCard, cat === 'gems' ? styles.compactThird : styles.compactHalf]}>
                              <View style={[styles.itemIcon, { backgroundColor: accentColor + '22' }]}>
                                {isImageIcon(item.icon) ? <Image source={{ uri: item.icon! }} style={styles.itemImg} /> : <Ionicons name={(item.icon || 'pricetag') as any} size={20} color={accentColor} />}
                                {item.type === 'freeze' && freezes > 0 && (
                                  <View style={styles.countBadge}><Text style={styles.countBadgeText}>{freezes}</Text></View>
                                )}
                              </View>
                              <Text style={styles.compactLabel} numberOfLines={2}>{itemLabel(item)}</Text>
                              {item.type === 'freeze' && <Text style={styles.ownedText}>{freezes} en stock</Text>}
                              {renderBuyButton(item)}
                            </View>
                          );
                        })}
                      </View>
                    ) : (
                      items.map((item) => {
                        const owned = inventory.find((i) => i.item_key === item.key)?.qty ?? 0;
                        const accentColor = COLORS.blue;
                        return (
                          <View key={item.key} style={styles.card}>
                            <View style={[styles.itemIcon, { backgroundColor: accentColor + '22' }]}>
                              {isImageIcon(item.icon) ? <Image source={{ uri: item.icon! }} style={styles.itemImg} /> : <Ionicons name={(item.icon || 'pricetag') as any} size={22} color={accentColor} />}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemLabel}>
                                {itemLabel(item)}
                                {owned > 0 && item.type !== 'daily_gems' && <Text style={{ color: COLORS.green }}> · acquis</Text>}
                              </Text>
                              {!!itemDesc(item) && <Text style={styles.itemDesc}>{itemDesc(item)}</Text>}
                            </View>
                            {renderBuyButton(item)}
                          </View>
                        );
                      })
                    )}
                    {cat === 'gems' && !PURCHASES_SUPPORTED && (
                      <Text style={styles.gemsNote}>Les achats de relyks se font depuis l'application mobile Relyka.</Text>
                    )}
                  </View>
                );
              })}
              {shopByCategory.length === 0 && <Text style={styles.empty}>La boutique est vide pour le moment.</Text>}
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
              <Text style={{ fontWeight: '800', color: COLORS.text }}>{formatCurrency(confirmItem?.price ?? 0, currencyName)}</Text> ?
            </Text>
            <Text style={styles.modalBalance}>Solde après achat : {formatCurrency(Math.max(0, gems - (confirmItem?.price ?? 0)), currencyName)}</Text>
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
    adminGemBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
    adminGemBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
    tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 10, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
    tabBtnActive: { borderColor: c.emerald, backgroundColor: c.emerald + '14' },
    tabText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.emerald },
    sectionIntro: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginBottom: 14 },
    catHeader: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6 },
    gemsNote: { fontSize: 11.5, color: c.textSecondary, marginTop: -4, marginBottom: 8, lineHeight: 15 },
    soonPill: { backgroundColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    soonText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 60 },
    premiumBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 },
    premiumText: { flex: 1, fontSize: 12.5, color: c.text, fontWeight: '600' },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 12 },
    compactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
    compactCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 12, alignItems: 'center', gap: 8 },
    compactHalf: { flexBasis: '47%', flexGrow: 1 },
    compactThird: { flexBasis: '30%', flexGrow: 1 },
    compactLabel: { fontSize: 12.5, fontWeight: '700', color: c.text, textAlign: 'center' },
    ownedText: { fontSize: 11, fontWeight: '600', color: c.textSecondary, marginTop: -2 },
    countBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: c.blue, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    countBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
    itemIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    itemImg: { width: 28, height: 28, borderRadius: 6 },
    itemLabel: { fontSize: 14, fontWeight: '700', color: c.text },
    itemDesc: { fontSize: 11.5, color: c.textSecondary, marginTop: 2, lineHeight: 15 },
    buyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, minWidth: 64, justifyContent: 'center' },
    buyText: { fontSize: 13, fontWeight: '800' },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 30 },
    msg: { textAlign: 'center', marginTop: 12, fontWeight: '600' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    modalCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 20, padding: 24, alignItems: 'center' },
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
