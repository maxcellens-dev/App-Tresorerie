import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import {
  useProjects,
  useDeleteProjectFull,
  useArchiveProject,
  useCheckProjectTransactions,
  useDeleteProjectFromDate,
  useAutoArchiveProjects,
} from '../../hooks/useProjects';
import AddProjectModal from '../../components/AddProjectModal';
import { usePilotageData } from '../../hooks/usePilotageData';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#22d3ee',
  border: '#1e293b',
  background: '#020617',
};

export default function ProjectsScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const projectsQuery = useProjects(user?.id || '');
  const { data: projects = [], isLoading, refetch } = projectsQuery;
  const deleteFullMutation = useDeleteProjectFull(user?.id || '');
  const archiveMutation = useArchiveProject(user?.id || '');
  const deleteFromDateMutation = useDeleteProjectFromDate(user?.id || '');
  const autoArchiveMutation = useAutoArchiveProjects(user?.id || '');
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

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'full' | 'from-date'>('full');
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const [futureDates, setFutureDates] = useState<string[]>([]);
  const [selectedFromDate, setSelectedFromDate] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);

  // Auto-archive projects at 100% after 1 day
  useEffect(() => {
    if (projects.length > 0 && !autoArchiveMutation.isPending) {
      autoArchiveMutation.mutate(projects);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length]);

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

  const handleManualArchive = (projectId: string) => {
    archiveMutation.mutate(projectId, {
      onSuccess: () => refetch(),
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
    const isComplete = progress >= 100;

    const monthsToComplete =
      monthlyAllocation > 0 ? Math.ceil((targetAmount - currentAccumulated) / monthlyAllocation) : 0;

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
                €{targetAmount.toFixed(2)}
              </Text>
            </View>
            <View>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                Allocation mensuelle
              </Text>
              <Text style={[styles.detailValue, { color: COLORS.primary }]}>
                €{monthlyAllocation.toFixed(2)}/mois
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
              €{currentAccumulated.toFixed(2)} / €{targetAmount.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Complete badge */}
        {isComplete && project.status !== 'archived' && (
          <View style={styles.completeBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            <Text style={styles.completeBannerText}>
              Objectif atteint ! Archivage automatique sous 24h.
            </Text>
          </View>
        )}

        <View style={styles.projectActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: COLORS.primary + '20' }]}
            onPress={() => {
              setEditingId(project.id);
              setModalVisible(true);
            }}
          >
            <Ionicons name="pencil" size={16} color={COLORS.primary} />
            <Text style={[styles.actionButtonText, { color: COLORS.primary }]}>
              Modifier
            </Text>
          </TouchableOpacity>

          {/* Bouton Archiver : visible si 100% atteint et pas encore archivé */}
          {isComplete && project.status !== 'archived' && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#f59e0b20' }]}
              onPress={() => handleManualArchive(project.id)}
              disabled={archiveMutation.isPending}
            >
              <Ionicons name="archive" size={16} color="#f59e0b" />
              <Text style={[styles.actionButtonText, { color: '#f59e0b' }]}>
                {archiveMutation.isPending ? 'Archivage...' : 'Archiver'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#ef444420' }]}
            onPress={() => handleDelete(project.id)}
          >
            <Ionicons name="trash" size={16} color="#ef4444" />
            <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>Supprimer</Text>
          </TouchableOpacity>
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
    <>
      <Stack.Screen
        options={{
          title: 'Projets',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => {
                setEditingId(null);
                setModalVisible(true);
              }}
              style={{
                marginRight: 16,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: COLORS.primary + '18',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: COLORS.primary + '40',
              }}
            >
              <Ionicons name="add" size={18} color={COLORS.primary} />
              <Text style={{ color: COLORS.primary, fontWeight: '600', fontSize: 13, marginLeft: 4 }}>Ajouter</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <View style={[styles.container, { backgroundColor: COLORS.background }]}>
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
              <TouchableOpacity
                style={[styles.archivedToggle, showArchived && styles.archivedToggleActive]}
                onPress={() => setShowArchived(!showArchived)}
              >
                <Ionicons name={showArchived ? 'folder-open-outline' : 'archive-outline'} size={16} color={showArchived ? COLORS.primary : COLORS.textSecondary} />
                <Text style={{ color: showArchived ? COLORS.primary : COLORS.textSecondary, fontSize: 13, fontWeight: '600' }}>
                  {showArchived ? 'Voir projets actifs' : 'Voir projets archivés'}
                </Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={renderEmptyState}
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
      </View>

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <View style={styles.confirmDialogOverlay}>
          <View style={styles.confirmDialog}>
            <Text style={[styles.confirmTitle, { color: COLORS.text }]}>
              <Ionicons name="warning" size={18} color="#ef4444" />{'  '}Supprimer le projet
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
                      deleteMode === 'full' && { borderColor: '#ef4444' },
                    ]}>
                      {deleteMode === 'full' && <View style={[styles.radioInner, { backgroundColor: '#ef4444' }]} />}
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
                      { backgroundColor: deleteMode === 'full' ? '#ef4444' : '#f59e0b' },
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
                    style={[styles.confirmActionBtn, { backgroundColor: '#ef4444' }]}
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

      <AddProjectModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditingId(null);
        }}
        onSuccess={() => refetch()}
        editingProject={editingId ? projects.find(p => p.id === editingId) || null : null}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    borderColor: COLORS.border,
    padding: 12,
  },
  deleteOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '08',
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
    borderColor: COLORS.border,
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
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  dateChipActive: {
    borderColor: '#f59e0b',
    backgroundColor: '#f59e0b20',
  },
  dateChipText: {
    color: COLORS.textSecondary,
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
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  archivedToggleActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
});
