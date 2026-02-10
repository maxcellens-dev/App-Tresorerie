import React, { useState, useMemo } from 'react';
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
import {
  useObjectives,
  useDeleteObjective,
  useUpdateObjective,
} from '../../hooks/useObjectives';
import { useAccounts } from '../../hooks/useAccounts';
import { useAccountTransactionsByYear, calculateYearlyTotal } from '../../hooks/useAccountTransactionsByYear';
import AddObjectiveModal from '../../components/AddObjectiveModal';
import { usePilotageData } from '../../hooks/usePilotageData';
import { accountColor } from '../../theme/colors';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

export default function ObjectivesScreen() {
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const objectivesQuery = useObjectives(user?.id || '');
  const { data: objectives = [], isLoading, refetch } = objectivesQuery;
  const { data: accounts = [] } = useAccounts(user?.id || '');
  const { data: pilotage } = usePilotageData(user?.id);
  const deleteObjectiveMutation = useDeleteObjective(user?.id || '');
  const updateObjectiveMutation = useUpdateObjective(user?.id || '');

  const savingsAdvice = useMemo(() => {
    if (!pilotage) return null;
    const { current_savings, safety_threshold_min, safety_threshold_optimal, safety_threshold_comfort } = pilotage;
    if (current_savings < safety_threshold_min) {
      return {
        icon: 'warning' as const,
        color: '#ef4444',
        title: 'Épargne critique',
        message: `Votre épargne (${current_savings.toFixed(0)} €) est en dessous du seuil minimum (${safety_threshold_min.toFixed(0)} €). Concentrez-vous sur la reconstitution de votre épargne de précaution avant de poursuivre vos objectifs.`,
      };
    }
    if (current_savings < safety_threshold_optimal) {
      return {
        icon: 'alert-circle' as const,
        color: '#f59e0b',
        title: 'Épargne à renforcer',
        message: `Votre épargne (${current_savings.toFixed(0)} €) n'a pas encore atteint le seuil optimal (${safety_threshold_optimal.toFixed(0)} €). Continuez à épargner et ajustez vos objectifs d'investissement en conséquence.`,
      };
    }
    if (current_savings < safety_threshold_comfort) {
      return {
        icon: 'checkmark-circle' as const,
        color: '#a78bfa',
        title: 'Bonne dynamique',
        message: `Votre épargne (${current_savings.toFixed(0)} €) dépasse le seuil optimal. Vous pouvez avancer sereinement sur vos objectifs tout en visant le seuil de confort (${safety_threshold_comfort.toFixed(0)} €).`,
      };
    }
    return {
      icon: 'shield-checkmark' as const,
      color: '#34d399',
      title: 'Situation confortable',
      message: `Votre épargne (${current_savings.toFixed(0)} €) dépasse le seuil de confort. Vous êtes en excellente position pour investir et atteindre vos objectifs financiers.`,
    };
  }, [pilotage]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await objectivesQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    deleteObjectiveMutation.mutate(deleteConfirmId, {
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

  const handleToggleStatus = (objective: any) => {
    const newStatus =
      objective.status === 'completed'
        ? 'active'
        : objective.status === 'active'
          ? 'paused'
          : 'completed';

    updateObjectiveMutation.mutate(
      { ...objective, status: newStatus },
      {
        onSuccess: () => refetch(),
      }
    );
  };

  const getAccountName = (accountId: string | null) => {
    if (!accountId) return 'N/A';
    const account = accounts.find((acc) => acc.id === accountId);
    return account?.name || 'Compte inconnu';
  };

  const renderObjectiveItem = ({ item: objective }: { item: any }) => {
    return <ObjectiveItemRenderer objective={objective} />;
  };

  // Extract ObjectiveItemRenderer to a separate function that can use hooks
  // This is rendered inside FlatList which handles the key prop
  
  const ObjectiveItemRenderer = ({ objective }: { objective: any }) => {
    const currentYear = new Date().getFullYear();
    const { data: transactions = [] } = useAccountTransactionsByYear(
      objective.linked_account_id,
      currentYear
    );

    const targetAmount = parseFloat(objective.target_yearly_amount);
    
    let currentAmount = 0;
    if (objective.category === 'Objectif annuel' && objective.linked_account_id) {
      currentAmount = calculateYearlyTotal(transactions);
    } else {
      currentAmount = objective.current_year_invested || 0;
    }
    
    const progress = targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : 0;

    const accountName = getAccountName(objective.linked_account_id);
    const acctType = accounts.find(a => a.id === objective.linked_account_id)?.type ?? 'savings';
    const accentColor = accountColor(acctType);

    const statusColors: Record<string, string> = {
      active: accentColor,
      paused: COLORS.textSecondary,
      completed: '#10b981',
    };

    const statusLabels = {
      active: 'Actif',
      paused: 'En pause',
      completed: 'Complété',
    } as const;

    return (
      <View
        style={[
          styles.objectiveCard,
          {
            backgroundColor: COLORS.surface,
            borderColor: COLORS.border,
          },
        ]}
      >
        <View style={styles.objectiveHeader}>
          <View style={styles.objectiveInfo}>
            <Text
              style={[styles.objectiveName, { color: COLORS.text }]}
              numberOfLines={1}
            >
              {objective.name}
            </Text>
            <Text style={[styles.objectiveDescription, { color: COLORS.textSecondary }]}>
              {objective.description || 'Pas de description'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.statusBadge,
              { backgroundColor: statusColors[objective.status as keyof typeof statusColors] + '20' },
            ]}
            onPress={() => handleToggleStatus(objective)}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusColors[objective.status as keyof typeof statusColors] },
              ]}
            >
              {statusLabels[objective.status as keyof typeof statusLabels]}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.objectiveDetails}>
          <View style={styles.detailRow}>
            <View>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                Cible annuelle
              </Text>
              <Text style={[styles.detailValue, { color: COLORS.text }]}>
                €{targetAmount.toFixed(2)}
              </Text>
            </View>
            <View>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                Mensuel
              </Text>
              <Text style={[styles.detailValue, { color: COLORS.text }]}>
                €{(targetAmount / 12).toFixed(2)}
              </Text>
            </View>
            <View>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                Compte lié
              </Text>
              <Text
                style={[styles.detailValue, { color: accentColor }]}
                numberOfLines={1}
              >
                {accountName}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressSection}>
            <View style={styles.progressHeader}>
              <Text style={[styles.detailLabel, { color: COLORS.textSecondary }]}>
                Avancement
              </Text>
              <Text style={[styles.progressPercentage, { color: accentColor }]}>
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
                  { width: `${progress}%`, backgroundColor: accentColor },
                ]}
              />
            </View>
            <Text style={[styles.progressAmount, { color: COLORS.textSecondary }]}>
              €{currentAmount.toFixed(2)} / €{targetAmount.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={styles.objectiveActions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: accentColor + '20' }]}
            onPress={() => {
              setEditingId(objective.id);
              setModalVisible(true);
            }}
          >
            <Ionicons name="pencil" size={16} color={accentColor} />
            <Text style={[styles.actionButtonText, { color: accentColor }]}>
              Modifier
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#ef4444' + '20' }]}
            onPress={() => {
              console.log('[DeleteButton] onPress triggered for objective:', objective.id);
              handleDelete(objective.id);
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
      <Ionicons name="bookmark" size={48} color={COLORS.textSecondary} />
      <Text style={[styles.emptyStateText, { color: COLORS.textSecondary }]}>
        Aucun objectif
      </Text>
      <Text style={[styles.emptyStateSubtext, { color: COLORS.textSecondary }]}>
        Créez un objectif pour suivre vos investissements
      </Text>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Objectifs',
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
            data={objectives.filter((obj) => obj.status !== 'completed')}
            keyExtractor={(item) => item.id}
            renderItem={renderObjectiveItem}
            ListHeaderComponent={savingsAdvice ? (
              <View style={[styles.adviceCard, { borderLeftColor: savingsAdvice.color }]}>
                <View style={styles.adviceHeader}>
                  <Ionicons name={savingsAdvice.icon} size={22} color={savingsAdvice.color} />
                  <Text style={[styles.adviceTitle, { color: savingsAdvice.color }]}>
                    {savingsAdvice.title}
                  </Text>
                </View>
                <Text style={styles.adviceMessage}>{savingsAdvice.message}</Text>
              </View>
            ) : null}
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
            <Text style={[styles.confirmTitle, { color: COLORS.text }]}>Supprimer l'objectif</Text>
            <Text style={[styles.confirmMessage, { color: COLORS.textSecondary }]}>
              Êtes-vous sûr de vouloir supprimer cet objectif ?
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
                disabled={deleteObjectiveMutation.isPending}
              >
                <Text style={[styles.confirmButtonText, { color: '#fff' }]}>
                  {deleteObjectiveMutation.isPending ? 'Suppression...' : 'Supprimer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <AddObjectiveModal
        visible={modalVisible}
        onClose={() => {
          setModalVisible(false);
          setEditingId(null);
        }}
        onSuccess={() => refetch()}
        editingObjective={editingId ? objectives.find(o => o.id === editingId) || null : null}
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
  adviceCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    padding: 16,
    marginBottom: 16,
    gap: 8,
  },
  adviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adviceTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  adviceMessage: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  objectiveCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  objectiveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  objectiveInfo: {
    flex: 1,
    marginRight: 12,
  },
  objectiveName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  objectiveDescription: {
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
  objectiveDetails: {
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
  objectiveActions: {
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
});
