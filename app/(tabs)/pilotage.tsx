import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, ActivityIndicator, TouchableOpacity, RefreshControl, Modal, TextInput, findNodeHandle } from 'react-native';
import ScreenGradient from '../components/ScreenGradient';
import OnboardingHintBanner from '../components/OnboardingHintBanner';
import MonthlyClosure from '../components/MonthlyClosure';
import { useMonthlyClosure } from '../hooks/useMonthlyClosure';
import { useTransactions } from '../hooks/useTransactions';
import { tabRect } from '../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../lib/onbHighlight';
import { useUpdateOnboarding } from '../hooks/useOnboarding';
import { supabase } from '../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { usePilotageData } from '../hooks/usePilotageData';
import { useAccounts } from '../hooks/useAccounts';
import { usePreSavings, useAddPreSavingEntry, useResetPreSaving, useSetPreSavingStatus } from '../hooks/usePreSavings';
import { useReservations, useSetMonthlyReservation } from '../hooks/useReservations';
import { useReleaseReservedByProject } from '../hooks/useTransactions';
import { useRecoThresholds } from '../hooks/useRecoThresholds';
import RecommendationCard from '../components/RecommendationCard';
import ConseilsBanner from '../components/ConseilsBanner';
import { useProjects } from '../hooks/useProjects';
import PreSavingsModal from '../components/PreSavingsModal';
import CumulsPanel from '../components/CumulsPanel';
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
import { semanticText } from '../theme/palette';
import { CURRENCY_SYMBOL } from '../lib/currency';

