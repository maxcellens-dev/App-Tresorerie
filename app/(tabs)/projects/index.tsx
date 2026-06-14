import React, { useState, useEffect, useRef } from 'react';
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
import ScreenGradient from '../../components/ScreenGradient';
import OnboardingHintBanner from '../../components/OnboardingHintBanner';
import AdSlot from '../../components/AdSlot';
import { useOnbHighlight, onbGlow } from '../../lib/onbHighlight';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';
import { tabRect } from '../../lib/tourTargets';
import { useAuth } from '../../contexts/AuthContext';
import {
  useProjects,
  useDeleteProjectFull,
  useArchiveProject,
  useCheckProjectTransactions,
  useDeleteProjectFromDate,
} from '../../hooks/useProjects';
import { usePilotageData } from '../../hooks/usePilotageData';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';


export default function ProjectsScreen() {
  const COLORS = useAppColors();
  const onbProject = useOnbHighlight('project');
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const guide = useScreenGuide('projets', user?.id);
  const addBtnRef = useRef<any>(null);
  const PROJETS_GUIDE: BubbleStep[] = [
    { getRect: () => tabRect(4), icon: 'flag', iconColor: COLORS.primary, title: 'Onglet Projets', description: 'Touchez « Projets » pour gérer vos projets d\'épargne (voiture, voyage…).' },
    { getRef: () => addBtnRef, icon: 'add-circle', iconColor: COLORS.primary, title: 'Créer un projet', description: 'Appuyez sur « + Projet » pour définir un objectif et son rythme d\'épargne.' },
  ];

  const [refreshing, setRefreshing] = useState(false);
  const projectsQuery = useProjects(user?.id || '');
  const { data: projects = [], isLoading, refetch } = projectsQuery;
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
    if (!deleteConfirmId) return;
    deleteFullMutation.mutate(deleteConfirmId, {
      onSuccess: () => { resetDeleteState(); refetch(); },
      onError: () => resetDeleteState(),
    });
  };

  const confirmDeleteFromDate = () => {
    if (!deleteConfirmId || !selectedFromDate) return;
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
    const pm = progressMap[project.id];
    const currentAccumulated = pm ? pm.accumulated : parseFloat(project.current_accumulated || '0');
    const progress = pm ? Math.min(100, Math.round(pm.percentage)) : (targetAmount > 0 ? Math.min(100, Math.round((currentAccumulated / targetAmount) * 100)) : 0);
    // Objectif atteint dès qu'il reste moins d'1 centime (évite le blocage à 999,99 / 1000).
    const isComplete = progress >= 100 || (targetAmount > 0 && targetAmount - currentAccumulated < 0.01);
    // À l'affichage, on cale le cumul sur la cible quand l'objectif est atteint (pas de « 999,99 »).
    const displayAccumulated = isComplete ? targetAmount : currentAccumulated;

    const monthsToComplete = (() => {
      if (project.target_date && (project.allocation_type === 'date' || !project.allocation_type)) {
        const now = new Date();
        const paymentDay = project.transaction_day ?? now.getDate();
        const cursor = new Date(now.getFullYear(), now.getMonth(), paymentDay);
        if (cursor <= now) cursor.setMonth(cursor.getMonth() + 1);
        const endLimit = new Date(project.target_date + 'T23:59:59');
        let count = 0;
        const c = new Date(cursor);
        while (c <= endLimit) { count++; c.setMonth(c.getMonth() + 1); }
        return count;
      }
      return monthlyAllocation > 0 ? Math.ceil((targetAmount - currentAccumulated) / monthlyAllocation) : 0;
    })();

    const statusColors: Record<string, string> = {
      active: COLORS.primary,
      on_hold: COLORS.textSecondary,
      completed: '#10b981',
      archived: '#f59e0b',
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
            <Text style={[styles.projectName, { color: COLORS.text }]} numberOfLines={1}>
              {project.name}
            </Text>
            <Text style={[styles.projectDescription, { color: COLORS.textSecondary }]}>
              {project.description || 'Pas de description'}
            </Text>
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
                Cible
              </Text>
              <Text style={[styles.detailValue, { color: COLORS.text }]}>
                {CURRENCY_SYMBOL}{targetAmount.toFixed(2)}
              </Text>
            </View>
            {project.allocation_type === 'ponctuel' ? (
              <View>
                <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                  Restant à verser
                </Text>
                <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                  {CURRENCY_SYMBOL}{Math.max(0, targetAmount - currentAccumulated).toFixed(2)}
                </Text>
              </View>
            ) : (
              <>
                <View>
                  <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                    Allocation mensuelle
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
                Avancement
              </Text>
              <Text style={[styles.progressPercentage, { color: isComplete ? '#10b981' : COLORS.primary }]}>
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
                    backgroundColor: isComplete ? '#10b981' : COLORS.primary,
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
              Objectif atteint ! Vous pouvez archiver ce projet.
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
              style={[styles.actionButton, { backgroundColor: '#f59e0b20' }]}
              onPress={() => handleArchiveClick(project.id)}
              disabled={archiveMutation.isPending}
            >
              <Ionicons name="archive" size={16} color="#f59e0b" />
              <Text style={[styles.actionButtonText, { color: '#f59e0b' }]}>
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
        Créez un projet pour suivre vos objectifs
      </Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: COLORS.background }]}>
      <StatusBar style="light" />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            ref={addBtnRef}
            style={[styles.addBtn, onbGlow(COLORS, onbProject)]}
            activeOpacity={0.8}
            onPress={() => router.push('/(tabs)/projects/add' as any)}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={20} color={COLORS.primary} />
            <Text style={[styles.addBtnLabel, { color: COLORS.primary }]}>Projet</Text>
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
                <View style={styles.infoCard}>
                  <Ionicons name="bulb-outline" size={18} color={COLORS.primary} style={{ marginTop: 1 }} />
                  <Text style={styles.infoText}>
                    Un projet, c'est une cagnotte pour un objectif (voiture, voyage…). Accumulez de l'argent par des virements vers un compte dédié, ou en <Text style={{ fontWeight: '700', color: COLORS.text }}>réservant</Text> la somme sur place. Choisissez un montant <Text style={{ fontWeight: '700', color: COLORS.text }}>mensuel</Text>, une <Text style={{ fontWeight: '700', color: COLORS.text }}>date cible</Text>, ou des versements <Text style={{ fontWeight: '700', color: COLORS.text }}>ponctuels</Text>.
                  </Text>
                </View>
              ) : (
                <Text style={styles.archiveTitle}>Projets archivés</Text>
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

      <GuideOverlay
        visible={guide.visible}
        steps={PROJETS_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(PROJETS_GUIDE.length)}
        onSkip={guide.skip}
        screenTitle="Projets"
      />

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
                  Ce projet a des transactions passées. Choisissez comment procéder :
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
                      deleteMode === 'from-date' && { borderColor: '#f59e0b' },
                    ]}>
                      {deleteMode === 'from-date' && <View style={[styles.radioInner, { backgroundColor: '#f59e0b' }]} />}
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
                style={[styles.confirmActionBtn, { backgroundColor: '#f59e0b' }]}
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
    backgroundColor: '#10b98115',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#10b98130',
  },
  completeBannerText: {
    color: '#10b981',
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
    borderColor: '#f59e0b',
    backgroundColor: '#f59e0b20',
  },
  dateChipText: {
    color: c.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  dateChipTextActive: {
    color: '#f59e0b',
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
  infoCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.primary + '40',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  infoText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: c.textSecondary },
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
