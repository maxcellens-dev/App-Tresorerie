import React, { useState, useEffect, useRef, useMemo } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import OnboardingHintBanner from '../../../components/onboarding/OnboardingHintBanner';
import AdSlot from '../../../components/marketing/AdSlot';
import CurrencyPicker from '../../../components/account/CurrencyPicker';
import { useOnbHighlight, onbGlow } from '../../../lib/engagement/onbHighlight';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import {
  useProjects,
  useDeleteProjectFull,
  useArchiveProject,
  useCheckProjectTransactions,
  useDeleteProjectFromDate,
} from '../../../hooks/data/useProjects';
import { usePilotageData } from '../../../hooks/pilotage/usePilotageData';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../../lib/finance/currency';
import { useCredits } from '../../../hooks/data/useCredits';
import { useAllCreditEvents } from '../../../hooks/data/useCreditEvents';
import { computeAmortization } from '../../../lib/finance/amortization';
import { projectMode, type ProjectMode } from '../../../lib/finance/projectTx';
import { todayISO } from '../../../lib/dateUtils';
import { monthlyOccurrenceCount } from '../../../lib/finance/recurrence';
import { useProfile } from '../../../hooks/data/useProfile';
import { TextInput, Modal } from 'react-native';
import { useRwProjects, useCreateRwProject, useRwInvitations, useRwRespondInvitation, useRwProjectsStats } from '../../../hooks/engagement/useRelykaWorld';
import KeyboardAwareOverlay from '../../../components/layout/KeyboardAwareOverlay';
import { useReadOnlyGuard } from '../../../hooks/platform/useReadOnlyGuard';

const RW_EMOJIS = ['💸', '🏖️', '✈️', '🍽️', '🎉', '🏠', '🚗', '⛰️', '🛒', '🎲'];

/** Vocabulaire de la carte selon le mode du projet (cf. lib/projectTx). */
const MODE_CARD: Record<ProjectMode, { badge: string; icon: string; target: string; monthly: string; progress: string; remaining: string }> = {
  transfer: { badge: 'Mis de côté', icon: 'trending-up', target: 'Cible', monthly: 'Chaque mois', progress: 'Avancement', remaining: 'Restant à verser' },
  reserve: { badge: 'Réservé', icon: 'lock-closed', target: 'Cible', monthly: 'Chaque mois', progress: 'Avancement', remaining: 'Restant à réserver' },
  spend: { badge: 'Dépenses', icon: 'card', target: 'Budget', monthly: 'Chaque mois', progress: 'Déjà dépensé', remaining: 'Restant à dépenser' },
};


