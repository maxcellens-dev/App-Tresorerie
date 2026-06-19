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
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/useProfile';
import {
  useCategories,
  useAddCategory,
  useSeedDefaultCategories,
  useUpdateCategory,
  useDeleteCategory,
  useBulkUpdateVariable,
} from '../../hooks/useCategories';
import type { Category } from '../../types/database';
import { useAppColors } from '../../hooks/useAppColors';


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
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';
  const [refreshing, setRefreshing] = useState(false);
  
  const categoriesQuery = useCategories(user?.id);
  const { data: categories = [], isLoading } = categoriesQuery;
  const seedDefaults = useSeedDefaultCategories(user?.id);
  const addCategory = useAddCategory(user?.id);
  const updateCategory = useUpdateCategory(user?.id);
  const deleteCategory = useDeleteCategory(user?.id);
  const bulkUpdateVariable = useBulkUpdateVariable(user?.id);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'income' | 'expense'>('expense');
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ id: string; name: string; type: 'income' | 'expense'; parent_id?: string | null; is_variable?: boolean } | null>(null);
  const [editName, setEditName] = useState('');
  const [editVariable, setEditVariable] = useState(false);
  const [editShowVariableToggle, setEditShowVariableToggle] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
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
      setAddError('Le nom de la catégorie est obligatoire.');
      return;
    }
    setAddError(null);
    try {
      await addCategory.mutateAsync({ name: trimmed, type: newType, parent_id: newParentId });
      setNewName('');
      setNewParentId(null);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Impossible d'ajouter.");
    }
  }

  function openEdit(c: Category) {
    const isExpenseParent = c.type === 'expense' && !c.parent_id;
    console.log('[openEdit]', { name: c.name, type: c.type, parent_id: c.parent_id, is_variable: c.is_variable, isExpenseParent });
    setEditModal({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, is_variable: c.is_variable });
    setEditName(c.name);
    setEditVariable(c.is_variable ?? false);
    setEditShowVariableToggle(isExpenseParent);
  }

  async function handleSaveEdit() {
    if (!editModal) return;
    if (!editName.trim()) {
      setEditError('Le nom est obligatoire.');
      return;
    }
    setEditError(null);
    try {
      const isExpenseParent = editModal.type === 'expense' && !editModal.parent_id;
      const variableChanged = isExpenseParent && editVariable !== (editModal.is_variable ?? false);

      if (variableChanged) {
        // Cascade: update parent + all children
        const childIds = categories
          .filter((ch) => ch.parent_id === editModal.id)
          .map((ch) => ch.id);
        const allIds = [editModal.id, ...childIds];
        await bulkUpdateVariable.mutateAsync({ ids: allIds, is_variable: editVariable });
      }

      await updateCategory.mutateAsync({ id: editModal.id, name: editName.trim() });
      setEditModal(null);
      setEditError(null);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Impossible de modifier.');
    }
  }

  function handleDelete(c: Category) {
    if (c.is_default && !isAdmin) {
      Alert.alert('Non autorisé', 'Seul un administrateur peut supprimer les catégories par défaut.');
      return;
    }
    const message = `Supprimer « ${c.name} » ? Les transactions liées ne seront plus catégorisées.`;
    const doDelete = () => {
      deleteCategory.mutateAsync(c.id).catch((e: unknown) => {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer.');
      });
    };
    Alert.alert('Supprimer', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: doDelete },
    ]);
  }

  function canEditCategory(c: Category): boolean {
    if (c.is_default && !isAdmin) return false;
    return true;
  }

  const income = categories.filter((c) => c.type === 'income');
  const expense = categories.filter((c) => c.type === 'expense');
  const incomeGrouped = groupCategories(income);
  const expenseGrouped = groupCategories(expense);

  const parentOptions = categories.filter((c) => c.type === newType && !c.parent_id);

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <Text style={styles.subtitle}>
          {isAdmin
            ? 'Recettes et dépenses par défaut. Modifiez, ajoutez ou supprimez des postes.'
            : 'Gérez vos catégories personnelles. Les catégories par défaut (🔒) ne sont modifiables que par un administrateur.'}
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
                tintColor={COLORS.green}
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
                style={[styles.input, addError ? { borderColor: COLORS.danger } : {}]}
                value={newName}
                onChangeText={(v) => { setNewName(v); if (addError) setAddError(null); }}
                placeholder="Nom (ex. Salaires, Loyer)"
                placeholderTextColor={COLORS.textSecondary}
                returnKeyType="done"
                onSubmitEditing={handleAdd}
              />
              {addError && (
                <View style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>{addError}</Text>
                </View>
              )}
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
                          {canEditCategory(p) && (
                          <View style={styles.rowActions}>
                            <TouchableOpacity onPress={() => openEdit(p)} hitSlop={8}>
                              <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={{ marginLeft: 12 }}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                          )}
                        </View>
                        {(incomeGrouped.byParent[p.id] ?? []).map((c) => (
                          <View key={c.id} style={[styles.row, styles.rowChild]}>
                            <Text style={styles.rowLabelChild}>{c.name}</Text>
                            {canEditCategory(c) && (
                            <View style={styles.rowActions}>
                              <TouchableOpacity onPress={() => openEdit(c)} hitSlop={8}>
                                <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} style={{ marginLeft: 12 }}>
                                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                            )}
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
                          {canEditCategory(p) && (
                          <View style={styles.rowActions}>
                            <TouchableOpacity onPress={() => openEdit(p)} hitSlop={8}>
                              <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={{ marginLeft: 12 }}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                          )}
                        </View>
                        {(expenseGrouped.byParent[p.id] ?? []).map((c) => (
                          <View key={c.id} style={[styles.row, styles.rowChild]}>
                            <Text style={styles.rowLabelChild}>{c.name}</Text>
                            {canEditCategory(c) && (
                            <View style={styles.rowActions}>
                              <TouchableOpacity onPress={() => openEdit(c)} hitSlop={8}>
                                <Ionicons name="pencil" size={18} color={COLORS.textSecondary} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} style={{ marginLeft: 12 }}>
                                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                            )}
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

      <Modal visible={!!editModal} transparent animationType="fade" onRequestClose={() => { setEditModal(null); setEditError(null); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Modifier la catégorie</Text>
            {editError && (
              <View style={styles.inlineError}>
                <Text style={styles.inlineErrorText}>{editError}</Text>
              </View>
            )}
            <TextInput
              style={[styles.input, editError ? { borderColor: COLORS.danger } : {}]}
              value={editName}
              onChangeText={(v) => { setEditName(v); if (editError) setEditError(null); }}
              placeholder="Nom"
              placeholderTextColor={COLORS.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveEdit}
            />
            {editModal !== null && editModal.type === 'expense' && (editModal.parent_id === null || editModal.parent_id === undefined) ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.label}>Type de dépense</Text>
                <View style={styles.toggle}>
                  <TouchableOpacity
                    style={[styles.toggleBtn, !editVariable && styles.toggleBtnActive]}
                    onPress={() => setEditVariable(false)}
                  >
                    <Text style={[styles.toggleLabel, !editVariable && styles.toggleLabelActive]}>Fixe</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleBtn, editVariable && styles.toggleBtnActive]}
                    onPress={() => setEditVariable(true)}
                  >
                    <Text style={[styles.toggleLabel, editVariable && styles.toggleLabelActive]}>Variable</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 4 }}>
                  Les sous-catégories suivront automatiquement.
                </Text>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => { setEditModal(null); setEditError(null); }}>
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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  hint: { color: c.textSecondary },
  seedBtn: {
    backgroundColor: c.emerald,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  seedBtnLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  addCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 20,
    marginBottom: 24,
  },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  toggle: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  toggleLabel: { fontSize: 14, color: c.textSecondary },
  toggleLabelActive: { color: c.bg, fontWeight: '600' },
  chipRow: { marginBottom: 12, flexGrow: 0 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    marginRight: 8,
  },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 14, color: c.text },
  chipTextActive: { color: c.bg, fontWeight: '600' },
  input: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: c.text,
    marginBottom: 16,
  },
  addBtn: { backgroundColor: c.emerald, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.6 },
  addBtnLabel: { fontSize: 15, fontWeight: '700', color: c.bg },
  inlineError: { backgroundColor: c.danger + '1F', borderWidth: 1, borderColor: c.danger + '66', borderRadius: 8, padding: 10, marginBottom: 10 },
  inlineErrorText: { fontSize: 13, color: c.danger, lineHeight: 18 },
  loader: { marginVertical: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 },
  card: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    borderBottomColor: c.cardBorder,
  },
  rowChild: { paddingLeft: 28, backgroundColor: 'rgba(30,41,59,0.3)' },
  rowLabel: { fontSize: 15, fontWeight: '600', color: c.text, flex: 1 },
  rowLabelChild: { fontSize: 14, color: c.textSecondary, flex: 1 },
  rowActions: { flexDirection: 'row', alignItems: 'center' },
  empty: { padding: 20, color: c.textSecondary, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: c.cardSolid,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 24,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalBtnPrimary: { backgroundColor: c.emerald, borderRadius: 12 },
  modalBtnLabel: { fontSize: 16, color: c.textSecondary },
  modalBtnLabelPrimary: { color: c.bg, fontWeight: '600' },
});
}
