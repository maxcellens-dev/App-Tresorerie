import React from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from '../hooks/usePilotageData';
import { useProjects } from '../hooks/useProjects';
import { useObjectives } from '../hooks/useObjectives';
import SafeToSpendCard from '../components/SafeToSpendCard';
import VariableTrendCard from '../components/VariableTrendCard';
import SavingsGaugeCard from '../components/SavingsGaugeCard';
import RecommendationCard from '../components/RecommendationCard';
import ProjectsListCard from '../components/ProjectsListCard';
import ObjectivesListCard from '../components/ObjectivesListCard';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function PilotageScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // Données principales
  const { data: pilotageData, isLoading: pilotageLoading } = usePilotageData(user?.id);
  const { data: projects = [], isLoading: projectsLoading } = useProjects(user?.id);
  const { data: objectives = [], isLoading: objectivesLoading } = useObjectives(user?.id);

  const isLoading = pilotageLoading || projectsLoading || objectivesLoading;

  if (!pilotageData) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Tableau de bord</Text>
            <Text style={styles.subtitle}>Piloter votre trésorerie</Text>
          </View>
        </View>

        {/* Main Content - Bento Grid */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Row 0: Account Summary (Full Width) */}
          <View style={styles.row}>
            <View style={styles.accountSummary}>
              <Text style={styles.summaryTitle}>Vue d'ensemble des comptes</Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Courant</Text>
                  <Text style={styles.summaryAmount}>{pilotageData.total_checking.toFixed(0)} €</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Épargne</Text>
                  <Text style={styles.summaryAmount}>{pilotageData.total_savings.toFixed(0)} €</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Investissements</Text>
                  <Text style={styles.summaryAmount}>{pilotageData.total_invested.toFixed(0)} €</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Row 1: Safe to Spend (Hero - Full Width) */}
          <View style={styles.row}>
            <SafeToSpendCard
              amount={pilotageData.safe_to_spend}
              isLow={pilotageData.safe_to_spend < pilotageData.committed_allocations}
              isNegative={pilotageData.safe_to_spend < 0}
            />
          </View>

          {/* Row 2: Variable Trend + Savings Gauge (2 columns) */}
          <View style={styles.row2Col}>
            <View style={styles.col}>
              <VariableTrendCard
                current={pilotageData.current_month_variable}
                average={pilotageData.avg_variable_expenses_3m}
                percentage={pilotageData.variable_trend_percentage}
              />
            </View>
            <View style={styles.col}>
              <SavingsGaugeCard
                current={pilotageData.current_savings}
                thresholdMin={pilotageData.safety_threshold_min}
                thresholdOptimal={pilotageData.safety_threshold_optimal}
                thresholdComfort={pilotageData.safety_threshold_comfort}
              />
            </View>
          </View>

          {/* Row 3: Recommendation Card (Full Width) */}
          <View style={styles.row}>
            <RecommendationCard
              projection={pilotageData.projected_surplus}
              recommendation={pilotageData.recommendation}
              onAction={() => {
                // TODO: Action de base selon la recommandation
                if (pilotageData.recommendation === 'À ÉPARGNER') {
                  router.push('/(tabs)/accounts');
                } else {
                  router.push('/(tabs)/accounts');
                }
              }}
            />
          </View>

          {/* Row 5: Projects + Objectives (2 columns) */}
          <View style={styles.row2Col}>
            <View style={styles.col}>
              <ProjectsListCard
                projects={pilotageData.projects_with_progress as any}
                isLoading={projectsLoading}
                onCreate={() => {
                  router.push('/(tabs)/projects');
                }}
                onViewAll={() => {
                  router.push('/(tabs)/projects');
                }}
              />
            </View>
            <View style={styles.col}>
              <ObjectivesListCard
                objectives={pilotageData.objectives_with_progress as any}
                isLoading={objectivesLoading}
                onCreate={() => {
                  router.push('/(tabs)/objectives');
                }}
                onViewAll={() => {
                  router.push('/(tabs)/objectives');
                }}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  settingsBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 16,
    paddingBottom: 80,
  },
  loader: { marginVertical: 40 },

  // Bento Grid Layout
  row: {
    gap: 16,
  },
  row2Col: {
    flexDirection: 'row',
    gap: 16,
  },
  col: {
    flex: 1,
  },

  // Account Summary Card
  accountSummary: {
    padding: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 12,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 12,
    gap: 4,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.emerald,
  },
});
