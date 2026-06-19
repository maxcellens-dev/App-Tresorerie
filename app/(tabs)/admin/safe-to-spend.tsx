import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';


const STEP_COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#22d3ee', '#fb7185', '#34d399'];

const STEPS = [
  {
    label: 'Point de départ — Solde courant à date',
    formula: 'Σ accounts(checking).balance',
    explanation: 'Le solde réel de tous les comptes courants, aujourd\'hui. Il reflète déjà tout ce qui est passé (recettes encaissées, dépenses payées, virements exécutés). On ne redéduit donc jamais le passé.',
  },
  {
    label: '− Épargne à venir',
    formula: 'virements épargne planifiés ce mois − déjà exécutés (+ projets non exécutés)',
    explanation: 'Seule la part d\'épargne pas encore sortie du compte est déduite (le passé est déjà dans le solde).',
  },
  {
    label: '− Investissement à venir',
    formula: 'virements vers comptes d\'investissement planifiés ce mois − déjà exécutés',
    explanation: 'Idem : uniquement les virements d\'investissement encore à venir.',
  },
  {
    label: '− Réservé',
    formula: 'projets même-compte + montant conservé du mois (recos)',
    explanation: 'Argent qui reste sur le compte courant mais déjà mis de côté mentalement.',
  },
  {
    label: '− Dépenses prévues à venir + variables estimées',
    formula: 'dépenses datées après aujourd\'hui + max(0, estimation − variable déjà dépensé du mois)',
    explanation: 'Les dépenses futures déjà saisies + l\'estimation de ce qui sera encore dépensé en variable ce mois. Quand une dépense variable réelle a lieu, le solde baisse mais l\'estimation restante baisse d\'autant : le budget libre ne bouge pas.',
  },
  {
    label: '− Marge de sécurité (montant fixe)',
    formula: 'max(0, … − marge_de_sécurité_€)',
    explanation: 'Montant minimum conservé sur les comptes courants quoi qu\'il arrive. Saisi en Q8 du questionnaire. Si solde courant < marge → seule la reco "Conserver" est active.',
  },
];

const VARIABLES = [
  ['solde_courant', 'Σ accounts(checking).balance (à date, futur exclu)'],
  ['épargne_à_venir', 'virements épargne du mois non encore exécutés + projets'],
  ['invest_à_venir', 'virements investissement du mois non encore exécutés'],
  ['réservé', 'projets même-compte + conservé du mois (recos)'],
  ['dépenses_à_venir', 'transactions dépenses datées après aujourd\'hui'],
  ['variable_restant', 'max(0, estimation_mensuelle − variable dépensé du mois)'],
  ['marge_sécurité', 'profiles.safety_margin_amount (Q8, défaut 0 €)'],
];

export default function SafeToSpendAdmin() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Formule « Budget libre »</Text>
          <Text style={styles.subtitle}>
            Explication complète du « Tu peux dépenser ce mois » affiché sur le Tableau de bord.
            Principe : on part du solde réel à date et on ne déduit QUE ce qui n'est pas encore
            sorti du compte (le passé est déjà dans le solde → jamais redéduit).
          </Text>

          {/* ── Formule résumée ── */}
          <View style={styles.formulaCard}>
            <Text style={styles.formulaLine}>  Solde courant (à date)</Text>
            <Text style={styles.formulaLine}>− Épargne à venir</Text>
            <Text style={styles.formulaLine}>− Investissement à venir</Text>
            <Text style={styles.formulaLine}>− Réservé (projets + conservé du mois)</Text>
            <Text style={styles.formulaLine}>− Dépenses prévues à venir</Text>
            <Text style={styles.formulaLine}>− Dépenses variables estimées restantes</Text>
            <Text style={styles.formulaLine}>− Marge de sécurité (montant fixe €)</Text>
            <Text style={styles.formulaDivider}>─────────────────────────────────</Text>
            <Text style={[styles.formulaLine, { color: '#34d399', fontWeight: '700' }]}>= Budget libre</Text>
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },

  /* Formula card */
  formulaCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 16,
    marginBottom: 24,
    gap: 2,
  },
  formulaLine: {
    fontSize: 12,
    color: c.text,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  formulaDivider: {
    fontSize: 10,
    color: c.cardBorder,
    fontFamily: 'monospace',
  },

  /* Steps */
  stepCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  stepLabel: { fontSize: 13, fontWeight: '700' },
  stepFormula: {
    fontSize: 11,
    color: c.text,
    fontFamily: 'monospace',
    backgroundColor: c.bg,
    borderRadius: 6,
    padding: 8,
    overflow: 'hidden',
  },
  stepExplanation: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  /* Variables */
  varRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
  varName: { fontSize: 12, fontWeight: '600', color: '#60a5fa' },
  varSource: { fontSize: 11, color: c.textSecondary, flex: 1, textAlign: 'right' },

  /* Link */
  linkCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 16,
    gap: 12,
  },
  linkText: { fontSize: 12, color: c.textSecondary, lineHeight: 18 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkBtnText: { fontSize: 13, color: '#60a5fa', fontWeight: '600' },
});
}
