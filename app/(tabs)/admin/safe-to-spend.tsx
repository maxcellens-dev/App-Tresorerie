import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

const STEP_COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#22d3ee', '#34d399'];

const STEPS = [
  {
    label: 'Étape 1 — Net restant du mois',
    formula: 'Σ transactions futures ce mois (recettes − dépenses)',
    explanation: 'Toutes les transactions planifiées après aujourd\'hui dans le mois courant : recettes (+) et dépenses (−).',
  },
  {
    label: 'Étape 2 — Engagements mensuels',
    formula: 'Σ projets actifs (alloc. mensuelle) + Σ objectifs actifs (cible annuelle ÷ 12)',
    explanation: 'Montants réservés chaque mois pour projets et objectifs en cours.',
  },
  {
    label: 'Étape 3 — Réservations même compte',
    formula: 'Σ (transactions passées × allocation) par projet source = destination',
    explanation: 'Quand un projet épargne sur le même compte, l\'argent reste mais est déjà "réservé".',
  },
  {
    label: 'Étape 4 — Base à dépenser',
    formula: 'solde courant + net restant − engagements − réservations',
    explanation: 'Solde réel moins tout ce qui est engagé ou réservé.',
  },
  {
    label: 'Étape 5 — Marge de sécurité',
    formula: 'max(0, base × (1 − marge% ÷ 100))',
    explanation: 'Retenue configurable dans Paramètres (10% par défaut). Le résultat ne peut jamais être négatif.',
  },
];

const VARIABLES = [
  ['solde_courant', 'Σ accounts(checking).balance'],
  ['remaining_month_net', 'transactions future ce mois'],
  ['committed_projects', 'Σ projects(active).monthly_allocation'],
  ['committed_objectives', 'Σ objectives(active).target_yearly / 12'],
  ['same_account_reserved', 'transactions passées × allocation'],
  ['marge_sécurité', 'profiles.safety_margin_percent (défaut 10%)'],
];

export default function SafeToSpendAdmin() {
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
          <Text style={styles.title}>Formule « À dépenser »</Text>
          <Text style={styles.subtitle}>
            Explication complète du calcul du montant affiché sur le Tableau de bord.
          </Text>

          {/* ── Formule résumée ── */}
          <View style={styles.formulaCard}>
            <Text style={styles.formulaLine}>  Solde courant</Text>
            <Text style={styles.formulaLine}>+ Transactions futures du mois (net)</Text>
            <Text style={styles.formulaLine}>− Engagements projets (alloc. mensuelle)</Text>
            <Text style={styles.formulaLine}>− Engagements objectifs (cible ÷ 12)</Text>
            <Text style={styles.formulaLine}>− Réservations même-compte (passées)</Text>
            <Text style={styles.formulaDivider}>─────────────────────────────────</Text>
            <Text style={styles.formulaLine}>= Base à dépenser</Text>
            <Text style={styles.formulaLine}>× (1 − marge de sécurité %)</Text>
            <Text style={styles.formulaDivider}>─────────────────────────────────</Text>
            <Text style={[styles.formulaLine, { color: '#34d399', fontWeight: '700' }]}>= À dépenser ou placer en sécurité</Text>
          </View>

          {/* ── Étapes ── */}
          <Text style={styles.sectionTitle}>Étapes détaillées</Text>
          {STEPS.map((step, i) => (
            <View key={i} style={[styles.stepCard, { borderLeftColor: STEP_COLORS[i] }]}>
              <Text style={[styles.stepLabel, { color: STEP_COLORS[i] }]}>{step.label}</Text>
              <Text style={styles.stepFormula}>{step.formula}</Text>
              <Text style={styles.stepExplanation}>{step.explanation}</Text>
            </View>
          ))}

          {/* ── Variables ── */}
          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Variables d'entrée</Text>
          {VARIABLES.map(([name, source]) => (
            <View key={name} style={styles.varRow}>
              <Text style={styles.varName}>{name}</Text>
              <Text style={styles.varSource}>{source}</Text>
            </View>
          ))}

          {/* ── Lien recos ── */}
          <View style={[styles.linkCard, { marginTop: 24 }]}>
            <Text style={styles.linkText}>
              Ce montant est le budget total que le moteur de recommandation répartit entre
              épargner, investir, se faire plaisir et conserver.
            </Text>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => router.push('/(tabs)/admin/recommendations' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.linkBtnText}>Voir les recommandations</Text>
              <Ionicons name="arrow-forward" size={14} color="#60a5fa" />
            </TouchableOpacity>
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

  /* Formula card */
  formulaCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    marginBottom: 24,
    gap: 2,
  },
  formulaLine: {
    fontSize: 12,
    color: COLORS.text,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  formulaDivider: {
    fontSize: 10,
    color: COLORS.cardBorder,
    fontFamily: 'monospace',
  },

  /* Steps */
  stepCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  stepLabel: { fontSize: 13, fontWeight: '700' },
  stepFormula: {
    fontSize: 11,
    color: COLORS.text,
    fontFamily: 'monospace',
    backgroundColor: COLORS.bg,
    borderRadius: 6,
    padding: 8,
    overflow: 'hidden',
  },
  stepExplanation: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },

  /* Variables */
  varRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  varName: { fontSize: 12, fontWeight: '600', color: '#60a5fa' },
  varSource: { fontSize: 11, color: COLORS.textSecondary, flex: 1, textAlign: 'right' },

  /* Link */
  linkCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    gap: 12,
  },
  linkText: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkBtnText: { fontSize: 13, color: '#60a5fa', fontWeight: '600' },
});
