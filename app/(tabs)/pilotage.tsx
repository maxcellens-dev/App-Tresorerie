import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from '../hooks/usePilotageData';
import { useProjects } from '../hooks/useProjects';
import { useObjectives } from '../hooks/useObjectives';
import SafeToSpendCard from '../components/SafeToSpendCard';
import VariableTrendCard from '../components/VariableTrendCard';
import RecommendationCard from '../components/RecommendationCard';
import ProjectsListCard from '../components/ProjectsListCard';
import ObjectivesListCard from '../components/ObjectivesListCard';
import { ACCOUNT_COLORS } from '../theme/colors';

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
  const [refreshing, setRefreshing] = useState(false);

  // Données principales
  const pilotageQuery = usePilotageData(user?.id);
  const projectsQuery = useProjects(user?.id);
  const objectivesQuery = useObjectives(user?.id);

  const { data: pilotageData, isLoading: pilotageLoading } = pilotageQuery;
  const { data: projects = [], isLoading: projectsLoading } = projectsQuery;
  const { data: objectives = [], isLoading: objectivesLoading } = objectivesQuery;

  const isLoading = pilotageLoading || projectsLoading || objectivesLoading;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        pilotageQuery.refetch?.(),
        projectsQuery.refetch?.(),
        objectivesQuery.refetch?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

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

        {/* Main Content */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.emerald}
              progressBackgroundColor={COLORS.card}
            />
          }
        >

          {/* ═══════════ SECTION 1 : Vue d'ensemble ═══════════ */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="analytics-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Vue d'ensemble</Text>
            </View>
            <View style={styles.sectionDivider} />

            <View style={styles.accountSummary}>
              <View style={styles.summaryGrid}>
                <View style={[styles.summaryItemEpargne, { borderLeftColor: pilotageData.total_savings < 5000 ? '#ef4444' : pilotageData.total_savings < 10000 ? '#f59e0b' : pilotageData.total_savings < 20000 ? ACCOUNT_COLORS.savings : ACCOUNT_COLORS.savings }]}>
                  {(() => {
                    const s = pilotageData.total_savings;
                    const col = s < 5000 ? '#ef4444' : s < 10000 ? '#f59e0b' : ACCOUNT_COLORS.savings;
                    const kw = s < 5000 ? 'Critique' : s < 10000 ? 'À renforcer' : s < 20000 ? 'Saine' : 'Confortable';
                    return (
                      <>
                        <Ionicons name="leaf-outline" size={16} color={col} style={{ marginBottom: 2 }} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Text style={styles.summaryLabel}>Épargne</Text>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: col }}>{kw}</Text>
                        </View>
                        <Text style={[styles.summaryAmount, { color: col }]}>
                          {s.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €
                        </Text>
                        <View style={styles.gaugeBarOuter}>
                          <View style={[styles.gaugeBarFill, {
                            width: `${Math.min((s / 25000) * 100, 100)}%`,
                            backgroundColor: col,
                          }]} />
                        </View>
                        <View style={styles.thresholdRow}>
                          <View style={[styles.thresholdDot, { backgroundColor: '#ef4444' }]} />
                          <Text style={styles.thresholdText}>&lt;5k</Text>
                          <View style={[styles.thresholdDot, { backgroundColor: '#f59e0b' }]} />
                          <Text style={styles.thresholdText}>5-10k</Text>
                          <View style={[styles.thresholdDot, { backgroundColor: ACCOUNT_COLORS.savings }]} />
                          <Text style={styles.thresholdText}>&gt;10k</Text>
                        </View>
                      </>
                    );
                  })()}
                </View>
                <View style={[styles.summaryItem, { borderLeftWidth: 3, borderLeftColor: ACCOUNT_COLORS.checking }]}>
                  <Ionicons name="wallet-outline" size={16} color={ACCOUNT_COLORS.checking} style={{ marginBottom: 2 }} />
                  <Text style={styles.summaryLabel}>Courant</Text>
                  <Text style={[styles.summaryAmount, { color: ACCOUNT_COLORS.checking }]}>{pilotageData.total_checking.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</Text>
                </View>
                <View style={[styles.summaryItem, { borderLeftWidth: 3, borderLeftColor: ACCOUNT_COLORS.investment }]}>
                  <Ionicons name="trending-up-outline" size={16} color={ACCOUNT_COLORS.investment} style={{ marginBottom: 2 }} />
                  <Text style={styles.summaryLabel}>Investissements</Text>
                  <Text style={[styles.summaryAmount, { color: ACCOUNT_COLORS.investment }]}>{pilotageData.total_invested.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</Text>
                </View>
              </View>
            </View>
          </View>

          {/* ═══════════ SECTION 2 : Ce mois-ci ═══════════ */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="calendar-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Ce mois-ci</Text>
            </View>
            <View style={styles.sectionDivider} />

            <View style={styles.row2Col}>
              <View style={[styles.col, { flex: 1.2 }]}>
                <SafeToSpendCard
                  amount={pilotageData.safe_to_spend}
                  isLow={pilotageData.safe_to_spend < pilotageData.committed_allocations}
                  isNegative={pilotageData.safe_to_spend < 0}
                  reserved={pilotageData.same_account_reserved}
                />
              </View>
              <View style={[styles.col, { flex: 0.8 }]}>
                <VariableTrendCard
                  current={pilotageData.current_month_variable}
                  average={pilotageData.avg_variable_expenses_3m}
                  percentage={pilotageData.variable_trend_percentage}
                />
              </View>
            </View>

            <RecommendationCard
              projection={pilotageData.projected_surplus}
              recommendation={pilotageData.recommendation}
              onAction={() => {
                if (pilotageData.recommendation === 'À ÉPARGNER') {
                  router.push('/(tabs)/comptes');
                } else {
                  router.push('/(tabs)/comptes');
                }
              }}
            />
          </View>

          {/* ═══════════ SECTION 3 : Objectifs et Projets ═══════════ */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="flag-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Objectifs et Projets</Text>
            </View>
            <View style={styles.sectionDivider} />

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
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 8, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '700', color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  settingsBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: {
    gap: 24,
    paddingBottom: 80,
  },
  loader: { marginVertical: 40 },

  // Section Layout
  section: {
    gap: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: COLORS.cardBorder,
    marginHorizontal: 4,
    opacity: 0.6,
  },

  // Grid
  row2Col: { flexDirection: 'row', gap: 10 },
  col: {
    flex: 1,
  },

  // Account Summary Card
  accountSummary: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  summaryItemEpargne: {
    flex: 1.4,
    backgroundColor: '#1e293b',
    padding: 10,
    borderRadius: 12,
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: ACCOUNT_COLORS.savings,
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCOUNT_COLORS.checking,
  },
  gaugeBarOuter: {
    height: 5,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 6,
  },
  gaugeBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  thresholdDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  thresholdText: {
    fontSize: 8,
    color: COLORS.textSecondary,
    marginRight: 4,
  },
  savingsStatusText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
});
