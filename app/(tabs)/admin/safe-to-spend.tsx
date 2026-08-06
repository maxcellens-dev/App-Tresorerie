import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAppColors } from '../../../hooks/useAppColors';
import { useResponsive } from '../../../hooks/useResponsive';
import { pageColumn } from '../../../lib/webLayout';
import { useNavBack } from '../../../hooks/useNavBack';


const STEP_COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#22d3ee', '#fb7185', '#34d399'];

const STEPS = [
  {
    label: 'Point de départ — POINT BAS de trésorerie du mois',
    formula: 'min des soldes de FIN DE JOURNÉE du compte courant simulé, d\'ici la fin du mois',
    explanation: 'Pas le solde d\'aujourd\'hui : le plus bas où le compte descendra d\'ici la fin du mois, charges récurrentes déjà dedans. On raisonne en solde de fin de JOURNÉE (l\'ordre des opérations d\'une même journée n\'est ni connu ni stable : un prélèvement tombant le jour de la paie ne doit pas creuser un creux qui n\'existe pas). Le passé est déjà dans le solde de départ : il n\'est jamais redéduit.',
  },
  {
    label: '− Épargne à venir',
    formula: 'virements épargne du mois encore à venir (non exécutés)',
    explanation: 'Seule la part d\'épargne pas encore sortie du compte est déduite.',
  },
  {
    label: '− Investissement à venir',
    formula: 'virements vers comptes d\'investissement du mois encore à venir',
    explanation: 'Idem : uniquement les virements d\'investissement encore à venir.',
  },
  {
    label: '− Réserve prévue + réservations + cumuls',
    formula: 'réserve du mois (brouillons « conserver ») + réservations manuelles du mois + cumuls de pré-épargne / pré-investissement',
    explanation: 'Argent qui reste PHYSIQUEMENT sur le compte courant mais qui est déjà fléché. C\'est ce qui explique l\'écart entre « il devrait te rester 724 € le 1er » (état des lieux) et « ton Relyka : 560 € » : le second retire ce qui est déjà promis.',
  },
  {
    label: '− Enveloppe variable restante',
    formula: 'max(0, budget variable habituel − variable déjà dépensé ce mois)',
    explanation: 'Ce qui sera encore dépensé au quotidien d\'ici la fin du mois. Quand une dépense variable réelle a lieu, le solde baisse mais l\'enveloppe restante baisse d\'autant : le Relyka ne bouge pas. C\'est voulu — la dépense était déjà provisionnée.',
  },
  {
    label: '− Marge de sécurité (montant fixe)',
    formula: 'max(0, … − marge_de_sécurité_€)',
    explanation: 'Montant minimum conservé sur les comptes courants quoi qu\'il arrive. Saisi en Q8 du questionnaire. Si le solde courant passe sous la marge → seule la reco « Conserver » est active. Résultat final borné à 0 : le Relyka n\'est jamais négatif.',
  },
];

const VARIABLES = [
  ['cashflow_trough', 'point bas du solde courant simulé sur le mois (usePilotageData)'],
  ['savingsFuture', 'virements épargne du mois non encore exécutés'],
  ['investFuture', 'virements investissement du mois non encore exécutés'],
  ['reservePlanned', 'réserve du mois (projets même-compte + brouillons « conserver »)'],
  ['reservationsTotal', 'réservations manuelles créées ce mois-ci'],
  ['cumulsTotal', 'cumuls de pré-épargne + pré-investissement'],
  ['variableEnvelopeRemaining', 'max(0, budget variable habituel − variable dépensé du mois)'],
  ['safetyMargin', 'profiles.safety_margin_amount (Q8, défaut 0 €)'],
];

export default function SafeToSpendAdmin() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Formule du Relyka" onBack={goBack} />

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.subtitle}>
            Explication complète du « Ton Relyka » affiché sur le Pilotage — LE montant réellement
            disponible ce mois-ci. Une seule formule (lib/relyka), partagée par la carte du Pilotage,
            le bandeau « prochain geste », le moteur de recommandations et l'état des lieux.
            Principe : on part du POINT BAS de trésorerie du mois (et non du solde d'aujourd'hui),
            puis on retire tout ce qui est déjà engagé.
          </Text>

          {/* ── Formule résumée ── */}
          <View style={styles.formulaCard}>
            <Text style={styles.formulaLine}>  Point bas de trésorerie du mois</Text>
            <Text style={styles.formulaLine}>− Épargne à venir</Text>
            <Text style={styles.formulaLine}>− Investissement à venir</Text>
            <Text style={styles.formulaLine}>− Réserve prévue du mois</Text>
            <Text style={styles.formulaLine}>− Réservations manuelles du mois</Text>
            <Text style={styles.formulaLine}>− Cumuls pré-épargne / pré-investissement</Text>
            <Text style={styles.formulaLine}>− Enveloppe variable restante</Text>
            <Text style={styles.formulaLine}>− Marge de sécurité (montant fixe €)</Text>
            <Text style={styles.formulaDivider}>─────────────────────────────────</Text>
            <Text style={[styles.formulaLine, { color: '#34d399', fontWeight: '700' }]}>= Ton Relyka (borné à 0)</Text>
          </View>

          {/* Le piège classique : deux chiffres justes qui ont l'air de se contredire. */}
          <View style={[styles.linkCard, { marginBottom: 24 }]}>
            <Text style={styles.linkText}>
              À ne pas confondre avec le « il devrait te rester X le 1er » de l'état des lieux :
              celui-là est le solde qui restera SUR LE COMPTE, réservations comprises (elles y sont
              physiquement). Le Relyka, lui, retire tout ce qui est déjà promis. Les deux sont justes,
              et le second est toujours le plus petit.
            </Text>
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
              épargner, investir, se faire plaisir et conserver : la somme des recommandations
              affichées vaut exactement le Relyka.
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
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
