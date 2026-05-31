import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from '../hooks/usePilotageData';
import { useProjects } from '../hooks/useProjects';
import { useObjectives } from '../hooks/useObjectives';
import { useAccounts } from '../hooks/useAccounts';
import { usePreSavings, useAddPreSavingEntry, useResetPreSaving, useSetPreSavingStatus } from '../hooks/usePreSavings';
import { useReservations, useAddReservation } from '../hooks/useReservations';
import { useRecoThresholds } from '../hooks/useRecoThresholds';
import RecommendationCard from '../components/RecommendationCard';
import PreSavingsModal from '../components/PreSavingsModal';
import CumulsPanel from '../components/CumulsPanel';
import ProjectsListCard from '../components/ProjectsListCard';
import ObjectivesListCard from '../components/ObjectivesListCard';
import { ACCOUNT_COLORS } from '../theme/colors';
import { computeRecommendations, getCurrentTier, TIER_LABELS, TIER_COLORS } from '../lib/recommendationEngine';
import type { SmartRecommendation } from '../lib/recommendationEngine';
import type { PreSavingType } from '../types/database';
import { useRecommendationTiers } from '../hooks/useRecommendationTiers';
import { useFinancialProfile } from '../hooks/useFinancialProfile';
import { useAutoProfileEvaluation } from '../hooks/useFinancialProfile';
import type { FinancialProfileId } from '../types/database';
import GuideOverlay from '../components/GuideOverlay';
import type { BubbleStep } from '../components/GuideOverlay';
import { useScreenGuide } from '../hooks/useScreenGuide';
import { useAppColors } from '../hooks/useAppColors';
import type { AppColors } from '../theme/palette';
import { CURRENCY_SYMBOL } from '../lib/currency';

