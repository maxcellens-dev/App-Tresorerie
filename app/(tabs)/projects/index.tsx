import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProjects, useDeleteProject, useDeleteProjectFull, useArchiveProject, useUpdateProject, useCheckProjectTransactions } from '../../hooks/useProjects';
import AddProjectModal from '../../components/AddProjectModal';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

export default function ProjectsScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const projectsQuery = useProjects(user?.id || '');
  const { data: projects = [], isLoading, refetch } = projectsQuery;
  const deleteProjectMutation = useDeleteProject(user?.id || '');
  const deleteFullMutation = useDeleteProjectFull(user?.id || '');
  const archiveMutation = useArchiveProject(user?.id || '');
  const updateProjectMutation = useUpdateProject(user?.id || '');
  const { check: checkTransactions } = useCheckProjectTransactions(user?.id || '');

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'simple' | 'choose'>('simple');
  const [hasPastTxns, setHasPastTxns] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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
      if (past.length > 0) {
        setDeleteMode('choose');
        setHasPastTxns(true);
      } else {
        setDeleteMode('simple');
        setHasPastTxns(false);
      }
    } catch {
      setDeleteConfirmId(id);
      setDeleteMode('simple');
      setHasPastTxns(false);
    }
  };

  const confirmDeleteFull = () => {
    if (!deleteConfirmId) return;
    Alert.alert(
      'Attention',
      'Toutes les transactions passées et futures liées à ce projet seront supprimées. Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Tout supprimer',
          style: 'destructive',
          onPress: () => {
            deleteFullMutation.mutate(deleteConfirmId, {
              onSuccess: () => { setDeleteConfirmId(null); refetch(); },
              onError: () => setDeleteConfirmId(null),
            });
          },
        },
      ]
    );
  };

  const confirmArchive = () => {
    if (!deleteConfirmId) return;
    archiveMutation.mutate(deleteConfirmId, {
      onSuccess: () => { setDeleteConfirmId(null); refetch(); },
      onError: () => setDeleteConfirmId(null),
    });
  };

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    deleteFullMutation.mutate(deleteConfirmId, {
      onSuccess: () => {
        setDeleteConfirmId(null);
        refetch();
      },
      onError: () => {
        setDeleteConfirmId(null);
      },
    });
  };

  const cancelDelete = () => {
    setDeleteConfirmId(null);
  };

  const handleToggleStatus = (project: any) => {
    const newStatus =
      project.status === 'completed'
        ? 'active'
        : project.status === 'active'
          ? 'on_hold'
          : 'completed';

    updateProjectMutation.mutate(
      { ...project, status: newStatus },
      {
        onSuccess: () => refetch(),
      }
    );
  };

  const renderProjectItem = ({ item: project }: { item: any }) => {
    const targetAmount = parseFloat(project.target_amount);
    const monthlyAllocation = parseFloat(project.monthly_allocation);
    const currentAccumulated = parseFloat(project.current_accumulated || '0');
    const progress = targetAmount > 0 ? Math.min(100, Math.round((currentAccumulated / targetAmount) * 100)) : 0;

    // Calculate months to complete (simplified - assumes linear progress)
    const monthsToComplete =
      monthlyAllocation > 0 ? Math.ceil(targetAmount / monthlyAllocation) : 0;

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
          <TouchableOpacity
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[project.status as keyof typeof statusColors] + '20' },
            ]}
            onPress={() => handleToggleStatus(project)}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusColors[project.status as keyof typeof statusColors] },
              ]}
            >
              {statusLabels[project.status as keyof typeof statusLabels]}
            </Text>
          </TouchableOpacity>
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
            {monthsToComplete > 0 && (
              <View>
                <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                  Durée estimée
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
              <Text style={[styles.progressPercentage, { color: COLORS.primary }]}>
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
                  { width: `${progress}%`, backgroundColor: COLORS.primary },
                ]}
              />
            </View>
            <Text style={[styles.progressAmount, { color: COLORS.textSecondary }]}>
              €{currentAccumulated.toFixed(2)} / €{targetAmount.toFixed(2)}
            </Text>
          </View>
        </View>

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
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#ef4444' + '20' }]}
            onPress={() => {
              console.log('[DeleteButton] onPress triggered for project:', project.id);
              handleDelete(project.id);
            }}
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
              style={{ marginRight: 16 }}
            >
              <Ionicons name="add-circle" size={24} color={COLORS.primary} />
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
            <Text style={[styles.confirmTitle, { color: COLORS.text }]}>Supprimer le projet</Text>
            {deleteMode === 'choose' ? (
              <>
                <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
                  Ce projet a des transactions passées. Que souhaitez-vous faire ?
                </Text>
                <View style={{ gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.confirmButtonDelete, { backgroundColor: '#ef4444' }]}
                    onPress={confirmDeleteFull}
                    disabled={deleteFullMutation.isPending || archiveMutation.isPending}
                  >
                    <Text style={[styles.confirmButtonText, { color: '#fff' }]}>
                      Tout supprimer
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center' }}>
                      Supprime le projet et toutes les transactions
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButtonDelete, { backgroundColor: '#f59e0b' }]}
                    onPress={confirmArchive}
                    disabled={deleteFullMutation.isPending || archiveMutation.isPending}
                  >
                    <Text style={[styles.confirmButtonText, { color: '#fff' }]}>
                      {archiveMutation.isPending ? 'Archivage...' : 'Archiver'}
                    </Text>
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, textAlign: 'center' }}>
                      Conserve les transactions passées, supprime les futures
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButtonCancel, { borderColor: COLORS.border }]}
                    onPress={cancelDelete}
                  >
                    <Text style={[styles.confirmButtonText, { color: COLORS.textSecondary }]}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
                  Ce projet et toutes ses transactions seront supprimés.
                </Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={[styles.confirmButtonCancel, { borderColor: COLORS.border }]}
                    onPress={cancelDelete}
                  >
                    <Text style={[styles.confirmButtonText, { color: COLORS.textSecondary }]}>
                      Annuler
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmButtonDelete, { backgroundColor: '#ef4444' }]}
                    onPress={confirmDelete}
                    disabled={deleteFullMutation.isPending}
                  >
                    <Text style={[styles.confirmButtonText, { color: '#fff' }]}>
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
  projectActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  actionButton: {
    flex: 1,
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
    padding: 24,
    width: '80%',
    maxWidth: 320,
    gap: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  confirmButtonCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  confirmButtonDelete: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
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
