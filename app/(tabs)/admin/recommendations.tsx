import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  TIER_ALLOCATIONS,
  RECO_COLORS,
  RECO_TYPE_LABELS,
  TIER_LABELS,
  TIER_COLORS,
} from '../../lib/recommendationEngine';
import type { RecoType, SavingsTier } from '../../lib/recommendationEngine';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

const RECO_ICONS: Record<RecoType, string> = {
  save: 'shield-outline',
  invest: 'trending-up-outline',
  enjoy: 'sparkles-outline',
  keep: 'hourglass-outline',
};

const RECO_DESC: Record<RecoType, string> = {
  save: 'Transférer vers l\'épargne de sécurité. Prioritaire quand les réserves sont basses.',
  invest: 'Alimenter un objectif d\'investissement. Prioritaire quand l\'épargne est confortable.',
  enjoy: 'Budget dépenses variables et loisirs. Toujours présent (10-30 %).',
  keep: 'Conserver sur le compte courant comme réserve. Augmente si le solde est tendu.',
};

const TIERS: SavingsTier[] = ['critical', 'below_optimal', 'healthy', 'comfortable'];
const TIER_CONDITIONS: Record<SavingsTier, string> = {
  critical: 'Épargne < seuil minimum',
  below_optimal: 'Minimum ≤ épargne < optimal',
  healthy: 'Optimal ≤ épargne < confort',
  comfortable: 'Épargne ≥ seuil confort',
};

const TYPES: RecoType[] = ['save', 'invest', 'enjoy', 'keep'];

const MODIFIERS = [
  { icon: 'analytics-outline', name: 'Tendance variables', desc: 'Si > 120 % → moins de plaisir, plus de réserve. Si < 80 % → un peu plus de plaisir.' },
  { icon: 'wallet-outline', name: 'Santé courant', desc: 'Si solde < 2× engagements mensuels → +10 pp sur Conserver.' },
  { icon: 'swap-horizontal-outline', name: 'Ratio invest/épargne', desc: 'Si investi < 15 % de l\'épargne → +8 pp sur Investir.' },
];

export default function RecommendationsAdmin() {
  const router = useRouter();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Recommandations</Text>
          <Text style={styles.subtitle}>
            Le moteur analyse la santé financière et propose 2 à 4 actions
            dont la somme fait 100 % du « À dépenser ».
          </Text>

          {/* ── Types ── */}
          <Text style={styles.sectionTitle}>Types de recommandation</Text>
          {TYPES.map(type => (
            <View key={type} style={[styles.typeCard, { borderLeftColor: RECO_COLORS[type] }]}>
              <View style={styles.typeHeader}>
                <Ionicons name={RECO_ICONS[type] as any} size={18} color={RECO_COLORS[type]} />
                <Text style={[styles.typeTitle, { color: RECO_COLORS[type] }]}>{RECO_TYPE_LABELS[type]}</Text>
              </View>
              <Text style={styles.typeDesc}>{RECO_DESC[type]}</Text>
            </View>
          ))}

          {/* ── Paliers ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Paliers d'allocation</Text>
          {TIERS.map(tier => (
            <View key={tier} style={styles.tierCard}>
              <View style={styles.tierHeader}>
                <View style={[styles.tierDot, { backgroundColor: TIER_COLORS[tier] }]} />
                <Text style={[styles.tierName, { color: TIER_COLORS[tier] }]}>{TIER_LABELS[tier]}</Text>
              </View>
              <Text style={styles.tierCondition}>{TIER_CONDITIONS[tier]}</Text>
              <View style={styles.allocRow}>
                {TYPES.map(type => (
                  <View key={type} style={styles.allocItem}>
                    <View style={[styles.allocDot, { backgroundColor: RECO_COLORS[type] }]} />
                    <Text style={styles.allocText}>
                      {RECO_TYPE_LABELS[type]} {TIER_ALLOCATIONS[tier][type]}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}

          {/* ── Modificateurs ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Modificateurs contextuels</Text>
          {MODIFIERS.map(m => (
            <View key={m.name} style={styles.modCard}>
              <Ionicons name={m.icon as any} size={18} color={COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modName}>{m.name}</Text>
                <Text style={styles.modDesc}>{m.desc}</Text>
              </View>
            </View>
          ))}

          {/* ── Règles ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Règles</Text>
          <View style={styles.rulesCard}>
            <Text style={styles.ruleItem}>• Recommandations &lt; 5 % → masquées et redistribuées</Text>
            <Text style={styles.ruleItem}>• Total = toujours 100 % du « À dépenser »</Text>
            <Text style={styles.ruleItem}>• 2 à 4 recommandations affichées</Text>
            <Text style={styles.ruleItem}>• Ignorables par mois (stockées en local)</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: COLORS.text, marginLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 12 },

  /* Types */
  typeCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
  },
  typeHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  typeTitle: { fontSize: 14, fontWeight: '700' },
  typeDesc: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },

  /* Tiers */
  tierCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  tierName: { fontSize: 14, fontWeight: '700' },
  tierCondition: { fontSize: 12, color: COLORS.textSecondary },
  allocRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  allocItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },

  /* Modifiers */
  modCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  modName: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  modDesc: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },

  /* Rules */
  rulesCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 14,
    gap: 6,
  },
  ruleItem: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
});
