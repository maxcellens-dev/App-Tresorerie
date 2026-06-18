/**
 * Premium — présentation de l'offre. Le paiement réel (RevenueCat/Stripe) sera branché
 * ensuite ; ici on présente les avantages. Si l'offre est désactivée en admin, écran neutre.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/useAppColors';
import { usePlan, useSetPremium } from '../../../hooks/usePlan';
import { useNavBack } from '../../../hooks/useNavBack';
import { useGamificationConfig } from '../../../hooks/useGamificationConfig';
import { purchasePremium, restorePurchases, getSubscriptionInfo, PURCHASES_SUPPORTED, type SubscriptionInfo } from '../../../lib/purchases';

const BENEFITS = [
  { icon: 'eye-off', title: 'Zéro publicité', desc: 'Une expérience 100% épurée, sans bannières.' },
  { icon: 'pricetags', title: 'Remise boutique', desc: 'Une réduction sur tous les achats en relyks.' },
  { icon: 'color-palette', title: 'Couleur personnalisée', desc: 'Choisis la couleur d\'accent que tu veux.' },
  { icon: 'bar-chart', title: 'Reporting', desc: 'Tableaux et graphiques détaillés de tes finances dans le temps.' },
  { icon: 'sparkles', title: 'Conseils personnalisés (bientôt)', desc: 'Des conseils sur-mesure selon ton profil.' },
];

// Prix affichés (alignés sur ceux du store Google Play).
const PLAN_PRICES = { monthly: '1,99 €', annual: '19,99 €' } as const;

export default function PremiumScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const setPremium = useSetPremium(user?.id);
  const { data: gam } = useGamificationConfig();
  const discount = gam?.premium_discount_pct ?? 0;
  const [selectedPlan, setSelectedPlan] = React.useState<'monthly' | 'annual'>('annual');
  const [purchaseMsg, setPurchaseMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<null | 'buy' | 'restore'>(null);
  const [sub, setSub] = React.useState<SubscriptionInfo | null>(null);

  const refreshSub = React.useCallback(async () => {
    if (!PURCHASES_SUPPORTED) return;
    setSub(await getSubscriptionInfo());
  }, []);
  React.useEffect(() => { refreshSub(); }, [refreshSub, isPremium]);

  const onSubscribe = async () => {
    setPurchaseMsg(null);
    setBusy('buy');
    const res = await purchasePremium(selectedPlan, user?.id);
    setBusy(null);
    if (res.ok) {
      // Achat confirmé → on bascule en Premium immédiatement (RevenueCat reste la source de vérité).
      setPremium.mutate(true);
      setPurchaseMsg('🎉 Bienvenue dans Premium ! Ton abonnement est actif.');
      refreshSub();
    } else if (res.reason === 'cancelled') {
      setPurchaseMsg('Souscription annulée. Tu peux réessayer quand tu veux.');
    } else {
      setPurchaseMsg(res.message ?? 'Souscription indisponible pour le moment.');
    }
  };

  const onRestore = async () => {
    setPurchaseMsg(null);
    setBusy('restore');
    const res = await restorePurchases();
    setBusy(null);
    if (res.ok) {
      setPremium.mutate(true);
      setPurchaseMsg('Achats restaurés. Ton abonnement Premium est de nouveau actif.');
      refreshSub();
    } else {
      setPurchaseMsg(res.message ?? 'Aucun abonnement à restaurer.');
    }
  };

  const onManage = () => {
    const url = sub?.managementURL
      ?? (Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions');
    Linking.openURL(url).catch(() => {});
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={styles.hero}>
            <Ionicons name="star" size={36} color={COLORS.yellow} />
            <Text style={styles.heroTitle}>Premium</Text>
            <Text style={styles.heroSub}>Tire le maximum de Relyka.</Text>
          </View>

          {!premiumEnabled && (
            <View style={styles.note}><Text style={styles.noteText}>L'offre Premium n'est pas encore disponible. Reviens bientôt !</Text></View>
          )}
          {isPremium && (
            <View style={[styles.note, { borderColor: COLORS.emerald + '66' }]}><Text style={[styles.noteText, { color: COLORS.emerald }]}>Tu es Premium. Merci ! 💚</Text></View>
          )}

          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: COLORS.emerald + '22' }]}>
                <Ionicons name={b.icon as any} size={17} color={COLORS.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title === 'Remise boutique' ? `Remise boutique −${discount}%` : b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}

          {/* Offres */}
          {premiumEnabled && !isPremium && (
            <>
              <View style={styles.offersRow}>
                <TouchableOpacity
                  style={[styles.offerCard, selectedPlan === 'monthly' && { borderColor: COLORS.emerald, borderWidth: 2 }]}
                  onPress={() => setSelectedPlan('monthly')}
                  activeOpacity={0.8}
                >
                  {selectedPlan === 'monthly' && <View style={[styles.bestBadge, { backgroundColor: COLORS.emerald }]}><Text style={styles.bestBadgeText}>✓ Sélectionné</Text></View>}
                  <Text style={styles.offerName}>Mensuel</Text>
                  <Text style={styles.offerPrice}>{PLAN_PRICES.monthly}<Text style={styles.offerPeriod}> / mois</Text></Text>
                  <Text style={styles.offerDesc}>Sans engagement, résiliable à tout moment.</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.offerCard, { borderColor: selectedPlan === 'annual' ? COLORS.emerald : COLORS.cardBorder, borderWidth: selectedPlan === 'annual' ? 2 : 1 }]}
                  onPress={() => setSelectedPlan('annual')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.bestBadge, { backgroundColor: selectedPlan === 'annual' ? COLORS.emerald : COLORS.yellow }]}>
                    <Text style={styles.bestBadgeText}>{selectedPlan === 'annual' ? '✓ Sélectionné' : 'Avantageux'}</Text>
                  </View>
                  <Text style={styles.offerName}>Annuel</Text>
                  <Text style={styles.offerPrice}>{PLAN_PRICES.annual}<Text style={styles.offerPeriod}> / an</Text></Text>
                  <Text style={styles.offerDesc}>Le meilleur prix sur l'année.</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.cta, { backgroundColor: COLORS.emerald }]} activeOpacity={0.85} onPress={onSubscribe} disabled={busy !== null}>
                {busy === 'buy' ? <ActivityIndicator color="#fff" /> : <Text style={[styles.ctaText, { color: '#fff' }]}>S'abonner — {selectedPlan === 'monthly' ? 'Mensuel' : 'Annuel'}</Text>}
              </TouchableOpacity>

              {PURCHASES_SUPPORTED && (
                <TouchableOpacity style={styles.restoreBtn} activeOpacity={0.7} onPress={onRestore} disabled={busy !== null}>
                  {busy === 'restore' ? <ActivityIndicator color={COLORS.textSecondary} size="small" /> : <Text style={styles.restoreText}>Restaurer mes achats</Text>}
                </TouchableOpacity>
              )}

              <Text style={styles.legal}>
                L'abonnement se renouvelle automatiquement sauf annulation au moins 24 h avant l'échéance, depuis les réglages de ton compte {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}. Le paiement est prélevé à la confirmation.
              </Text>
              {purchaseMsg && <Text style={styles.purchaseMsg}>{purchaseMsg}</Text>}
            </>
          )}

          {/* Abonné : statut + gestion / annulation */}
          {isPremium && (
            <>
              {sub?.active && (
                <View style={styles.statusCard}>
                  <View style={styles.statusRow}>
                    <Text style={styles.statusLabel}>Statut</Text>
                    <Text style={[styles.statusValue, { color: COLORS.emerald }]}>Actif{sub.periodType === 'trial' ? ' (essai)' : ''}</Text>
                  </View>
                  {sub.expirationDate && (
                    <View style={styles.statusRow}>
                      <Text style={styles.statusLabel}>{sub.willRenew ? 'Prochain renouvellement' : 'Actif jusqu’au'}</Text>
                      <Text style={styles.statusValue}>{fmtDate(sub.expirationDate)}</Text>
                    </View>
                  )}
                  {!sub.willRenew && (
                    <Text style={styles.cancelNote}>Renouvellement automatique désactivé : tu garderas Premium jusqu'à cette date, puis l'abonnement prendra fin.</Text>
                  )}
                </View>
              )}

              {PURCHASES_SUPPORTED ? (
                <>
                  <TouchableOpacity style={[styles.cta, { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder }]} activeOpacity={0.85} onPress={onManage}>
                    <Text style={[styles.ctaText, { color: COLORS.text }]}>{sub && !sub.willRenew ? 'Gérer l’abonnement' : 'Gérer / annuler l’abonnement'}</Text>
                  </TouchableOpacity>
                  <Text style={styles.legal}>L'annulation se fait depuis les réglages d'abonnement de ton store. L'accès Premium reste actif jusqu'à la fin de la période déjà payée.</Text>
                </>
              ) : (
                <Text style={styles.legal}>Gère ou annule ton abonnement depuis l'application mobile Relyka (réglages d'abonnement {Platform.OS === 'ios' ? 'App Store' : 'Google Play'}).</Text>
              )}
              {purchaseMsg && <Text style={styles.purchaseMsg}>{purchaseMsg}</Text>}
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
    hero: { alignItems: 'center', gap: 4, marginTop: 6, marginBottom: 12 },
    heroTitle: { fontSize: 26, fontWeight: '900', color: c.text },
    heroSub: { fontSize: 13, color: c.textSecondary },
    note: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: c.card },
    noteText: { fontSize: 13, color: c.textSecondary, textAlign: 'center' },
    benefit: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, marginBottom: 7 },
    benefitIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    benefitTitle: { fontSize: 13.5, fontWeight: '700', color: c.text },
    benefitDesc: { fontSize: 11, color: c.textSecondary, marginTop: 1, lineHeight: 14 },
    cta: { backgroundColor: c.cardBorder, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    ctaText: { fontSize: 15, fontWeight: '700', color: c.textSecondary },
    purchaseMsg: { fontSize: 13, color: c.text, textAlign: 'center', marginTop: 12, lineHeight: 18 },
    offersRow: { flexDirection: 'row', gap: 12, marginTop: 6, marginBottom: 4 },
    offerCard: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, gap: 4 },
    offerName: { fontSize: 15, fontWeight: '800', color: c.text },
    offerPrice: { fontSize: 18, fontWeight: '900', color: c.emerald, marginTop: 2 },
    offerPeriod: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
    offerDesc: { fontSize: 11.5, color: c.textSecondary, lineHeight: 15 },
    bestBadge: { position: 'absolute', top: -9, right: 10, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    bestBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    restoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 4 },
    restoreText: { fontSize: 13, fontWeight: '600', color: c.textSecondary, textDecorationLine: 'underline' },
    legal: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 15 },
    statusCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginTop: 8, gap: 10 },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    statusLabel: { fontSize: 13, color: c.textSecondary },
    statusValue: { fontSize: 14, fontWeight: '700', color: c.text },
    cancelNote: { fontSize: 12, color: c.textSecondary, lineHeight: 16, marginTop: 2 },
  });
}