export default function PilotageScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const COLORS = useAppColors();
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  const [refreshing, setRefreshing] = useState(false);

  // Données principales
  const pilotageQuery = usePilotageData(user?.id);
  const projectsQuery = useProjects(user?.id);
  const objectivesQuery = useObjectives(user?.id);
  const { data: customTiers } = useRecommendationTiers();
  const { data: financialProfile } = useFinancialProfile(user?.id);
  const autoEval = useAutoProfileEvaluation(user?.id);

  // ── Données recos évoluées : cumuls, réservations, seuils, comptes ──
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: recoThresholds } = useRecoThresholds();
  const addPreSaving = useAddPreSavingEntry(user?.id);
  const resetPreSaving = useResetPreSaving(user?.id);
  const setPreSavingStatus = useSetPreSavingStatus(user?.id);
  const addReservation = useAddReservation(user?.id);

  // Modale pré-épargne/pré-invest + panneau cumuls
  const [preModal, setPreModal] = useState<PreSavingType | null>(null);
  const [preModalAmount, setPreModalAmount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  const preEpargneTotal = preSavings?.epargne.total_cumule ?? 0;
  const preInvestTotal = preSavings?.invest.total_cumule ?? 0;
  const reservationsTotal = reservations.reduce((s, r) => s + Number(r.montant), 0);

  // Compte courant principal (solde le plus élevé) + présence des comptes cibles
  const mainCheckingId = [...accounts]
    .filter((a) => a.type === 'checking')
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id;
  const hasSavingsAccount = accounts.some((a) => a.type === 'savings');
  const hasInvestmentAccount = accounts.some((a) => a.type === 'investment');

  // ── Guide "bulles" ──
  const guide = useScreenGuide('pilotage', user?.id);
  const scrollRef = React.useRef<ScrollView>(null);
  const overviewRef = React.useRef<View>(null);
  const suiviRef = React.useRef<View>(null);
  const monthRef = React.useRef<View>(null);
  const projectsObjectivesRef = React.useRef<View>(null);

  const PILOTAGE_GUIDE: BubbleStep[] = [
    {
      getRef: () => overviewRef,
      icon: 'analytics-outline',
      iconColor: '#34d399',
      title: 'Vue d\'ensemble',
      description: 'Vos soldes par catégorie : épargne, courant et investissements. Le repère de santé de votre épargne en un coup d\'œil.',
    },
    {
      getRef: () => suiviRef,
      icon: 'wallet-outline',
      iconColor: '#34d399',
      title: 'Suivi du mois',
      description: 'Vos engagements du mois (épargne, investissement, réservé) et vos dépenses. En bas, le « Reste du mois » : ce qu\'il vous reste à dépenser librement.',
    },
    {
      getRef: () => monthRef,
      icon: 'bulb-outline',
      iconColor: '#f59e0b',
      title: 'Recommandations',
      description: 'Des conseils personnalisés selon votre profil financier pour optimiser votre mois : épargne, investissement, réserve…',
    },
    {
      getRef: () => projectsObjectivesRef,
      icon: 'flag-outline',
      iconColor: '#a78bfa',
      title: 'Mes Projets & Objectifs',
      description: 'Suivez vos projets d\'épargne (voiture, voyage…) et vos objectifs annuels d\'investissement, avec leur progression.',
    },
  ];

  // Évaluation automatique mensuelle (silencieuse, 1er du mois)
  React.useEffect(() => {
    if (financialProfile) autoEval.mutate();
  }, [financialProfile?.last_auto_evaluation]);

  const { data: pilotageData, isLoading: pilotageLoading, error: pilotageError } = pilotageQuery;
  const { data: projects = [], isLoading: projectsLoading } = projectsQuery;
  const { data: objectives = [], isLoading: objectivesLoading } = objectivesQuery;

  const isLoading = pilotageLoading || projectsLoading || objectivesLoading;

  // ── Reste disponible (§8) = base à dépenser − cumuls − réservations ──
  const baseADepenser = pilotageData?.safe_to_spend ?? 0;
  const cumulsTotal = preEpargneTotal + preInvestTotal;
  const resteDisponible = Math.max(0, baseADepenser - cumulsTotal - reservationsTotal);
  const enDepassement = cumulsTotal > baseADepenser && baseADepenser > 0;

  // Synchroniser le statut des cumuls (actif / en_depassement)
  React.useEffect(() => {
    if (!preSavings) return;
    const wanted = enDepassement ? 'en_depassement' : 'actif';
    (['epargne', 'invest'] as PreSavingType[]).forEach((t) => {
      const row = preSavings[t];
      if (row.total_cumule > 0 && row.statut !== wanted) {
        setPreSavingStatus.mutate({ type: t, statut: wanted });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enDepassement, preSavings?.epargne.total_cumule, preSavings?.invest.total_cumule]);

  // Construit l'URL de virement pré-rempli (query-string fiable + retour vers Pilotage)
  const buildTransferUrl = (opts: {
    dest: 'savings' | 'investment'; amount: number; label: string;
    recoComplete?: string; resetPreSaving?: PreSavingType;
  }) => {
    const q = new URLSearchParams({
      from: mainCheckingId ?? '',
      destType: opts.dest,
      amount: String(Math.round(opts.amount)),
      label: opts.label,
      origin: 'pilotage',
      ...(opts.recoComplete ? { recoComplete: opts.recoComplete } : {}),
      ...(opts.resetPreSaving ? { resetPreSaving: opts.resetPreSaving } : {}),
    });
    return `/(tabs)/comptes/transfer?${q.toString()}`;
  };

  const monthYearLabel = () => new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // Ouvrir le virement pré-rempli pour une reco épargne/invest
  const openRecoTransfer = (reco: SmartRecommendation, dest: 'savings' | 'investment') => {
    const label = dest === 'savings' ? 'Épargne' : 'Investissement';
    router.push(buildTransferUrl({ dest, amount: reco.amount, label: `${label} ${monthYearLabel()}`, recoComplete: reco.type }) as any);
  };

  // Ouvrir le virement global d'un cumul (depuis la modale)
  const openCumulTransfer = (type: PreSavingType, montant: number) => {
    setPreModal(null);
    const dest = type === 'epargne' ? 'savings' : 'investment';
    const label = type === 'epargne' ? 'Épargne' : 'Investissement';
    router.push(buildTransferUrl({ dest, amount: montant, label: `${label} ${monthYearLabel()} (cumul)`, resetPreSaving: type }) as any);
  };

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

  if (isLoading && !pilotageData) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
        </SafeAreaView>
      </View>
    );
  }

  if (pilotageError || !pilotageData) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <View style={styles.loader}>
            <Text style={{ color: COLORS.textSecondary, textAlign: 'center', marginBottom: 16 }}>
              {pilotageError ? `Erreur : ${(pilotageError as Error).message}` : 'Données indisponibles'}
            </Text>
            <TouchableOpacity onPress={() => pilotageQuery.refetch()}>
              <Text style={{ color: COLORS.emerald, textAlign: 'center' }}>Réessayer</Text>
            </TouchableOpacity>
          </View>
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
          </View>
        </View>

        {/* Main Content */}
        <ScrollView
          ref={scrollRef}
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
          <View style={styles.section} ref={overviewRef}>
            <View style={styles.sectionHeader}>
              <Ionicons name="analytics-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Vue d'ensemble</Text>
            </View>
            <View style={styles.sectionDivider} />

            <View style={styles.accountSummary}>
              <View style={styles.summaryGrid}>
                {/* Courant — en premier */}
                <View style={[styles.summaryItem, { borderLeftWidth: 3, borderLeftColor: ACCOUNT_COLORS.checking }]}>
                  <Ionicons name="wallet-outline" size={16} color={ACCOUNT_COLORS.checking} style={{ marginBottom: 2 }} />
                  <Text style={styles.summaryLabel}>Courant</Text>
                  <Text style={[styles.summaryAmount, { color: ACCOUNT_COLORS.checking }]}>{pilotageData.total_checking.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {CURRENCY_SYMBOL}</Text>
                </View>

                {/* Épargne — avec badge de santé, sans barre ni légende */}
                {(() => {
                  const s = pilotageData.total_savings;
                  const col = s < 5000 ? '#ef4444' : s < 10000 ? '#f59e0b' : ACCOUNT_COLORS.savings;
                  const kw = s < 5000 ? 'Critique' : s < 10000 ? 'À renforcer' : s < 20000 ? 'Saine' : 'Confortable';
                  return (
                    <View style={[styles.summaryItem, { borderLeftWidth: 3, borderLeftColor: col }]}>
                      <Ionicons name="leaf-outline" size={16} color={col} style={{ marginBottom: 2 }} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <Text style={styles.summaryLabel}>Épargne</Text>
                        <Text style={{ fontSize: 9, fontWeight: '700', color: col }}>{kw}</Text>
                      </View>
                      <Text style={[styles.summaryAmount, { color: col }]}>
                        {s.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {CURRENCY_SYMBOL}
                      </Text>
                    </View>
                  );
                })()}

                {/* Investissements */}
                <View style={[styles.summaryItem, { borderLeftWidth: 3, borderLeftColor: ACCOUNT_COLORS.investment }]}>
                  <Ionicons name="trending-up-outline" size={16} color={ACCOUNT_COLORS.investment} style={{ marginBottom: 2 }} />
                  <Text style={styles.summaryLabel}>Investissements</Text>
                  <Text style={[styles.summaryAmount, { color: ACCOUNT_COLORS.investment }]}>{pilotageData.total_invested.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {CURRENCY_SYMBOL}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.section} ref={suiviRef}>
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Suivi du mois</Text>
            </View>
            <View style={styles.sectionDivider} />

            {(() => {
              const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
              const savings = pilotageData.monthly_savings_planned;
              const invest = pilotageData.monthly_invest_planned;
              const reserve = pilotageData.monthly_reserve_planned;
              const expenses = pilotageData.month_expenses_total;

              const items = [
                { label: 'Épargne prévue',   value: savings,  icon: 'shield-outline',     color: '#34d399', hint: 'Virements vers épargne + projets' },
                { label: 'Investissement',   value: invest,   icon: 'trending-up-outline', color: '#a78bfa', hint: 'Virements vers comptes d\'investissement' },
                { label: 'Réservé',          value: reserve,  icon: 'lock-closed-outline', color: '#60a5fa', hint: 'Argent tagué « Réservé »' },
              ];

              // Reste du mois = reste disponible (base − cumuls − réservations)
              const rest = resteDisponible;
              const restNeg = rest < 0;
              const restLow = rest < pilotageData.committed_allocations;
              const restColor = restNeg ? '#f87171' : restLow ? '#fbbf24' : '#34d399';
              const restHint = restNeg ? 'Attention : solde insuffisant' : restLow ? 'Prudence requise' : 'Vous êtes en bonne position';

              return (
                <View style={styles.suiviCard}>
                  {items.map((it) => (
                    <View key={it.label} style={styles.suiviRow}>
                      <View style={[styles.suiviIcon, { backgroundColor: it.color + '22' }]}>
                        <Ionicons name={it.icon as any} size={16} color={it.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suiviLabel}>{it.label}</Text>
                        <Text style={styles.suiviHint}>{it.hint}</Text>
                      </View>
                      <Text style={[styles.suiviValue, { color: it.color }]}>{fmt(it.value)}</Text>
                    </View>
                  ))}

                  <View style={styles.suiviDivider} />

                  {/* Dépenses du mois */}
                  <View style={styles.suiviRow}>
                    <View style={[styles.suiviIcon, { backgroundColor: '#f8717122' }]}>
                      <Ionicons name="card-outline" size={16} color="#f87171" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suiviLabel, { fontWeight: '700' }]}>Dépenses du mois</Text>
                      <Text style={styles.suiviHint}>Passées + à venir</Text>
                    </View>
                    <Text style={[styles.suiviValue, { color: '#f87171' }]}>{fmt(expenses)}</Text>
                  </View>

                  <View style={styles.suiviDivider} />

                  {/* Reste du mois */}
                  <View style={styles.suiviRow}>
                    <View style={[styles.suiviIcon, { backgroundColor: restColor + '22' }]}>
                      <Ionicons name="wallet-outline" size={17} color={restColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suiviLabelBig}>Reste du mois</Text>
                      <Text style={styles.suiviHint}>{restHint}</Text>
                    </View>
                    <Text style={[styles.suiviValueBig, { color: restColor }]}>{fmt(rest)}</Text>
                  </View>
                </View>
              );
            })()}
          </View>

          {/* ═══════════ SECTION 2 : Recommandations ═══════════ */}
          <View style={styles.section} ref={monthRef}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bulb-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Recommandations</Text>
            </View>
            <View style={styles.sectionDivider} />

            {/* Alerte de dépassement (§8) */}
            {enDepassement && (
              <View style={styles.overspendBox}>
                <Ionicons name="warning-outline" size={16} color="#f87171" />
                <Text style={styles.overspendText}>
                  Vos réservations mentales dépassent votre reste disponible. Réduisez ou annulez un cumul.
                </Text>
              </View>
            )}

            {/* Bandeau cumuls en attente (§12) */}
            {(preEpargneTotal > 0 || preInvestTotal > 0) && (
              <TouchableOpacity style={styles.cumulsBanner} onPress={() => setPanelOpen(true)} activeOpacity={0.8}>
                {preEpargneTotal > 0 && (
                  <Text style={styles.cumulsBannerItem}>🛡 En attente d'épargne : {Math.round(preEpargneTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}</Text>
                )}
                {preInvestTotal > 0 && (
                  <Text style={styles.cumulsBannerItem}>📈 En attente d'invest : {Math.round(preInvestTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}</Text>
                )}
                <Text style={styles.cumulsBannerLink}>Gérer</Text>
              </TouchableOpacity>
            )}

            <RecommendationCard
              hideTitle
              recommendations={pilotageData ? computeRecommendations(pilotageData, {
                customTierAllocations: customTiers,
                financialProfileId: financialProfile?.profile_id as FinancialProfileId | undefined,
                budget: resteDisponible,
                thresholds: recoThresholds,
              }) : []}
              tierLabel={pilotageData ? TIER_LABELS[getCurrentTier(pilotageData)] : ''}
              tierColor={pilotageData ? TIER_COLORS[getCurrentTier(pilotageData)] : '#94a3b8'}
              hasSavingsAccount={hasSavingsAccount}
              hasInvestmentAccount={hasInvestmentAccount}
              onCreateAccount={() => router.push('/(tabs)/comptes/add')}
              onEpargner={(reco) => openRecoTransfer(reco, 'savings')}
              onInvestir={(reco) => openRecoTransfer(reco, 'investment')}
              onCumuler={(type, reco) => { setPreModalAmount(reco.amount); setPreModal(type); }}
              onReserver={(reco) => {
                const monthYear = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                addReservation.mutate({ montant: Math.round(reco.amount), libelle: `Réservé ${monthYear}` });
              }}
            />

            {/* Accès permanent aux cumuls (§12) */}
            <TouchableOpacity style={styles.cumulsBtn} onPress={() => setPanelOpen(true)} activeOpacity={0.7}>
              <Text style={styles.cumulsBtnLabel}>💰 Mes cumuls</Text>
            </TouchableOpacity>
          </View>

          {/* ═══════════ SECTION 3 : Objectifs et Projets ═══════════ */}
          <View style={styles.section} ref={projectsObjectivesRef}>
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

      <GuideOverlay
        visible={guide.visible}
        steps={PILOTAGE_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(PILOTAGE_GUIDE.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Pilotage"
      />

      {/* Modale pré-épargne / pré-invest */}
      <PreSavingsModal
        visible={preModal !== null}
        type={preModal ?? 'epargne'}
        recoAmount={preModalAmount}
        total={preModal === 'invest' ? preInvestTotal : preEpargneTotal}
        base={baseADepenser}
        onClose={() => setPreModal(null)}
        onSave={(montant) => {
          if (preModal) addPreSaving.mutate({ type: preModal, montant });
          setPreModal(null);
        }}
        onCreateTransfer={(montant) => { if (preModal) openCumulTransfer(preModal, montant); }}
        onReset={() => { if (preModal) resetPreSaving.mutate(preModal); setPreModal(null); }}
      />

      {/* Panneau d'accès aux cumuls */}
      <CumulsPanel
        visible={panelOpen}
        epargneTotal={preEpargneTotal}
        investTotal={preInvestTotal}
        onClose={() => setPanelOpen(false)}
        onOpen={(type) => {
          setPanelOpen(false);
          setPreModalAmount(0);
          setPreModal(type);
        }}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 8, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  title: { fontSize: 28, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
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
    color: c.text,
    letterSpacing: -0.3,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: c.cardBorder,
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
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: c.bg,
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  summaryItemEpargne: {
    flex: 1.4,
    backgroundColor: c.bg,
    padding: 10,
    borderRadius: 12,
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: ACCOUNT_COLORS.savings,
  },
  summaryLabel: {
    fontSize: 11,
    color: c.textSecondary,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: ACCOUNT_COLORS.checking,
  },
  gaugeBarOuter: {
    height: 5,
    backgroundColor: c.cardBorder,
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
    color: c.textSecondary,
    marginRight: 4,
  },
  savingsStatusText: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  profileCard: {
    padding: 16,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 10,
  },
  suiviCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 14,
    gap: 4,
  },
  suiviRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  suiviIcon: {
    width: 32, height: 32, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },
  suiviLabel: { fontSize: 14, color: c.text, fontWeight: '600' },
  suiviHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  suiviValue: { fontSize: 15, fontWeight: '800' },
  suiviLabelBig: { fontSize: 16, color: c.text, fontWeight: '800' },
  suiviValueBig: { fontSize: 20, fontWeight: '800' },

  // Recommandations — bandeau cumuls / alerte / bouton
  overspendBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8717115', borderRadius: 10, borderWidth: 1, borderColor: '#f8717140',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  overspendText: { flex: 1, fontSize: 12, color: '#f87171', fontWeight: '500', lineHeight: 16 },
  cumulsBanner: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10,
    backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  cumulsBannerItem: { fontSize: 12, color: c.text, fontWeight: '600' },
  cumulsBannerLink: { marginLeft: 'auto', fontSize: 12, color: c.emerald, fontWeight: '700' },
  cumulsBtn: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 8 },
  cumulsBtnLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  suiviDivider: { height: 1, backgroundColor: c.cardBorder, marginVertical: 6 },
  profileTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
  },
  profileSubtitle: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 8,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileEmoji: { fontSize: 32 },
  profileName: { fontSize: 17, fontWeight: '800', color: c.text },
  profileTier: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  profileSourceBadge: {
    backgroundColor: '#1e3a2f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  profileSourceText: { fontSize: 11, fontWeight: '600', color: c.emerald },
  profileDesc: {
    fontSize: 13,
    color: c.textSecondary,
    lineHeight: 19,
    marginTop: 2,
  },
  profileAllocTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textSecondary,
    marginTop: 6,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  profileLabel: {
    fontSize: 13,
    color: c.textSecondary,
    flex: 1,
  },
  profileValue: {
    fontSize: 13,
    color: c.text,
    fontWeight: '700',
  },
  allocationBar: {
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 10,
    height: 28,
    marginTop: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
  },
  allocationSegment: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  allocationSegmentLabel: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  allocationLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  allocationLegend: {
    fontSize: 11,
    color: c.textSecondary,
  },
  });
}