export default function PilotageScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const COLORS = useAppColors();
  const styles = React.useMemo(() => makeStyles(COLORS), [COLORS]);
  const onbReserved = useOnbHighlight('reserved_consulted');
  const onbReco = useOnbHighlight('reco_validated');
  const [refreshing, setRefreshing] = useState(false);

  // Données principales
  const pilotageQuery = usePilotageData(user?.id);
  const { data: projectsForConseils = [] } = useProjects(user?.id);
  const { data: txForConseils = [] } = useTransactions(user?.id);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const showClosure = closureEnabled && pendingMonths.length > 0;
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
  const setMonthlyReservation = useSetMonthlyReservation(user?.id);

  // Modale pré-épargne/pré-invest + panneau cumuls
  const [preModal, setPreModal] = useState<PreSavingType | null>(null);
  const [preModalAmount, setPreModalAmount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showReservedModal, setShowReservedModal] = useState(false);
  const releaseReserved = useReleaseReservedByProject(user?.id);
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const openReservedModal = () => { setShowReservedModal(true); updateOnboarding.mutate({ flags: { reserved_consulted: true } }); };
  // Modale de saisie de l'estimation hebdo des dépenses variables (alimente q9)
  const { data: profile } = useProfile(user?.id);
  const [showVariableModal, setShowVariableModal] = useState(false);
  const [weeklyVariableInput, setWeeklyVariableInput] = useState('');
  const updateProfileVar = useUpdateProfile(user?.id);

  const fmtMain = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
  const preEpargneTotal = preSavings?.epargne.total_cumule ?? 0;
  const preInvestTotal = preSavings?.invest.total_cumule ?? 0;
  // Réservations « Conserver pour plus tard » : seulement celles du mois courant (réinitialisé chaque mois).
  const reservationsTotal = React.useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return reservations
      .filter((r) => (r.created_at ?? '').slice(0, 7) === monthKey)
      .reduce((s, r) => s + Number(r.montant), 0);
  }, [reservations]);

  // Compte courant principal (solde le plus élevé) + présence des comptes cibles
  const mainCheckingId = [...accounts]
    .filter((a) => a.type === 'checking')
    .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id;
  const hasSavingsAccount = accounts.some((a) => a.type === 'savings');
  const hasInvestmentAccount = accounts.some((a) => a.type === 'investment');

  // ── Guide "bulles" ──
  const guide = useScreenGuide('pilotage', user?.id);
  const scrollRef = React.useRef<ScrollView>(null);
  const reservedRef = React.useRef<any>(null);
  const overviewRef = React.useRef<View>(null); // conservé pour compatibilité guide
  const suiviRef = React.useRef<View>(null);
  const monthRef = React.useRef<View>(null);
  const projectsObjectivesRef = React.useRef<View>(null);

  // Scroll vers la zone mise en évidence par le guide « Pour bien démarrer ».
  React.useEffect(() => {
    const target = onbReco ? monthRef : onbReserved ? reservedRef : null;
    if (!target) return;
    const t = setTimeout(() => {
      const node = scrollRef.current ? findNodeHandle(scrollRef.current) : null;
      if (node && target.current?.measureLayout) {
        target.current.measureLayout(node, (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
        }, () => {});
      }
    }, 350);
    return () => clearTimeout(t);
  }, [onbReco, onbReserved]);

  const PILOTAGE_GUIDE: BubbleStep[] = [
    {
      getRect: () => tabRect(2),
      icon: 'home',
      iconColor: '#34d399',
      title: 'Onglet Pilotage',
      description: 'Touchez « Pilotage » dans la barre du bas : c\'est votre tableau de bord.',
    },
    {
      getRef: () => suiviRef,
      icon: 'wallet-outline',
      iconColor: '#34d399',
      title: 'Suivi du mois',
      description: 'Vos engagements du mois (épargne, investissement, réservé) et vos dépenses. En bas, le « Budget libre à allouer » : ce qu\'il vous reste à dépenser librement.',
    },
    {
      getRef: () => monthRef,
      icon: 'bulb-outline',
      iconColor: '#f59e0b',
      title: 'Recommandations',
      description: 'Des conseils personnalisés selon votre profil financier pour optimiser votre mois : épargne, investissement, réserve…',
    },
  ];

  // Évaluation automatique mensuelle (silencieuse, 1er du mois)
  React.useEffect(() => {
    if (financialProfile) autoEval.mutate();
  }, [financialProfile?.last_auto_evaluation]);

  const { data: pilotageData, isLoading: pilotageLoading, error: pilotageError } = pilotageQuery;
  const isLoading = pilotageLoading;

  // ── Reste disponible = Courant − tout ce qui est affiché ──
  // Formule directe depuis les valeurs affichées pour cohérence avec l'UI.
  const cumulsTotal = preEpargneTotal + preInvestTotal;
  const safetyMarginDisplay = pilotageData?.safety_margin_amount ?? 0;
  // Enveloppe variable restante (estimation des dépenses variables non encore engagées ce mois)
  const variableEnvelopeRemaining = pilotageData?.variable_envelope_remaining ?? 0;
  const resteDisponible = Math.max(0,
    (pilotageData?.current_checking_balance ?? 0)
    - (pilotageData?.monthly_savings_planned ?? 0)
    - (pilotageData?.monthly_invest_planned ?? 0)
    - (pilotageData?.monthly_reserve_planned ?? 0)
    - (pilotageData?.month_expenses_total ?? 0)
    - variableEnvelopeRemaining
    - safetyMarginDisplay
    - cumulsTotal
    - reservationsTotal
  );
  const baseADepenser = pilotageData?.safe_to_spend ?? 0;
  const enDepassement = cumulsTotal > baseADepenser && baseADepenser > 0;

  // ── Budget de recommandation ──
  // = Solde courant − marge − dépensé ce mois − dépenses variables prévues restantes.
  // (≠ budget libre : on ne déduit PAS l'épargne/invest/réservé déjà prévus, car on veut
  //  ensuite déduire ces montants catégorie par catégorie.)
  const recoBudget = Math.max(0,
    (pilotageData?.current_checking_balance ?? 0)
    - safetyMarginDisplay
    - (pilotageData?.month_expenses_total ?? 0)
    - variableEnvelopeRemaining
  );
  // Montants déjà alloués par catégorie ce mois (à déduire des % de reco).
  // Épargne : hors projets. Conserver : réservations du mois + cumuls en attente.
  const recoAlreadyAllocated = {
    save: pilotageData?.real_savings_excl_projects ?? 0,
    invest: pilotageData?.real_invest ?? 0,
    keep: (pilotageData?.monthly_reserve_planned ?? 0) + reservationsTotal,
  };

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

  // Étape « Suivre une recommandation » validée dès qu'on utilise un bouton de reco.
  const markRecoUsed = () => updateOnboarding.mutate({ flags: { reco_validated: true } });

  // Ouvrir le virement pré-rempli pour une reco épargne/invest
  const openRecoTransfer = (reco: SmartRecommendation, dest: 'savings' | 'investment') => {
    markRecoUsed();
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
      await pilotageQuery.refetch?.();
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
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {/* Bandeau marge de sécurité */}
        {(pilotageData.safety_margin_amount ?? 0) > 0 &&
         pilotageData.total_checking < (pilotageData.safety_margin_amount ?? 0) && (
          <View style={styles.safetyBanner}>
            <Ionicons name="warning-outline" size={18} color={COLORS.yellow} />
            <Text style={styles.safetyBannerText}>
              Vos comptes courants ({pilotageData.total_checking.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}) sont en dessous de votre marge de sécurité ({(pilotageData.safety_margin_amount ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}).
            </Text>
          </View>
        )}

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
          {/* Zone conseils / clôture (priorité à la clôture si mois en attente) */}
          {showClosure ? (
            <MonthlyClosure
              surplusEstimate={Math.max(0, variableEnvelopeRemaining) + Math.max(0, resteDisponible)}
              checkingAccounts={accounts.filter((a) => a.type === 'checking').map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance) }))}
            />
          ) : (
            <ConseilsBanner
              userId={user?.id}
              pilotage={pilotageData}
              transactions={txForConseils}
              projects={projectsForConseils}
            />
          )}

          {/* ── HERO : budget libre ce mois ── */}
          {(() => {
            const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
            const restNeg = resteDisponible < 0;
            const heroColor = restNeg ? COLORS.danger : COLORS.emerald;
            const heroSub = restNeg
              ? 'Votre budget est dépassé ce mois-ci — vérifiez vos dépenses.'
              : resteDisponible < 200
              ? 'Mois serré. Vérifiez vos dépenses et vos engagements.'
              : 'Ce que vous pouvez dépenser librement jusqu\'à la fin du mois.';
            const monthLabel = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
            return (
              <View style={[styles.heroCard, { borderColor: heroColor + '44' }]}>
                <Text style={styles.heroLabel}>Tu peux dépenser ce mois</Text>
                <Text style={[styles.heroAmount, { color: heroColor }]}>{fmt(resteDisponible)}</Text>
                <Text style={styles.heroSub}>{heroSub} — {monthLabel}.</Text>
              </View>
            );
          })()}

          {/* ═══════════ SECTION 2 : Action prioritaire ═══════════ */}
          <View style={[styles.section, onbReco ? onbGlow(COLORS, true) : null]} ref={monthRef}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bulb-outline" size={18} color={COLORS.emerald} />
              <Text style={styles.sectionTitle}>Action prioritaire</Text>
            </View>
            <View style={styles.sectionDivider} />

            {/* Alerte de dépassement (§8) */}
            {enDepassement && (
              <View style={styles.overspendBox}>
                <Ionicons name="warning-outline" size={16} color={COLORS.danger} />
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
                budget: recoBudget,
                alreadyAllocated: recoAlreadyAllocated,
                thresholds: recoThresholds,
              }) : []}
              tierLabel={pilotageData ? TIER_LABELS[getCurrentTier(pilotageData)] : ''}
              tierColor={pilotageData ? TIER_COLORS[getCurrentTier(pilotageData)] : '#94a3b8'}
              hasSavingsAccount={hasSavingsAccount}
              hasInvestmentAccount={hasInvestmentAccount}
              onCreateAccount={() => router.push('/(tabs)/comptes/add')}
              onEpargner={(reco) => openRecoTransfer(reco, 'savings')}
              onInvestir={(reco) => openRecoTransfer(reco, 'investment')}
              onCumuler={(type, reco) => { markRecoUsed(); setPreModalAmount(reco.amount); setPreModal(type); }}
              reservedThisMonth={reservationsTotal}
              onReserver={(reco, amount) => {
                markRecoUsed();
                // `amount` = nouveau TOTAL conservé du mois (incluant cette reco) → on remplace.
                const monthYear = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
                const newTotal = Math.round(amount ?? (reservationsTotal + reco.amount));
                setMonthlyReservation.mutate({ montant: newTotal, libelle: `Réservé ${monthYear}` });
              }}
            />

            {/* Accès permanent aux cumuls (§12) */}
            <TouchableOpacity style={styles.cumulsBtn} onPress={() => setPanelOpen(true)} activeOpacity={0.7}>
              <Text style={styles.cumulsBtnLabel}>💰 Mes cumuls</Text>
            </TouchableOpacity>
          </View>
          {/* ═══════════ SUIVI DU MOIS ═══════════ */}
          <View style={styles.section} ref={suiviRef}>
            <View style={[styles.sectionHeader, { justifyContent: 'space-between' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="wallet-outline" size={18} color={COLORS.emerald} />
                <Text style={styles.sectionTitle}>Suivi du mois</Text>
              </View>
              <View style={styles.monthPill}>
                <Text style={styles.monthPillText}>
                  {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
                </Text>
              </View>
            </View>
            <View style={styles.sectionDivider} />

            {(() => {
              const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' ' + CURRENCY_SYMBOL;
              const savings = pilotageData.monthly_savings_planned;
              const invest = pilotageData.monthly_invest_planned;
              // Réservé = réservations projets (même compte) + montant conservé du mois (recos)
              const reserve = pilotageData.monthly_reserve_planned + reservationsTotal;
              const expenses = pilotageData.month_expenses_total;
              const safetyMargin = pilotageData.safety_margin_amount ?? 0;

              const items = [
                { label: 'Épargne prévue',   value: savings,  icon: 'shield-outline',     color: COLORS.green,  hint: 'Virements vers épargne + projets' },
                { label: 'Investissement',   value: invest,   icon: 'trending-up-outline', color: COLORS.violet, hint: 'Virements vers comptes d\'investissement' },
                { label: 'Réservé',          value: reserve,  icon: 'lock-closed-outline', color: COLORS.blue,   hint: 'Conservé ce mois (projets + recos)' },
              ];

              // Reste du mois = reste disponible (base − cumuls − réservations)
              const rest = resteDisponible;
              const restNeg = rest < 0;
              const restLow = rest < pilotageData.committed_allocations;
              const restColor = restNeg ? COLORS.danger : restLow ? COLORS.yellow : COLORS.green;
              const restHint = restNeg ? 'Attention : solde insuffisant' : restLow ? 'Prudence requise' : 'Vous êtes en bonne position';

              return (
                <View style={styles.suiviCard}>
                  {items.map((it) => {
                    const isReserveRow = it.label === 'Réservé';
                    const RowWrap: any = isReserveRow ? TouchableOpacity : View;
                    return (
                      <RowWrap
                        key={it.label}
                        ref={isReserveRow ? reservedRef : undefined}
                        style={[styles.suiviRow, isReserveRow && onbReserved ? onbGlow(COLORS, true) : null]}
                        {...(isReserveRow ? { onPress: openReservedModal, activeOpacity: 0.7 } : {})}
                      >
                        <View style={[styles.suiviIcon, { backgroundColor: it.color + '22' }]}>
                          <Ionicons name={it.icon as any} size={16} color={it.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suiviLabel}>{it.label}</Text>
                          <Text style={styles.suiviHint}>{it.hint}</Text>
                        </View>
                        {isReserveRow && <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />}
                        <Text style={[styles.suiviValue, { color: semanticText(it.color, COLORS) }]}>{fmt(it.value)}</Text>
                      </RowWrap>
                    );
                  })}

                  <View style={styles.suiviDivider} />

                  {/* Dépenses du mois */}
                  <View style={styles.suiviRow}>
                    <View style={[styles.suiviIcon, { backgroundColor: COLORS.danger + '22' }]}>
                      <Ionicons name="card-outline" size={16} color={COLORS.danger} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suiviLabel, { fontWeight: '700' }]}>Dépensé ce mois-ci</Text>
                      <Text style={styles.suiviHint}>Transactions passées et récurrentes à venir</Text>
                    </View>
                    <Text style={[styles.suiviValue, { color: semanticText(COLORS.danger, COLORS) }]}>{fmt(expenses)}</Text>
                  </View>

                  {/* Enveloppe des dépenses variables (estimation restante) */}
                  {(() => {
                    const env = pilotageData.variable_envelope_remaining;
                    const src = pilotageData.variable_envelope_source;
                    const nMonths = pilotageData.variable_envelope_months_used;
                    // La saisie manuelle (repli onboarding) ne sert que sans historique suffisant.
                    // Avec un historique utilisé, la ligne n'est ni cliquable ni fléchée.
                    const editable = src !== 'history';
                    const hint = src === 'history'
                      ? `Estimées sur les ${nMonths} derniers mois`
                      : src === 'onboarding'
                        ? 'Estimation hebdo'
                        : 'À renseigner — appuyez pour estimer';
                    const col = COLORS.orange;
                    const RowWrap: any = editable ? TouchableOpacity : View;
                    return (
                      <RowWrap
                        style={styles.suiviRow}
                        {...(editable ? {
                          activeOpacity: 0.7,
                          onPress: () => {
                            setWeeklyVariableInput(
                              profile?.weekly_variable_budget ? String(profile.weekly_variable_budget) : ''
                            );
                            setShowVariableModal(true);
                          },
                        } : {})}
                      >
                        <View style={[styles.suiviIcon, { backgroundColor: col + '22' }]}>
                          <Ionicons name="cart-outline" size={16} color={col} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suiviLabel}>Dépenses variables prévues restantes</Text>
                          <Text style={styles.suiviHint}>{hint}</Text>
                        </View>
                        {editable && <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} style={{ marginRight: 6 }} />}
                        <Text style={[styles.suiviValue, { color: semanticText(col, COLORS) }]}>{fmt(env)}</Text>
                      </RowWrap>
                    );
                  })()}

                  {/* Marge de sécurité — affichée uniquement si > 0 */}
                  {safetyMargin > 0 && (
                    <View style={[styles.suiviRow, { opacity: 0.75, paddingVertical: 6 }]}>
                      <View style={[styles.suiviIcon, { backgroundColor: COLORS.yellow + '22', width: 24, height: 24 }]}>
                        <Ionicons name="shield-outline" size={12} color={COLORS.yellow} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.suiviLabel, { color: COLORS.yellow, fontSize: 11 }]}>Votre marge de sécurité</Text>
                      </View>
                      <Text style={[styles.suiviValue, { color: COLORS.yellow, fontSize: 11 }]}>{fmt(safetyMargin)}</Text>
                    </View>
                  )}

                  <View style={styles.suiviDivider} />

                  {/* Reste du mois */}
                  <View style={styles.suiviRow}>
                    <View style={[styles.suiviIcon, { backgroundColor: restColor + '22' }]}>
                      <Ionicons name="wallet-outline" size={17} color={restColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suiviLabelBig}>Budget libre</Text>
                      <Text style={styles.suiviHint}>{restHint}</Text>
                    </View>
                    <Text style={[styles.suiviValueBig, { color: semanticText(restColor, COLORS) }]}>{fmt(rest)}</Text>
                  </View>
                </View>
              );
            })()}
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

      {/* Modal des montants réservés */}
      <Modal visible={showReservedModal} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowReservedModal(false)}>
        <View style={styles.reservedOverlay}>
          <View style={styles.reservedSheet}>
            <View style={styles.reservedHeader}>
              <Text style={styles.reservedTitle}>Montants réservés</Text>
              <TouchableOpacity onPress={() => setShowReservedModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={COLORS.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {/* Conservé du mois (recommandations) */}
              {reservationsTotal > 0 && (
                <View style={styles.reservedProjectBlock}>
                  <View style={styles.reservedItem}>
                    <View style={[styles.reservedItemIcon, { backgroundColor: COLORS.yellow + '22' }]}>
                      <Ionicons name="hourglass-outline" size={16} color={COLORS.yellow} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservedItemName}>Conservé ce mois (recommandations)</Text>
                      <Text style={styles.reservedItemHint}>Se réinitialise chaque mois</Text>
                    </View>
                    <Text style={[styles.reservedItemAmount, { color: COLORS.yellow }]}>{fmtMain(reservationsTotal)}</Text>
                  </View>
                  <View style={styles.reservedActions}>
                    <TouchableOpacity
                      style={styles.reservedReleaseBtn}
                      activeOpacity={0.7}
                      onPress={() => { setMonthlyReservation.mutate({ montant: 0 }); }}
                    >
                      <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                      <Text style={styles.reservedReleaseText}>Libérer</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Réservé par projet */}
              {pilotageData.reserved_by_project.map((r) => (
                <View key={r.id} style={styles.reservedProjectBlock}>
                  <View style={styles.reservedItem}>
                    <View style={[styles.reservedItemIcon, { backgroundColor: COLORS.blue + '22' }]}>
                      <Ionicons name="bookmark" size={16} color={COLORS.blue} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reservedItemName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.reservedItemHint}>Projet · réservé jusqu'à utilisation</Text>
                    </View>
                    <Text style={[styles.reservedItemAmount, { color: COLORS.blue }]}>{fmtMain(r.total)}</Text>
                  </View>
                  <View style={styles.reservedActions}>
                    <TouchableOpacity
                      style={styles.reservedReleaseBtn}
                      activeOpacity={0.7}
                      onPress={() => { releaseReserved.mutate(r.id); }}
                    >
                      <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
                      <Text style={styles.reservedReleaseText}>Libérer</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reservedTransferBtn}
                      activeOpacity={0.7}
                      onPress={() => {
                        setShowReservedModal(false);
                        const q = new URLSearchParams({
                          from: r.source_account_id ?? '',
                          to: r.linked_account_id ?? '',
                          amount: String(Math.round(r.total)),
                          label: r.name,
                          origin: 'pilotage',
                          releaseProject: r.id,
                        });
                        router.push(`/(tabs)/comptes/transfer?${q.toString()}` as any);
                      }}
                    >
                      <Ionicons name="swap-horizontal" size={14} color={COLORS.green} />
                      <Text style={styles.reservedTransferText}>Créer un virement</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              {reservationsTotal <= 0 && pilotageData.reserved_by_project.length === 0 && (
                <Text style={styles.reservedEmpty}>Aucun montant réservé pour le moment.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modale : estimation hebdo des dépenses variables (alimente q9) */}
      <Modal visible={showVariableModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowVariableModal(false)}>
        <View style={styles.varModalOverlay}>
          <View style={styles.varModalBox}>
            <Text style={styles.varModalTitle}>Dépenses variables</Text>
            <Text style={styles.varModalHint}>
              Combien dépensez-vous environ pour vos courses, loisirs et dépenses variables ?
            </Text>
            <View style={styles.varModalInputRow}>
              <TextInput
                style={styles.varModalInput}
                value={weeklyVariableInput}
                onChangeText={(v) => setWeeklyVariableInput(v.replace(/[^0-9.,]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="Ex. 120"
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
              />
              <Text style={styles.varModalUnit} numberOfLines={1}>€ / sem.</Text>
            </View>
            {weeklyVariableInput ? (
              <Text style={styles.varModalMonthly}>
                ≈ {Math.round((parseFloat(weeklyVariableInput.replace(',', '.')) || 0) * 4.33).toLocaleString('fr-FR')} {CURRENCY_SYMBOL} / mois
              </Text>
            ) : null}
            <View style={styles.varModalActions}>
              <TouchableOpacity style={styles.varModalCancel} onPress={() => setShowVariableModal(false)}>
                <Text style={styles.varModalCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.varModalSave}
                onPress={async () => {
                  const weekly = parseFloat(weeklyVariableInput.replace(',', '.')) || 0;
                  try {
                    await updateProfileVar.mutateAsync({ weekly_variable_budget: weekly > 0 ? weekly : null });
                    // Sync best-effort de la réponse q9 (si la ligne existe déjà)
                    if (supabase && user?.id) {
                      await supabase.from('user_questionnaire_answers')
                        .update({ q9: weekly > 0 ? String(weekly) : '' })
                        .eq('user_id', user.id);
                    }
                  } catch (e) { console.warn('[pilotage] maj budget variable échouée:', e); }
                  setShowVariableModal(false);
                }}
              >
                <Text style={styles.varModalSaveText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  safetyBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.yellow + '1A', borderWidth: 1, borderColor: c.yellow + '40',
    borderRadius: 12, marginHorizontal: 8, marginBottom: 8,
    padding: 12,
  },
  safetyBannerText: { flex: 1, fontSize: 12, color: c.yellow, lineHeight: 18 },

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
    fontSize: 22,
    fontWeight: '700',
    color: c.text,
    letterSpacing: -0.5,
  },
  sectionDivider: {
    height: 0.5,
    backgroundColor: c.cardBorder,
    marginHorizontal: 4,
  },
  monthPill: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  monthPillText: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
    textTransform: 'capitalize',
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
    gap: 8,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 16,
    gap: 4,
  },
  summaryItemEpargne: {
    flex: 1.4,
    backgroundColor: c.card,
    padding: 14,
    borderRadius: 16,
    gap: 3,
    borderLeftWidth: 3,
    borderLeftColor: c.savings,
  },
  summaryLabel: {
    fontSize: 11,
    color: c.textSecondary,
    fontWeight: '600',
  },
  summaryAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: c.checking,
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
  suiviValue: { fontSize: 16, fontWeight: '700' },
  suiviLabelBig: { fontSize: 16, color: c.text, fontWeight: '700' },
  suiviValueBig: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },

  // Recommandations — bandeau cumuls / alerte / bouton
  overspendBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.danger + '15', borderRadius: 10, borderWidth: 1, borderColor: c.danger + '40',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  overspendText: { flex: 1, fontSize: 12, color: c.danger, fontWeight: '500', lineHeight: 16 },
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
  // Modal Réservé
  reservedOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  reservedSheet: {
    backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder, gap: 8,
  },
  reservedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  reservedTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  reservedItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  reservedItemIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reservedItemName: { fontSize: 14, fontWeight: '700', color: c.text },
  reservedItemHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  reservedItemAmount: { fontSize: 15, fontWeight: '800' },
  reservedProjectBlock: {
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14,
    paddingHorizontal: 12, marginTop: 8, backgroundColor: c.card,
  },
  reservedActions: { flexDirection: 'row', gap: 8, paddingBottom: 12, paddingTop: 2 },
  reservedReleaseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: c.danger + '44', backgroundColor: c.danger + '12',
  },
  reservedReleaseText: { fontSize: 12, fontWeight: '700', color: c.danger },
  reservedTransferBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: c.green + '44', backgroundColor: c.green + '12',
  },
  reservedTransferText: { fontSize: 12, fontWeight: '700', color: c.green },
  reservedEmpty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', paddingVertical: 24 },
  // Modale enveloppe variable
  varModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  varModalBox: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22 },
  varModalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 8 },
  varModalHint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 18 },
  varModalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  varModalInput: {
    flexGrow: 0, flexShrink: 1, width: 150, maxWidth: '60%',
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: c.text,
  },
  varModalUnit: { fontSize: 14, color: c.textSecondary, fontWeight: '600', flexShrink: 0 },
  varModalMonthly: { fontSize: 13, color: c.emerald, fontWeight: '600', marginTop: 10 },
  varModalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  varModalCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
  varModalCancelText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  varModalSave: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center' },
  varModalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  heroCard: { backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14 },
  heroLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 4 },
  heroAmount: { fontSize: 38, fontWeight: '900', marginBottom: 4 },
  heroSub: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  });
}