function ProjectsScreen() {
  const COLORS = useAppColors();
  const onbProject = useOnbHighlight('project');
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  // Consultation admin : cet écran ne doit rien écrire sur le compte visité (useReadOnlyGuard).
  const readOnly = useReadOnlyGuard();
  // Relyka World (projets partagés) — affichés dans cette même page.
  const { data: rwProjects = [] } = useRwProjects(user?.id);
  const { data: rwInvitations = [], error: rwInvitesError } = useRwInvitations(user?.id);
  const respondInvite = useRwRespondInvitation(user?.id);
  const createRwProject = useCreateRwProject(user?.id);
  // Projets partagés actifs vs archivés (les archivés sont masqués de la liste active et
  // consultables dans la vue « Archives », d'où on peut les désarchiver).
  const activeRwProjects = rwProjects.filter((p) => !p.archived_at);
  const archivedRwProjects = rwProjects.filter((p) => !!p.archived_at);
  // Stats des projets partagés (participants, total, répartition) → visibles SUR la carte.
  const { data: rwStats = {} } = useRwProjectsStats(user?.id, activeRwProjects.map((p) => p.id));
  const RW_MEMBER_COLORS = [COLORS.emerald, COLORS.violet, COLORS.orange, COLORS.blue, COLORS.teal];
  const [showInfo, setShowInfo] = useState(false);
  const [showTypeChoice, setShowTypeChoice] = useState(false);
  // Bannière interne « Projets › + Projet » : on arrive ici avec le choix du type déjà ouvert.
  // `adNonce` change à chaque clic → l'action rejoue même si l'on est déjà sur la page.
  const adParams = useLocalSearchParams<{ adAction?: string; adNonce?: string }>();
  useEffect(() => {
    if (adParams.adAction === 'new') setShowTypeChoice(true);
  }, [adParams.adAction, adParams.adNonce]);
  const [showRwCreate, setShowRwCreate] = useState(false);
  const [rwName, setRwName] = useState('');
  const [rwEmoji, setRwEmoji] = useState('💸');
  const [rwDesc, setRwDesc] = useState('');
  /* Devise du PROJET : celle dans laquelle se lisent tous ses totaux (soldes entre participants,
     « qui doit quoi »). Elle démarre sur la devise de référence de l'utilisateur — c'est le cas de
     loin le plus fréquent — mais un voyage se tient souvent dans une autre monnaie. */
  const [rwCurrency, setRwCurrency] = useState(profile?.currency_code ?? 'EUR');
  useEffect(() => { setRwCurrency(profile?.currency_code ?? 'EUR'); }, [profile?.currency_code]);
  const [rwBusy, setRwBusy] = useState(false);
  const [rwErr, setRwErr] = useState<string | null>(null);
  const myName = profile?.full_name || user?.email?.split('@')[0] || 'Moi';
  const onCreateRw = async () => {
    if (!rwName.trim() || readOnly.blocked()) return;
    setRwBusy(true); setRwErr(null);
    try {
      const proj = await createRwProject.mutateAsync({ name: rwName.trim(), emoji: rwEmoji, description: rwDesc.trim(), myName, currency: rwCurrency });
      setShowRwCreate(false); setRwName(''); setRwDesc(''); setRwEmoji('💸');
      router.push(`/(tabs)/(secondary)/relyka-world/${(proj as any).id}` as any);
    } catch (e: any) {
      setRwErr(e?.message ?? 'Création impossible.');
    } finally { setRwBusy(false); }
  };
  const addBtnRef = useRef<any>(null);

  const [refreshing, setRefreshing] = useState(false);
  const projectsQuery = useProjects(user?.id || '');
  const { data: projects = [], isLoading, refetch } = projectsQuery;
  // C4 — crédits liés à un projet : map projectId → [{ label, crd }].
  const { data: creditsList = [] } = useCredits(user?.id);
  // Sans les ÉVÉNEMENTS, le capital restant dû reste celui du plan d'origine : un remboursement
  // anticipé enregistré ne se voyait pas ici, alors que la fiche du crédit et la tréso le comptaient.
  const { data: creditEventsByCredit = {} } = useAllCreditEvents(user?.id);
  const today = todayISO();
  const creditsByProject = useMemo(() => {
    const m: Record<string, { label: string; crd: number }[]> = {};
    for (const c of creditsList) {
      if (!c.project_id) continue;
      const amort = computeAmortization({ ...c, events: creditEventsByCredit[c.id] ?? null });
      (m[c.project_id] ??= []).push({ label: c.label, crd: amort.crdAtDate(today) });
    }
    return m;
  }, [creditsList, creditEventsByCredit, today]);
  const deleteFullMutation = useDeleteProjectFull(user?.id || '');
  const archiveMutation = useArchiveProject(user?.id || '');
  const deleteFromDateMutation = useDeleteProjectFromDate(user?.id || '');
  const { check: checkTransactions } = useCheckProjectTransactions(user?.id || '');
  const { data: pilotage } = usePilotageData(user?.id);

  // Build a map of project progress from pilotage (transaction-based)
  const progressMap = React.useMemo(() => {
    const map: Record<string, { percentage: number; accumulated: number }> = {};
    if (pilotage?.projects_with_progress) {
      for (const p of pilotage.projects_with_progress) {
        map[p.id] = {
          percentage: p.progress_percentage,
          accumulated: (p.progress_percentage / 100) * p.target_amount,
        };
      }
    }
    return map;
  }, [pilotage?.projects_with_progress]);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'full' | 'from-date'>('full');
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const [futureDates, setFutureDates] = useState<string[]>([]);
  const [selectedFromDate, setSelectedFromDate] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);
  const [archiveFutureCount, setArchiveFutureCount] = useState(0);

  // Archivage manuel uniquement (bouton « Archiver »). Plus d'archivage automatique.

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await projectsQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { past, future } = await checkTransactions(id);
      setDeleteConfirmId(id);
      // Collect future dates for the date picker
      const uniqueDates = [...new Set(future.map(t => t.date))].sort();
      setFutureDates(uniqueDates);
      // If there are past transactions, offer both options
      if (past.length > 0) {
        setShowDeleteOptions(true);
        setDeleteMode('full');
        setSelectedFromDate(uniqueDates[0] || '');
      } else {
        // No past transactions — simple full delete
        setShowDeleteOptions(false);
        setDeleteMode('full');
        setSelectedFromDate('');
      }
    } catch {
      setDeleteConfirmId(id);
      setShowDeleteOptions(false);
      setDeleteMode('full');
    }
  };

  const confirmDeleteFull = () => {
    if (!deleteConfirmId || readOnly.blocked()) return;
    deleteFullMutation.mutate(deleteConfirmId, {
      onSuccess: () => { resetDeleteState(); refetch(); },
      onError: () => resetDeleteState(),
    });
  };

  const confirmDeleteFromDate = () => {
    if (!deleteConfirmId || !selectedFromDate || readOnly.blocked()) return;
    deleteFromDateMutation.mutate(
      { projectId: deleteConfirmId, fromDate: selectedFromDate },
      {
        onSuccess: () => { resetDeleteState(); refetch(); },
        onError: () => resetDeleteState(),
      },
    );
  };

  // Archivage : on conserve les transactions passées ; s'il reste des versements futurs,
  // on demande confirmation (ils seront supprimés), à l'image de la suppression de projet.
  const handleArchiveClick = async (projectId: string) => {
    if (readOnly.blocked()) return;
    try {
      const { future } = await checkTransactions(projectId);
      if (future.length > 0) {
        setArchiveConfirmId(projectId);
        setArchiveFutureCount(future.length);
        return;
      }
    } catch { /* en cas d'échec du check, on archive directement */ }
    doArchive(projectId);
  };

  const doArchive = (projectId: string) => {
    archiveMutation.mutate(projectId, {
      onSuccess: () => { setArchiveConfirmId(null); refetch(); },
      onError: (e: any) => {
        setArchiveConfirmId(null);
        const msg = e?.message || 'Archivage impossible.';
        Alert.alert('Archivage impossible', msg); // in-app global (§7)
      },
    });
  };

  const resetDeleteState = () => {
    setDeleteConfirmId(null);
    setShowDeleteOptions(false);
    setDeleteMode('full');
    setSelectedFromDate('');
    setFutureDates([]);
  };

  const renderProjectItem = ({ item: project }: { item: any }) => {
    const targetAmount = parseFloat(project.target_amount);
    const monthlyAllocation = parseFloat(project.monthly_allocation);
    // Le mode change le VOCABULAIRE de la carte : un projet « dépenser » ne met rien de côté.
    const pMode = projectMode(project);
    const mCfg = MODE_CARD[pMode];
    const pm = progressMap[project.id];
    const currentAccumulated = pm ? pm.accumulated : parseFloat(project.current_accumulated || '0');
    const progress = pm ? Math.min(100, Math.round(pm.percentage)) : (targetAmount > 0 ? Math.min(100, Math.round((currentAccumulated / targetAmount) * 100)) : 0);
    // Objectif atteint dès qu'il reste moins d'1 centime (évite le blocage à 999,99 / 1000).
    const isComplete = progress >= 100 || (targetAmount > 0 && targetAmount - currentAccumulated < 0.01);
    // À l'affichage, on cale le cumul sur la cible quand l'objectif est atteint (pas de « 999,99 »).
    const displayAccumulated = isComplete ? targetAmount : currentAccumulated;

    const monthsToComplete = (() => {
      if (project.target_date && (project.allocation_type === 'date' || !project.allocation_type)) {
        /* Compte PARTAGÉ (lib/finance/recurrence). La boucle qui vivait ici avançait par
           `cursor.setMonth(+1)` : partant du 31, JavaScript passe par « 31 février » et fait
           glisser toute la série au 3 du mois — le nombre de mois restants était donc faux pour
           tout projet dont l'échéance tombe le 29, 30 ou 31. */
        const paymentDay = project.transaction_day ?? Number(today.slice(8, 10));
        const [y, m] = today.split('-').map(Number);
        const dim = new Date(y, m, 0).getDate();
        const thisMonthOcc = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(paymentDay, dim)).padStart(2, '0')}`;
        // L'échéance du mois courant ne compte que si elle n'est pas déjà passée.
        const firstOcc = thisMonthOcc > today
          ? thisMonthOcc
          : `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`;
        return monthlyOccurrenceCount(firstOcc, project.target_date);
      }
      return monthlyAllocation > 0 ? Math.ceil((targetAmount - currentAccumulated) / monthlyAllocation) : 0;
    })();

    const statusColors: Record<string, string> = {
      active: COLORS.primary,
      on_hold: COLORS.textSecondary,
      completed: COLORS.green,
      archived: COLORS.orange,
    };

    const statusLabels = {
      active: 'Actif',
      on_hold: 'En pause',
      completed: 'Complété',
      archived: 'Archivé',
    } as const;

    return (
      <View
        style={[
          styles.projectCard,
          {
            backgroundColor: COLORS.surface,
            borderColor: COLORS.border,
          },
        ]}
      >
        <View style={styles.projectHeader}>
          <View style={styles.projectInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.projectName, { color: COLORS.text, flexShrink: 1 }]} numberOfLines={1}>
                {project.name}
              </Text>
              {/* Ce que fait le projet : virements / réservation / dépenses. */}
              <View style={[styles.modeBadge, { borderColor: COLORS.primary + '55', backgroundColor: COLORS.primary + '14' }]}>
                <Ionicons name={mCfg.icon as any} size={10} color={COLORS.primary} />
                <Text style={[styles.modeBadgeText, { color: COLORS.primary }]}>{mCfg.badge}</Text>
              </View>
            </View>
            <Text style={[styles.projectDescription, { color: COLORS.textSecondary }]}>
              {project.description || 'Pas de description'}
            </Text>
            {/* C4 — crédit(s) liés au projet */}
            {(creditsByProject[project.id] ?? []).map((cr, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <Ionicons name="card-outline" size={12} color={COLORS.blue} />
                <Text style={{ fontSize: 11.5, color: COLORS.blue, fontWeight: '600' }} numberOfLines={1}>
                  Financé par crédit · {cr.label} · {Math.round(cr.crd).toLocaleString('fr-FR')} € dû
                </Text>
              </View>
            ))}
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[project.status as keyof typeof statusColors] + '20' },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusColors[project.status as keyof typeof statusColors] },
              ]}
            >
              {statusLabels[project.status as keyof typeof statusLabels]}
            </Text>
          </View>
        </View>

        <View style={styles.projectDetails}>
          <View style={styles.detailRow}>
            <View>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                {mCfg.target}
              </Text>
              <Text style={[styles.detailValue, { color: COLORS.text }]}>
                {CURRENCY_SYMBOL}{targetAmount.toFixed(2)}
              </Text>
            </View>
            {project.allocation_type === 'ponctuel' ? (
              <View>
                <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                  {mCfg.remaining}
                </Text>
                <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                  {CURRENCY_SYMBOL}{Math.max(0, targetAmount - currentAccumulated).toFixed(2)}
                </Text>
              </View>
            ) : (
              <>
                <View>
                  <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                    {mCfg.monthly}
                  </Text>
                  <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                    {CURRENCY_SYMBOL}{monthlyAllocation.toFixed(2)}/mois
                  </Text>
                </View>
                {monthsToComplete > 0 && !isComplete && (
                  <View>
                    <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                      Durée restante
                    </Text>
                    <Text style={[styles.detailValue, { color: COLORS.text }]}>
                      {monthsToComplete}m
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>

          {/* Progress Bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                {mCfg.progress}
              </Text>
              <Text style={[styles.progressPercentage, { color: isComplete ? COLORS.green : COLORS.primary }]}>
                {progress}%
              </Text>
            </View>
            <View
              style={[
                styles.progressBar,
                { backgroundColor: COLORS.background, borderColor: COLORS.border },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(progress, 100)}%`,
                    backgroundColor: isComplete ? COLORS.green : COLORS.primary,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressAmount, { color: COLORS.textSecondary }]}>
              {CURRENCY_SYMBOL}{displayAccumulated.toFixed(2)} / {CURRENCY_SYMBOL}{targetAmount.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Complete badge */}
        {isComplete && project.status !== 'archived' && (
          <View style={styles.completeBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            <Text style={styles.completeBannerText}>
              {pMode === 'spend' ? 'Budget consommé ! Tu peux archiver ce projet.' : 'Objectif atteint ! Tu peux archiver ce projet.'}
            </Text>
          </View>
        )}

        <View style={styles.projectActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: COLORS.primary + '20' }]}
            onPress={() => router.push(`/(tabs)/projects/add?id=${project.id}` as any)}
          >
            <Ionicons name="settings-outline" size={16} color={COLORS.primary} />
            <Text style={[styles.actionButtonText, { color: COLORS.primary }]}>Gérer</Text>
          </TouchableOpacity>

          {/* Bouton Archiver : manuel, disponible pour tout projet non archivé */}
          {project.status !== 'archived' && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: COLORS.orange + '20' }]}
              onPress={() => handleArchiveClick(project.id)}
              disabled={archiveMutation.isPending}
            >
              <Ionicons name="archive" size={16} color="#f59e0b" />
              <Text style={[styles.actionButtonText, { color: COLORS.orange }]}>
                {archiveMutation.isPending ? 'Archivage...' : 'Archiver'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="flag-outline" size={48} color={COLORS.textSecondary} />
      <Text style={[styles.emptyStateText, { color: COLORS.textSecondary }]}>
        Aucun projet
      </Text>
      <Text style={[styles.emptyStateSubtext, { color: COLORS.textSecondary }]}>
        Crée un projet pour suivre tes objectifs
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: COLORS.background }]}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'list')]} edges={['left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity
            ref={addBtnRef}
            style={[styles.addBtn, onbGlow(COLORS, onbProject)]}
            activeOpacity={0.8}
            onPress={() => setShowTypeChoice(true)}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={20} color={COLORS.primary} />
            <Text style={[styles.addBtnLabel, { color: COLORS.primary }]}>Projet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.infoBtn}
            activeOpacity={0.8}
            onPress={() => setShowInfo(true)}
            accessibilityRole="button"
            accessibilityLabel="À quoi servent les projets ?"
          >
            <Ionicons name="bulb-outline" size={20} color={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.archiveToggleBtn}
            activeOpacity={0.8}
            onPress={() => setShowArchived(!showArchived)}
          >
            <Ionicons name={showArchived ? 'folder-open-outline' : 'archive-outline'} size={16} color={showArchived ? COLORS.primary : COLORS.textSecondary} />
            <Text style={[styles.archiveToggleBtnLabel, showArchived && { color: COLORS.primary }]}>Archives</Text>
          </TouchableOpacity>
        </View>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={COLORS.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={showArchived
              ? projects.filter((p) => p.status === 'archived')
              : projects.filter((p) => p.status !== 'completed' && p.status !== 'archived')
            }
            keyExtractor={(item) => item.id}
            renderItem={renderProjectItem}
            ListHeaderComponent={
              !showArchived ? (
                <>
                  {/* ÉCHEC DE LECTURE DES INVITATIONS : on le DIT.
                      Cette liste vide se confond avec « aucune invitation », et c'est précisément
                      ce qui a fait chercher longtemps : en consultation admin, la requête échouait
                      (fonction serveur absente) et l'écran affichait sereinement… rien. Une absence
                      de données et une erreur ne doivent jamais se ressembler. */}
                  {rwInvitesError && (
                    <View style={styles.rwInvError}>
                      <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
                      <Text style={styles.rwInvErrorText}>
                        Impossible de lire les invitations : {(rwInvitesError as any)?.message ?? 'erreur inconnue'}
                      </Text>
                    </View>
                  )}
                  {/* Invitations Relyka World en attente */}
                  {rwInvitations.map((inv) => (
                    <View key={inv.id} style={styles.rwInvCard}>
                      <Text style={{ fontSize: 22 }}>{inv.project_emoji ?? '💸'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rwProjName} numberOfLines={1}>{inv.project_name}</Text>
                        <Text style={styles.rwProjSub} numberOfLines={1}>Invitation de {inv.from_name}</Text>
                      </View>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" style={styles.rwInvDecline} onPress={() => { if (readOnly.blocked()) return; respondInvite.mutate({ inviteId: inv.id, accept: false }); }}><Ionicons name="close" size={18} color={COLORS.danger} /></TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Accepter l'invitation" style={styles.rwInvAccept} onPress={() => { if (readOnly.blocked()) return; respondInvite.mutate({ inviteId: inv.id, accept: true }); }}><Ionicons name="checkmark" size={18} color="#fff" /></TouchableOpacity>
                    </View>
                  ))}
                  {/* Projets partagés (Relyka World) — actifs uniquement */}
                  {activeRwProjects.length > 0 && (
                    <>
                      <Text style={styles.rwSectionLabel}>Projets partagés</Text>
                      {activeRwProjects.map((p) => {
                        const st = rwStats[p.id];
                        const members = st?.participants ?? [];
                        const total = st?.total ?? 0;
                        // Répartition « qui a payé quoi » (par participant, ordre stable des membres).
                        const segments = members
                          .map((m, i) => ({ name: m.name, amount: st?.paidBy[m.id] ?? 0, color: RW_MEMBER_COLORS[i % RW_MEMBER_COLORS.length] }))
                          .filter((s) => s.amount > 0);
                        return (
                          <TouchableOpacity key={p.id} style={styles.rwProjCard} activeOpacity={0.8} onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/${p.id}` as any)}>
                            <Text style={{ fontSize: 26 }}>{p.emoji || '💸'}</Text>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <Text style={[styles.rwProjName, { flexShrink: 1 }]} numberOfLines={1}>{p.name}</Text>
                                {/* Pile d'initiales des participants (max 4 + compteur) */}
                                {members.length > 0 && (
                                  <View style={{ flexDirection: 'row' }}>
                                    {members.slice(0, 4).map((m, i) => (
                                      <View key={m.id} style={[styles.rwAvatar, { backgroundColor: RW_MEMBER_COLORS[i % RW_MEMBER_COLORS.length], marginLeft: i === 0 ? 0 : -7 }]}>
                                        <Text style={styles.rwAvatarText}>{(m.name || '?').trim().charAt(0).toUpperCase()}</Text>
                                      </View>
                                    ))}
                                    {members.length > 4 && (
                                      <View style={[styles.rwAvatar, { backgroundColor: COLORS.textSecondary, marginLeft: -7 }]}>
                                        <Text style={styles.rwAvatarText}>+{members.length - 4}</Text>
                                      </View>
                                    )}
                                  </View>
                                )}
                              </View>
                              <Text style={styles.rwProjSub} numberOfLines={1}>
                                {/* Devise du PROJET (les dépenses y sont déjà converties par
                                    useRwProjectsStats) — et non un « € » écrit en dur. */}
                                {total > 0
                                  ? `${Math.round(total).toLocaleString('fr-FR')} ${currencySymbolFor(st?.currency ?? p.currency)} de dépenses · ${members.length} participant${members.length > 1 ? 's' : ''}`
                                  : (p.description || 'Dépenses partagées')}
                              </Text>
                              {/* Barre « qui a payé quoi » (segments par contributeur) */}
                              {segments.length > 0 && total > 0 && (
                                <View style={styles.rwContribBar}>
                                  {segments.map((s) => (
                                    <View key={s.name} style={{ flex: s.amount / total, backgroundColor: s.color }} />
                                  ))}
                                </View>
                              )}
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                  {/* Bandeau pub (maison) — juste au-dessus des projets personnels */}
                  <AdSlot placement="projets_perso" />
                  {activeRwProjects.length > 0 && (
                    <Text style={styles.rwSectionLabel}>Projets personnels</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.archiveTitle}>Projets archivés</Text>
                  {/* Projets partagés archivés — ouvrir pour les désarchiver */}
                  {archivedRwProjects.length > 0 && (
                    <>
                      <Text style={styles.rwSectionLabel}>Projets partagés archivés</Text>
                      {archivedRwProjects.map((p) => (
                        <TouchableOpacity key={p.id} style={styles.rwProjCard} activeOpacity={0.8} onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/${p.id}` as any)}>
                          <Text style={{ fontSize: 26 }}>{p.emoji || '💸'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rwProjName} numberOfLines={1}>{p.name}</Text>
                            <Text style={styles.rwProjSub} numberOfLines={1}>{p.description || 'Dépenses partagées'}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </>
              )
            }
            ListEmptyComponent={renderEmptyState}
            ListFooterComponent={<AdSlot placement="projets" />}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={COLORS.primary}
                progressBackgroundColor={COLORS.surface}
              />
            }
          />
        )}
      </SafeAreaView>

      {/* Info « À quoi servent les projets ? » (déclenché par l'ampoule du header) */}
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <TouchableOpacity style={styles.rwModalOverlay} activeOpacity={1} onPress={() => setShowInfo(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.infoModalCard} onPress={() => {}}>
            <View style={[styles.infoModalIcon, { backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary + '55' }]}>
              <Ionicons name="bulb-outline" size={28} color={COLORS.primary} />
            </View>
            <Text style={styles.infoModalTitle}>À quoi servent les projets ?</Text>
            <Text style={styles.infoModalText}>
              Un projet, c'est un objectif d'argent (voiture, voyage, cours de piano…) que l'app suit pour toi. À la création, tu choisis ce qu'elle doit faire :
              {'\n\n'}• <Text style={{ fontWeight: '700', color: COLORS.text }}>Mettre de côté</Text> : elle prépare des virements vers ton épargne ou tes investissements.
              {'\n'}• <Text style={{ fontWeight: '700', color: COLORS.text }}>Conserver pour plus tard</Text> : l'argent ne bouge pas, il est juste « Réservé » sur ton compte.
              {'\n'}• <Text style={{ fontWeight: '700', color: COLORS.text }}>Dépenser petit à petit</Text> : elle crée de vraies dépenses au rythme du projet.
              {'\n\n'}Puis tu choisis le rythme : un montant <Text style={{ fontWeight: '700', color: COLORS.text }}>mensuel</Text>, une <Text style={{ fontWeight: '700', color: COLORS.text }}>date cible</Text>, ou des échéances <Text style={{ fontWeight: '700', color: COLORS.text }}>ponctuelles</Text>.
              {'\n\n'}Un <Text style={{ fontWeight: '700', color: COLORS.text }}>projet partagé</Text> permet de suivre des dépenses communes et de les équilibrer entre plusieurs personnes.
            </Text>
            <TouchableOpacity style={[styles.infoModalBtn, { backgroundColor: COLORS.primary }]} onPress={() => setShowInfo(false)} activeOpacity={0.85}>
              <Text style={styles.infoModalBtnText}>J'ai compris</Text>
              <Ionicons name="checkmark" size={18} color={COLORS.onAccent} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Choix du type de projet */}
      <Modal visible={showTypeChoice} transparent animationType="fade" onRequestClose={() => setShowTypeChoice(false)}>
        <TouchableOpacity style={styles.rwModalOverlay} activeOpacity={1} onPress={() => setShowTypeChoice(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.rwChoiceCard} onPress={() => {}}>
            <Text style={styles.rwModalTitle}>Quel type de projet ?</Text>
            <TouchableOpacity style={styles.rwChoiceOpt} activeOpacity={0.85}
              onPress={() => { setShowTypeChoice(false); router.push('/(tabs)/projects/add' as any); }}>
              <View style={[styles.rwChoiceIcon, { backgroundColor: COLORS.primary + '22' }]}><Ionicons name="flag" size={22} color={COLORS.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rwChoiceTitle}>Personnel</Text>
                <Text style={styles.rwChoiceSub}>Mettre de côté, conserver, ou dépenser petit à petit</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.rwChoiceOpt} activeOpacity={0.85}
              onPress={() => { setShowTypeChoice(false); setShowRwCreate(true); }}>
              <View style={[styles.rwChoiceIcon, { backgroundColor: COLORS.blue + '22' }]}><Ionicons name="earth" size={22} color={COLORS.blue} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rwChoiceTitle}>Partagé</Text>
                <Text style={styles.rwChoiceSub}>Dépenses partagées entre amis, avec équilibres</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Création projet partagé */}
      <Modal visible={showRwCreate} transparent animationType="slide" onRequestClose={() => setShowRwCreate(false)}>
        <KeyboardAwareOverlay style={styles.rwModalOverlay}>
          <View style={styles.rwCreateCard}>
            <View style={styles.rwCreateHeader}>
              <Text style={styles.rwModalTitle}>Nouveau projet partagé</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setShowRwCreate(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.rwLabel}>Icône</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {RW_EMOJIS.map((e) => (
                <TouchableOpacity key={e} style={[styles.rwEmojiPick, rwEmoji === e && { borderColor: COLORS.emerald, borderWidth: 2 }]} onPress={() => setRwEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.rwLabel}>Nom du projet *</Text>
            <TextInput style={styles.rwInput} value={rwName} onChangeText={setRwName} placeholder="Ex. Week-end à Lyon" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.rwLabel}>Description (optionnel)</Text>
            <TextInput style={styles.rwInput} value={rwDesc} onChangeText={setRwDesc} placeholder="Quelques mots…" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.rwLabel}>Devise du projet</Text>
            <CurrencyPicker value={rwCurrency} onChange={setRwCurrency} />
            {/* Ce choix se fige : les dépenses déjà saisies sont libellées dans la devise où elles
                ont été payées, et rejuger un projet dans une autre monnaie changerait tous les
                soldes entre participants après coup. */}
            <Text style={styles.rwCurrencyHint}>
              Tous les totaux du projet s'affichent dans cette devise. Une dépense payée depuis un
              compte dans une autre devise se saisit dans celle du compte, puis est convertie ici.
            </Text>
            {!!rwErr &&<Text style={{ color: COLORS.danger, fontSize: 12.5, marginBottom: 10 }}>{rwErr}</Text>}
            <TouchableOpacity style={[styles.rwCreateCta, (!rwName.trim() || rwBusy) && { opacity: 0.5 }]} onPress={onCreateRw} disabled={!rwName.trim() || rwBusy} activeOpacity={0.85}>
              {rwBusy ? <ActivityIndicator color={COLORS.onAccent} /> : <Text style={styles.rwCreateCtaText}>Créer le projet</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareOverlay>
      </Modal>


      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <View style={styles.confirmDialogOverlay}>
          <View style={styles.confirmDialog}>
            <Text style={[styles.confirmTitle, { color: COLORS.text }]}>
              <Ionicons name="warning" size={18} color={COLORS.danger} />{'  '}Supprimer le projet
            </Text>

            {showDeleteOptions ? (
              <>
                <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
                  Ce projet a des transactions passées. Choisis comment procéder :
                </Text>

                {/* Option 1 : Tout supprimer */}
                <TouchableOpacity
                  style={[
                    styles.deleteOption,
                    deleteMode === 'full' && styles.deleteOptionActive,
                  ]}
                  onPress={() => setDeleteMode('full')}
                >
                  <View style={styles.deleteOptionRadio}>
                    <View style={[
                      styles.radioOuter,
                      deleteMode === 'full' && { borderColor: COLORS.danger },
                    ]}>
                      {deleteMode === 'full' && <View style={[styles.radioInner, { backgroundColor: COLORS.danger }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deleteOptionTitle, { color: COLORS.text }]}>
                        Tout supprimer
                      </Text>
                      <Text style={[styles.deleteOptionDesc, { color: COLORS.textSecondary }]}>
                        Supprime le projet et toutes les transactions (passées et futures)
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Option 2 : Supprimer à partir d'une date */}
                <TouchableOpacity
                  style={[
                    styles.deleteOption,
                    deleteMode === 'from-date' && styles.deleteOptionActive,
                  ]}
                  onPress={() => setDeleteMode('from-date')}
                >
                  <View style={styles.deleteOptionRadio}>
                    <View style={[
                      styles.radioOuter,
                      deleteMode === 'from-date' && { borderColor: COLORS.orange },
                    ]}>
                      {deleteMode === 'from-date' && <View style={[styles.radioInner, { backgroundColor: COLORS.orange }]} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.deleteOptionTitle, { color: COLORS.text }]}>
                        Supprimer à partir d'une date
                      </Text>
                      <Text style={[styles.deleteOptionDesc, { color: COLORS.textSecondary }]}>
                        Conserve les transactions passées, supprime les futures. Le montant cible sera recalculé.
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                {/* Date selector for from-date mode */}
                {deleteMode === 'from-date' && (
                  <View style={styles.datePickerSection}>
                    <Text style={[styles.datePickerLabel, { color: COLORS.textSecondary }]}>
                      Supprimer à partir du :
                    </Text>
                    {futureDates.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          {futureDates.map((d) => {
                            const isSelected = d === selectedFromDate;
                            const label = new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
                            return (
                              <TouchableOpacity
                                key={d}
                                style={[
                                  styles.dateChip,
                                  isSelected && styles.dateChipActive,
                                ]}
                                onPress={() => setSelectedFromDate(d)}
                              >
                                <Text style={[
                                  styles.dateChipText,
                                  isSelected && styles.dateChipTextActive,
                                ]}>
                                  {label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>
                    ) : (
                      <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6 }}>
                        Aucune transaction future trouvée.
                      </Text>
                    )}
                  </View>
                )}

                {/* Action buttons */}
                <View style={{ gap: 8, marginTop: 4 }}>
                  <TouchableOpacity
                    style={[
                      styles.confirmActionBtn,
                      { backgroundColor: deleteMode === 'full' ? COLORS.danger : COLORS.orange },
                      (deleteMode === 'from-date' && !selectedFromDate) && { opacity: 0.5 },
                    ]}
                    onPress={deleteMode === 'full' ? confirmDeleteFull : confirmDeleteFromDate}
                    disabled={
                      deleteFullMutation.isPending ||
                      deleteFromDateMutation.isPending ||
                      (deleteMode === 'from-date' && !selectedFromDate)
                    }
                  >
                    <Ionicons
                      name={deleteMode === 'full' ? 'trash' : 'cut'}
                      size={16}
                      color="#fff"
                    />
                    <Text style={styles.confirmActionBtnText}>
                      {deleteFullMutation.isPending || deleteFromDateMutation.isPending
                        ? 'Traitement...'
                        : deleteMode === 'full'
                          ? 'Tout supprimer'
                          : 'Supprimer à partir de cette date'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.confirmCancelBtn, { borderColor: COLORS.border }]}
                    onPress={resetDeleteState}
                  >
                    <Text style={[styles.confirmCancelBtnText, { color: COLORS.textSecondary }]}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* Simple mode : no past transactions */
              <>
                <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
                  Ce projet et toutes ses transactions seront supprimés définitivement.
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={[styles.confirmCancelBtn, { borderColor: COLORS.border }]}
                    onPress={resetDeleteState}
                  >
                    <Text style={[styles.confirmCancelBtnText, { color: COLORS.textSecondary }]}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmActionBtn, { backgroundColor: COLORS.danger }]}
                    onPress={confirmDeleteFull}
                    disabled={deleteFullMutation.isPending}
                  >
                    <Ionicons name="trash" size={16} color="#fff" />
                    <Text style={styles.confirmActionBtnText}>
                      {deleteFullMutation.isPending ? 'Suppression...' : 'Supprimer'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      {/* Archive Confirmation Modal */}
      {archiveConfirmId && (
        <View style={styles.confirmDialogOverlay}>
          <View style={styles.confirmDialog}>
            <Text style={[styles.confirmTitle, { color: COLORS.text }]}>
              <Ionicons name="archive" size={18} color="#f59e0b" />{'  '}Archiver le projet
            </Text>
            <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
              Les transactions passées sont <Text style={{ fontWeight: '700', color: COLORS.text }}>conservées</Text>.{'\n'}
              {archiveFutureCount} versement{archiveFutureCount > 1 ? 's' : ''} futur{archiveFutureCount > 1 ? 's' : ''} sera{archiveFutureCount > 1 ? 'ont' : ''} <Text style={{ fontWeight: '700', color: COLORS.text }}>supprimé{archiveFutureCount > 1 ? 's' : ''}</Text> (plus de versement après l'archivage).
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmCancelBtn, { borderColor: COLORS.border }]}
                onPress={() => setArchiveConfirmId(null)}
              >
                <Text style={[styles.confirmCancelBtnText, { color: COLORS.textSecondary }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmActionBtn, { backgroundColor: COLORS.orange }]}
                onPress={() => doArchive(archiveConfirmId)}
                disabled={archiveMutation.isPending}
              >
                <Ionicons name="archive" size={16} color="#fff" />
                <Text style={styles.confirmActionBtnText}>
                  {archiveMutation.isPending ? 'Archivage...' : 'Archiver'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <CalculatorButton page="projets" />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, width: '100%' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.primary + '15',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.primary + '44',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 14, fontWeight: '700', color: c.primary },
  rwSectionLabel: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6, marginBottom: 8 },
  // Échec de lecture des invitations : une absence de données ne doit pas ressembler à une erreur.
  rwInvError: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', borderRadius: 12, padding: 11, marginBottom: 10 },
  rwInvErrorText: { flex: 1, fontSize: 12.5, color: c.danger, lineHeight: 17 },
  rwInvCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.primary + '55', borderRadius: 14, padding: 12, marginBottom: 8 },
  rwInvDecline: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger + '1A' },
  rwInvAccept: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary },
  rwProjCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.blue + '44', borderRadius: 14, padding: 14, marginBottom: 8 },
  rwProjName: { fontSize: 15, fontWeight: '700', color: c.text },
  rwProjSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  rwAvatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: c.card },
  rwAvatarText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  rwContribBar: { flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 7, backgroundColor: c.cardBorder },
  rwModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
  rwChoiceCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12 },
  rwModalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  rwChoiceOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
  rwChoiceIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rwChoiceTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  rwChoiceSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  rwCreateCard: { width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20 },
  rwCreateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  rwLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6 },
  rwCurrencyHint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16, marginTop: 8, marginBottom: 10 },
  rwInput: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 14, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  rwEmojiPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
  rwCreateCta: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  rwCreateCtaText: { fontSize: 15, fontWeight: '800', color: c.onAccent },
  archiveToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  archiveToggleBtnLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  archiveTitle: { fontSize: 14, fontWeight: '700', color: c.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  projectCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  projectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  projectInfo: {
    flex: 1,
    marginRight: 12,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  projectDescription: {
    fontSize: 12,
  },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1,
  },
  modeBadgeText: { fontSize: 10, fontWeight: '700' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  projectDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailLabel: {
    fontSize: 11,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(52, 211, 153, 0.2)',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressPercentage: {
    fontSize: 16,
    fontWeight: '700',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
    borderWidth: 1,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressAmount: {
    fontSize: 11,
    textAlign: 'right',
  },
  completeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.green + '15',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#10b98130',
  },
  completeBannerText: {
    color: c.green,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  projectActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    minWidth: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
  },
  emptyStateSubtext: {
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  confirmDialogOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  confirmDialog: {
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    padding: 20,
    width: '88%',
    maxWidth: 380,
    gap: 12,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  confirmMessage: {
    fontSize: 13,
    lineHeight: 19,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  /* Radio options for delete mode */
  deleteOption: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.border,
    padding: 12,
  },
  deleteOptionActive: {
    borderColor: c.primary,
    backgroundColor: c.primary + '08',
  },
  deleteOptionRadio: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  deleteOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  deleteOptionDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
  /* Date picker chips */
  datePickerSection: {
    paddingTop: 4,
  },
  datePickerLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.background,
  },
  dateChipActive: {
    borderColor: c.orange,
    backgroundColor: c.orange + '20',
  },
  dateChipText: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  dateChipTextActive: {
    color: c.orange,
    fontWeight: '600',
  },
  /* Action buttons in confirm dialog */
  confirmActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmActionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmCancelBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  confirmCancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoBtn: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.primary + '15', borderWidth: 1, borderColor: c.primary + '44',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  infoModalCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 22, borderWidth: 1, borderColor: c.cardBorder, padding: 24, alignItems: 'center' },
  infoModalIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: 14 },
  infoModalTitle: { fontSize: 19, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 10 },
  infoModalText: { fontSize: 14, lineHeight: 21, color: c.textSecondary, textAlign: 'center', marginBottom: 20 },
  infoModalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, width: '100%' },
  infoModalBtnText: { fontSize: 15, fontWeight: '700', color: c.onAccent },
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 12,
  },
  archivedToggleActive: {
    borderColor: c.primary,
    backgroundColor: c.primary + '10',
  },
});
}

/* OUVERTURE INSTANTANÉE : la page s'affiche en silhouette le temps que son corps (hooks,
   calculs, listes) se monte — sinon le tap reste sans effet visible pendant tout le montage.
   Cf. hooks/useDeferredMount. */
export default withDeferredMount(ProjectsScreen);
