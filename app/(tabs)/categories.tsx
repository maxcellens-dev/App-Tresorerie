import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import {
  useCategories,
  useAddCategory,
  useSeedDefaultCategories,
  useUpdateCategory,
  useDeleteCategory,
} from '../hooks/useCategories';
import type { Category } from '../types/database';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#ef4444',
};

function groupCategories(categories: Category[]) {
  const parents = categories.filter((c) => !c.parent_id);
  const byParent: Record<string, Category[]> = {};
  for (const c of categories) {
    if (c.parent_id) {
      byParent[c.parent_id] = byParent[c.parent_id] ?? [];
      byParent[c.parent_id].push(c);
    }
  }
  return { parents, byParent };
}

export default function CategoriesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  
  const categoriesQuery = useCategories(user?.id);
  const { data: categories = [], isLoading } = categoriesQuery;
  const seedDefaults = useSeedDefaultCategories(user?.id);
  const addCategory = useAddCategory(user?.id);
  const updateCategory = useUpdateCategory(user?.id);
  const deleteCategory = useDeleteCategory(user?.id);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'income' | 'expense'>('expense');
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ id: string; name: string } | null>(null);
  const [editName, setEditName] = useState('');
  const hasSeeded = useRef(false);

  useEffect(() => {
    if (!user?.id || categories.length > 0 || hasSeeded.current || isLoading) return;
    hasSeeded.current = true;
    seedDefaults.mutate();
  }, [user?.id, categories.length, isLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await categoriesQuery.refetch?.();
    } finally {
      setRefreshing(false);
    }
  };

  async function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', 'Saisissez un nom de catégorie.');
      return;
    }
    try {
      await addCategory.mutateAsync({ name: trimmed, type: newType, parent_id: newParentId });
      setNewName('');
      setNewParentId(null);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d’ajouter.');
    }
  }

  function openEdit(c: Category) {
    setEditModal({ id: c.id, name: c.name });
    setEditName(c.name);
  }

  async function handleSaveEdit() {
    if (!editModal || !editName.trim()) return;
    try {
      await updateCategory.mutateAsync({ id: editModal.id, name: editName.trim() });
      setEditModal(null);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de modifier.');
    }
  }

  function handleDelete(c: Category) {
    const message = `Supprimer « ${c.name} » ? Les transactions liées ne seront plus catégorisées.`;
    const doDelete = () => {
      deleteCategory.mutateAsync(c.id).catch((e: unknown) => {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer.');
      });
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`Supprimer\n\n${message}`)) doDelete();
      return;
    }
    Alert.alert('Supprimer', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: doDelete },
    ]);
  }

  const income = categories.filter((c) => c.type === 'income');
  const expense = categories.filter((c) => c.type === 'expense');
  const incomeGrouped = groupCategories(income);
  const expenseGrouped = groupCategories(expense);

  const parentOptions = categories.filter((c) => c.type === newType && !c.parent_id);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <Text style={styles.subtitle}>
          Recettes et dépenses par défaut. Modifiez, ajoutez ou supprimez des postes.
        </Text>

        {!user ? (
          <Text style={styles.hint}>Connectez-vous pour gérer vos catégories.</Text>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#34d399"
                progressBackgroundColor="#0f172a"
              />
            }
          >
            {categories.length === 0 && !isLoading && (
              <TouchableOpacity
                style={styles.seedBtn}
                onPress={() => seedDefaults.mutate()}
                disabled={seedDefaults.isPending}
              >
                {seedDefaults.isPending ? (
                  <ActivityIndicator color={COLORS.bg} size="small" />
                ) : (
                  <Text style={styles.seedBtnLabel}>Charger les catégories par défaut</Text>
                )}
              </TouchableOpacity>
            )}

            <View style={styles.addCard}>
              <Text style={styles.label}>Nouvelle catégorie</Text>
              <View style={styles.toggle}>
                <TouchableOpacity
                  style={[styles.toggleBtn, newType === 'expense' && styles.toggleBtnActive]}
                  onPress={() => setNewType('expense')}
                >
                  <Text style={[styles.toggleLabel, newType === 'expense' && styles.toggleLabelActive]}>Dépense</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, newType === 'income' && styles.toggleBtnActive]}
                  onPress={() => setNewType('income')}
                >
                  <Text style={[styles.toggleLabel, newType === 'income' && styles.toggleLabelActive]}>Recette</Text>
                </TouchableOpacity>
              </View>
              {parentOptions.length > 0 && (
                <>
                  <Text style={styles.label}>Sous-catégorie de (optionnel)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, !newParentId && styles.chipActive]}
                      onPress={() => setNewParentId(null)}
                    >
                      <Text style={[styles.chipText, !newParentId && styles.chipTextActive]}>Aucune</Text>
                    </TouchableOpacity>
                    {parentOptions.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.chip, newParentId === p.id && styles.chipActive]}
                        onPress={() => setNewParentId(p.id)}
                      >
                        <Text style={[styles.chipText, newParentId === p.id && styles.chipTextActive]}>{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="Nom (ex. Salaires, Loyer)"
                placeholderTextColor={COLORS.textSecondary}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              <TouchableOpacity
                style={[styles.addBtn, addCategory.isPending && styles.addBtnDisabled]}
                onPress={handleAdd}
                disabled={addCategory.isPending}
              >
                {addCategory.isPending ? (
                  <ActivityIndicator color={COLORS.bg} size="small" />
                ) : (
                  <Text style={styles.addBtnLabel}>Ajouter</Text>
                )}
              </TouchableOpacity>
            </View>

            {isLoading ? (
              <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
            ) : (
              <>
                <Text style={styles.sectionTitle}>Recettes</Text>
                <View style={styles.card}>
                  {income.length === 0 ? (
                    <Text style={styles.empty}>Aucune catégorie recette.</Text>
                  ) : (
                    incomeGrouped.parents.map((p) => (
                      <View key={p.id}>
                        <View style={styles.row}>
                          <Text style={styles.rowLabel}>{p.name}</Text>
                          <View style={styles.rowActions}>
                            <TouchableOpacity onPress={() => openEdit(p)} hitSlop={8}>
                              <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={{ marginLeft: 12 }}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {(incomeGrouped.byParent[p.id] ?? []).map((c) => (
                          <View key={c.id} style={[styles.row, styles.rowChild]}>
                            <Text style={styles.rowLabelChild}>{c.name}</Text>
                            <View style={styles.rowActions}>
                              <TouchableOpacity onPress={() => openEdit(c)} hitSlop={8}>
                                <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} style={{ marginLeft: 12 }}>
                                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    ))
                  )}
                </View>
                <Text style={styles.sectionTitle}>Dépenses</Text>
                <View style={styles.card}>
                  {expense.length === 0 ? (
                    <Text style={styles.empty}>Aucune catégorie dépense.</Text>
                  ) : (
                    expenseGrouped.parents.map((p) => (
                      <View key={p.id}>
                        <View style={styles.row}>
                          <Text style={styles.rowLabel}>{p.name}</Text>
                          <View style={styles.rowActions}>
                            <TouchableOpacity onPress={() => openEdit(p)} hitSlop={8}>
                              <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={{ marginLeft: 12 }}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        {(expenseGrouped.byParent[p.id] ?? []).map((c) => (
                          <View key={c.id} style={[styles.row, styles.rowChild]}>
                            <Text style={styles.rowLabelChild}>{c.name}</Text>
                            <View style={styles.rowActions}>
                              <TouchableOpacity onPress={() => openEdit(c)} hitSlop={8}>
                                <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} style={{ marginLeft: 12 }}>
                                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    ))
                  )}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      <Modal visible={!!editModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Modifier la catégorie</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Nom"
              placeholderTextColor={COLORS.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveEdit}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setEditModal(null)}>
                <Text style={styles.modalBtnLabel}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={handleSaveEdit}
                disabled={updateCategory.isPending || !editName.trim()}
              >
                <Text style={[styles.modalBtnLabel, styles.modalBtnLabelPrimary]}>Enregistrer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  hint: { color: COLORS.textSecondary },
  seedBtn: {
    backgroundColor: COLORS.emerald,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  seedBtnLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  addCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
    marginBottom: 24,
  },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  toggle: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  toggleLabel: { fontSize: 14, color: COLORS.textSecondary },
  toggleLabelActive: { color: COLORS.bg, fontWeight: '600' },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginRight: 8,
  },
  chipActive: { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald },
  chipText: { fontSize: 14, color: COLORS.text },
  chipTextActive: { color: COLORS.bg, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  addBtn: { backgroundColor: COLORS.emerald, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.6 },
  addBtnLabel: { fontSize: 15, fontWeight: '700', color: COLORS.bg },
  loader: { marginVertical: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  rowChild: { paddingLeft: 28, backgroundColor: 'rgba(30,41,59,0.3)' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text, flex: 1 },
  rowLabelChild: { fontSize: 14, color: COLORS.textSecondary, flex: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  empty: { padding: 20, color: COLORS.textSecondary, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalBtnPrimary: { backgroundColor: COLORS.emerald, borderRadius: 12 },
  modalBtnLabel: { fontSize: 16, color: COLORS.textSecondary },
  modalBtnLabelPrimary: { color: COLORS.bg, fontWeight: '600' },
});
