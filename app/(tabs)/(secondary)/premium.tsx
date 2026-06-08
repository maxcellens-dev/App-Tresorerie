/**
 * Premium — présentation de l'offre. Le paiement réel (RevenueCat/Stripe) sera branché
 * ensuite ; ici on présente les avantages. Si l'offre est désactivée en admin, écran neutre.
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/ScreenGradient';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../../hooks/useAppColors';
import { usePlan } from '../../hooks/usePlan';
import { useGamificationConfig } from '../../hooks/useGamificationConfig';
import { purchasePremium } from '../../lib/purchases';

const BENEFITS = [
  { icon: 'eye-off', title: 'Zéro publicité', desc: 'Une expérience 100% épurée, sans bannières.' },
  { icon: 'pricetags', title: 'Remise boutique', desc: 'Une réduction sur tous les achats en gemmes.' },
  { icon: 'sparkles', title: 'Conseiller personnalisé', desc: 'Des conseils sur-mesure selon ton profil (bientôt).' },
  { icon: 'people', title: 'Plan famille', desc: 'Lie deux comptes pour un foyer (bientôt).' },
];

export default function PremiumScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { isPremium, premiumEnabled } = usePlan(user?.id);
  const { data: gam } = useGamificationConfig();
  const discount = gam?.premium_discount_pct ?? 0;
  const [purchaseMsg, setPurchaseMsg] = React.useState<string | null>(null);
  const onSubscribe = async () => {
    const res = await purchasePremium(user?.id);
    if (!res.ok) setPurchaseMsg(res.message ?? 'Souscription bientôt disponible.');
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
                <Ionicons name={b.icon as any} size={20} color={COLORS.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefitTitle}>{b.title === 'Remise boutique' ? `Remise boutique −${discount}%` : b.title}</Text>
                <Text style={styles.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}

          {premiumEnabled && !isPremium && (
            <>
              <TouchableOpacity style={[styles.cta, { backgroundColor: COLORS.emerald }]} activeOpacity={0.85} onPress={onSubscribe}>
                <Text style={[styles.ctaText, { color: '#fff' }]}>Devenir Premium</Text>
              </TouchableOpacity>
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
    hero: { alignItems: 'center', gap: 6, marginVertical: 16 },
    heroTitle: { fontSize: 30, fontWeight: '900', color: c.text },
    heroSub: { fontSize: 14, color: c.textSecondary },
    note: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, marginBottom: 16, backgroundColor: c.card },
    noteText: { fontSize: 13, color: c.textSecondary, textAlign: 'center' },
    benefit: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 16, marginBottom: 12 },
    benefitIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    benefitTitle: { fontSize: 15, fontWeight: '700', color: c.text },
    benefitDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
    cta: { backgroundColor: c.cardBorder, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    ctaText: { fontSize: 15, fontWeight: '700', color: c.textSecondary },
    purchaseMsg: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 10 },
  });
}
