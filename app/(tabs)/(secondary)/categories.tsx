import { useMemo, useEffect, useState, useRef } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/data/useProfile';
import {
  useCategories,
  useAddCategory,
  useSeedDefaultCategories,
  useUpdateCategory,
  useDeleteCategory,
  useBulkUpdateVariable,
  useReorderCategories,
} from '../../../hooks/data/useCategories';
import type { Category } from '../../../types/database';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import IconPickerModal from '../../../components/ui/IconPickerModal';
import { iconForCategory } from '../../../lib/ui/categoryIcons';
import { supabase } from '../../../lib/platform/supabase';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import KeyboardAwareOverlay from '../../../components/layout/KeyboardAwareOverlay';


/** Clé du champ « nouvelle catégorie parente » (admin) — aucun id réel ne peut la valoir. */
const ROOT_ADD = '__root__';

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

function CategoriesScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  const { data: categories = [], isLoading } = useCategories(user?.id);
  const seedDefaults = useSeedDefaultCategories(user?.id);
  const addCategory = useAddCategory(user?.id);
  const updateCategory = useUpdateCategory(user?.id);
  const deleteCategory = useDeleteCategory(user?.id);
  const bulkUpdateVariable = useBulkUpdateVariable(user?.id);
  const reorderCategories = useReorderCategories(user?.id);

  /* Onglet global : on ne travaille QUE sur les dépenses ou QUE sur les recettes. Les deux
     listes bout à bout faisaient une page interminable où l'on ne savait plus dans laquelle on
     se trouvait — et on ajoutait une sous-catégorie du mauvais côté. */
  const [activeType, setActiveType] = useState<'income' | 'expense'>('expense');
  /* Création INLINE : l'id de la catégorie parente dont le champ « nouvelle sous-catégorie » est
     ouvert (`ROOT_ADD` = nouvelle catégorie parente, admin). Un seul champ ouvert à la fois. */
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editModal, setEditModal] = useState<{ id: string; name: string; type: 'income' | 'expense'; parent_id?: string | null; is_variable?: boolean } | null>(null);
  // Sélecteur d'icône d'une sous-catégorie (§13)
  const [iconModal, setIconModal] = useState<{ id: string; name: string; type: 'income' | 'expense'; current?: string | null } | null>(null);
  const [editName, setEditName] = useState('');
  const [editVariable, setEditVariable] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const hasSeeded = useRef(false);

  useEffect(() => {
    if (!user?.id || categories.length > 0 || hasSeeded.current || isLoading) return;
    hasSeeded.current = true;
    seedDefaults.mutate();
  }, [user?.id, categories.length, isLoading]);

  /** Ouvre (ou ferme) le champ de création, en repartant toujours d'un champ vide. */
  function openAdd(parentId: string | null) {
    setAddingIn((cur) => (cur === (parentId ?? ROOT_ADD) ? null : (parentId ?? ROOT_ADD)));
    setNewName('');
    setAddError(null);
  }

  function cancelAdd() {
    setAddingIn(null);
    setNewName('');
    setAddError(null);
  }

  /**
   * Enregistre la ligne saisie. `parentId` null = nouvelle catégorie parente (admin uniquement).
   * L'icône est déduite du nom, comme à la création rapide depuis un écran de saisie : une
   * sous-catégorie sans icône affiche une étiquette générique et n'aide personne à s'y retrouver.
   */
  async function handleAdd(parentId: string | null) {
    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Le nom est obligatoire.');
      return;
    }
    setAddError(null);
    try {
      await addCategory.mutateAsync({
        name: trimmed,
        type: activeType,
        parent_id: parentId,
        ...(parentId ? { icon: iconForCategory({ name: trimmed }) } : {}),
      });
      // On garde le champ OUVERT : on ajoute rarement une seule sous-catégorie à la suite.
      setNewName('');
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Impossible d'ajouter.");
    }
  }

  function openEdit(c: Category) {
    setEditModal({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id, is_variable: c.is_variable });
    setEditName(c.name);
    setEditVariable(c.is_variable ?? false);
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

  async function handleMove(parents: Category[], index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= parents.length) return;
    const a = parents[index];
    const b = parents[targetIndex];
    const aOrder = a.sort_order ?? index * 10;
    const bOrder = b.sort_order ?? targetIndex * 10;
    try {
      await reorderCategories.mutateAsync([
        { id: a.id, sort_order: bOrder },
        { id: b.id, sort_order: aOrder },
      ]);
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de réordonner.');
    }
  }

  // Réordonne une sous-catégorie DANS son parent (§P2). Les enfants partageant souvent le même
  // sort_order (seed), on réassigne des valeurs séquentielles distinctes pour fiabiliser l'ordre.
  async function handleMoveChild(children: Category[], index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= children.length) return;
    const reordered = [...children];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderCategories.mutateAsync(reordered.map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10 })));
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de réordonner.');
    }
  }

  /**
   * Qui peut supprimer quoi. Les catégories de base (`is_default`) sont le socle commun : elles se
   * renomment et se réordonnent librement, mais elles ne se suppriment pas — sauf en admin.
   * Le bouton correspondant n'est donc PAS affiché à l'utilisateur : proposer une action qui
   * répond invariablement « impossible » n'est pas une protection, c'est une impasse.
   */
  const canDelete = (c: Category) => isAdmin || !c.is_default;

  async function handleDelete(c: Category) {
    // Filet de sécurité : le bouton est masqué, mais la règle reste portée par la fonction.
    if (c.is_default && !isAdmin) {
      Alert.alert('Action impossible', 'Les catégories par défaut ne peuvent pas être supprimées. Tu peux les renommer.');
      return;
    }
    // Blocage si des transactions utilisent cette (sous-)catégorie (§P3) : on demande à l'utilisateur
    // de d'abord les recatégoriser. Inclut la catégorie + ses éventuelles sous-catégories.
    if (supabase) {
      const childIds = categories.filter((x) => x.parent_id === c.id).map((x) => x.id);
      const ids = [c.id, ...childIds];
      const { count } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .in('category_id', ids);
      if ((count ?? 0) > 0) {
        Alert.alert(
          'Suppression impossible',
          `« ${c.name} » est utilisée par ${count} transaction${(count ?? 0) > 1 ? 's' : ''}. Retirez d'abord cette catégorie de ces transactions (modifiez-les ou changez leur catégorie) avant de pouvoir la supprimer.`
        );
        return;
      }
    }
    const message = `Supprimer « ${c.name} » ?`;
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

  // « Mouvements » (virements internes) : catégorie système masquée aux non-admins (§N1).
  const normName = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const mouvementsIds = new Set(
    categories.filter((c) => !c.parent_id && c.type === 'expense' && normName(c.name) === 'mouvements').map((c) => c.id)
  );
  const hideForUser = (c: Category) => !isAdmin && (mouvementsIds.has(c.id) || (!!c.parent_id && mouvementsIds.has(c.parent_id)));

  // Seul le type de l'onglet actif est construit : la page ne montre qu'une liste à la fois.
  const visible = categories.filter((c) => c.type === activeType && !hideForUser(c));
  const grouped = groupCategories(visible);

  /**
   * Une catégorie parente et ses sous-catégories, en UNE carte.
   *
   * L'ancienne mise en page empilait tout dans une seule carte, avec un gris codé en dur
   * (`rgba(30,41,59,0.3)`) sur les lignes enfants : hors thème sombre, ce voile passait pour un
   * « désactivé » et les sous-catégories — l'essentiel de la page — paraissaient inertes. Ici la
   * hiérarchie est portée par la STRUCTURE (une carte = une catégorie, un en-tête, des lignes
   * indentées), pas par un fond grisé.
   */
  const renderGroup = (parents: Category[], p: Category, idx: number, children: Category[]) => {
    const adding = addingIn === p.id;
    return (
      <View key={p.id} style={styles.groupCard}>
        <View style={styles.groupHead}>
          <Text style={styles.groupTitle} numberOfLines={1}>{p.name}</Text>
          <View style={styles.rowActions}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monter cette catégorie" onPress={() => handleMove(parents, idx, 'up')} hitSlop={8} disabled={idx === 0} style={[styles.actionBtn, idx === 0 && styles.actionBtnDisabled]}>
              <Ionicons name="chevron-up" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Descendre cette catégorie" onPress={() => handleMove(parents, idx, 'down')} hitSlop={8} disabled={idx === parents.length - 1} style={[styles.actionBtn, idx === parents.length - 1 && styles.actionBtnDisabled]}>
              <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openEdit(p)} hitSlop={8} style={styles.actionBtn} accessibilityLabel={`Renommer ${p.name}`}>
              <Ionicons name="pencil" size={17} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {canDelete(p) && (
              <TouchableOpacity onPress={() => handleDelete(p)} hitSlop={8} style={styles.actionBtn} accessibilityLabel={`Supprimer ${p.name}`}>
                <Ionicons name="trash-outline" size={17} color={COLORS.danger} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {children.length === 0 && !adding && (
          <Text style={styles.groupEmpty}>Aucune sous-catégorie pour l’instant.</Text>
        )}
        {children.map((c, ci, arr) => (
          <View key={c.id} style={[styles.childRow, ci === arr.length - 1 && styles.childRowLast]}>
            <TouchableOpacity onPress={() => setIconModal({ id: c.id, name: c.name, type: c.type, current: c.icon ?? null })} hitSlop={6} style={styles.catIconBtn} activeOpacity={0.7} accessibilityLabel={`Icône de ${c.name}`}>
              <Ionicons name={iconForCategory(c) as any} size={17} color={COLORS.emerald} />
            </TouchableOpacity>
            <Text style={styles.childName} numberOfLines={1}>{c.name}</Text>
            <View style={styles.rowActions}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Monter cette sous-catégorie" onPress={() => handleMoveChild(arr, ci, 'up')} hitSlop={8} disabled={ci === 0} style={[styles.actionBtn, ci === 0 && styles.actionBtnDisabled]}>
                <Ionicons name="chevron-up" size={15} color={COLORS.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Descendre cette sous-catégorie" onPress={() => handleMoveChild(arr, ci, 'down')} hitSlop={8} disabled={ci === arr.length - 1} style={[styles.actionBtn, ci === arr.length - 1 && styles.actionBtnDisabled]}>
                <Ionicons name="chevron-down" size={15} color={COLORS.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openEdit(c)} hitSlop={8} style={styles.actionBtn} accessibilityLabel={`Renommer ${c.name}`}>
                <Ionicons name="pencil" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
              {canDelete(c) && (
                <TouchableOpacity onPress={() => handleDelete(c)} hitSlop={8} style={styles.actionBtn} accessibilityLabel={`Supprimer ${c.name}`}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}

        {/* Création SUR PLACE : la nouvelle ligne s'écrit là où elle va apparaître, dans sa
            catégorie. Plus de formulaire en haut de page où il fallait re-choisir le type puis
            la catégorie parente pour un simple « Boulangerie ». */}
        {adding ? (
          <View style={[styles.childRow, styles.addRow]}>
            <View style={styles.catIconBtn}>
              <Ionicons name={iconForCategory({ name: newName }) as any} size={17} color={COLORS.emerald} />
            </View>
            <TextInput
              style={styles.addInput}
              value={newName}
              onChangeText={(v) => { setNewName(v); if (addError) setAddError(null); }}
              placeholder="Nom de la sous-catégorie"
              placeholderTextColor={COLORS.textSecondary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => handleAdd(p.id)}
              editable={!addCategory.isPending}
            />
            <TouchableOpacity onPress={cancelAdd} hitSlop={8} style={styles.actionBtn} accessibilityLabel="Annuler">
              <Ionicons name="close" size={19} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleAdd(p.id)} hitSlop={8} style={styles.actionBtn} disabled={addCategory.isPending} accessibilityLabel="Enregistrer">
              {addCategory.isPending
                ? <ActivityIndicator size="small" color={COLORS.emerald} />
                : <Ionicons name="checkmark" size={20} color={COLORS.emerald} />}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addTrigger} onPress={() => openAdd(p.id)} activeOpacity={0.7}>
            <Ionicons name="add" size={17} color={COLORS.emerald} />
            <Text style={styles.addTriggerText}>Ajouter une sous-catégorie</Text>
          </TouchableOpacity>
        )}
        {adding && addError && <Text style={styles.addRowError}>{addError}</Text>}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right']}>
        <ScreenHeader
          title="Catégories"
          onBack={goBack}
          right={isAdmin ? (
            <TouchableOpacity onPress={() => router.push('/(tabs)/(secondary)/admin/categories' as any)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="construct-outline" size={16} color={COLORS.blue} />
              <Text style={{ color: COLORS.blue, fontWeight: '700', fontSize: 13 }}>Base (admin)</Text>
            </TouchableOpacity>
          ) : undefined}
        />
        <Text style={styles.subtitle}>
          Tes recettes et tes dépenses. Renomme, ajoute ou supprime des postes.
          {!isAdmin && ' Les catégories de base ne se suppriment pas, mais tu peux les renommer.'}
        </Text>

        {!user ? (
          <Text style={styles.hint}>Connecte-toi pour gérer tes catégories.</Text>
        ) : (
          <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {categories.length === 0 && !isLoading && (
              <TouchableOpacity
                style={styles.seedBtn}
                onPress={() => seedDefaults.mutate()}
                disabled={seedDefaults.isPending}
              >
                {seedDefaults.isPending ? (
                  <ActivityIndicator color={COLORS.onAccent} size="small" />
                ) : (
                  <Text style={styles.seedBtnLabel}>Charger les catégories par défaut</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Onglet global : dépenses OU recettes. Il commande aussi ce que l'on crée — plus
                besoin de choisir un type à chaque ajout, on est déjà du bon côté. */}
            <View style={styles.typeTabs}>
              {([
                { key: 'expense', label: 'Dépenses', icon: 'arrow-down' },
                { key: 'income', label: 'Recettes', icon: 'arrow-up' },
              ] as const).map((t) => {
                const active = activeType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.typeTab, active && styles.typeTabActive]}
                    onPress={() => { setActiveType(t.key); cancelAdd(); }}
                    activeOpacity={0.8}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Ionicons name={t.icon as any} size={15} color={active ? COLORS.bg : COLORS.textSecondary} />
                    <Text style={[styles.typeTabText, active && styles.typeTabTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {isLoading ? (
              <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
            ) : (
              <>
                {grouped.parents.length === 0 ? (
                  <View style={styles.groupCard}>
                    <Text style={styles.empty}>
                      {activeType === 'expense' ? 'Aucune catégorie de dépense.' : 'Aucune catégorie de recette.'}
                    </Text>
                  </View>
                ) : (
                  grouped.parents.map((p, idx) =>
                    renderGroup(grouped.parents, p, idx, grouped.byParent[p.id] ?? []))
                )}

                {/* Créer une catégorie PARENTE : réservé à l'admin, comme avant (l'option « Aucune »
                    de l'ancien formulaire ne s'affichait que pour lui). */}
                {isAdmin && (
                  addingIn === ROOT_ADD ? (
                    <View style={[styles.groupCard, styles.rootAddCard]}>
                      <TextInput
                        style={styles.addInput}
                        value={newName}
                        onChangeText={(v) => { setNewName(v); if (addError) setAddError(null); }}
                        placeholder="Nom de la catégorie"
                        placeholderTextColor={COLORS.textSecondary}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={() => handleAdd(null)}
                        editable={!addCategory.isPending}
                      />
                      <TouchableOpacity onPress={cancelAdd} hitSlop={8} style={styles.actionBtn} accessibilityLabel="Annuler">
                        <Ionicons name="close" size={19} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleAdd(null)} hitSlop={8} style={styles.actionBtn} disabled={addCategory.isPending} accessibilityLabel="Enregistrer">
                        {addCategory.isPending
                          ? <ActivityIndicator size="small" color={COLORS.emerald} />
                          : <Ionicons name="checkmark" size={20} color={COLORS.emerald} />}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.rootAddTrigger} onPress={() => openAdd(null)} activeOpacity={0.7}>
                      <Ionicons name="add-circle-outline" size={18} color={COLORS.emerald} />
                      <Text style={styles.addTriggerText}>Nouvelle catégorie (admin)</Text>
                    </TouchableOpacity>
                  )
                )}
                {addingIn === ROOT_ADD && addError && <Text style={styles.addRowError}>{addError}</Text>}
              </>
            )}
          </KeyboardAwareScrollView>
        )}
      </SafeAreaView>

      <Modal visible={!!editModal} transparent animationType="fade" onRequestClose={() => { setEditModal(null); setEditError(null); }}>
        <KeyboardAwareOverlay style={styles.modalOverlay}>
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
            {editModal !== null && editModal.type === 'expense' && !editModal.parent_id ? (
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
        </KeyboardAwareOverlay>
      </Modal>

      {/* Sélecteur d'icône de sous-catégorie (§13) — par utilisateur */}
      <IconPickerModal
        visible={!!iconModal}
        value={iconModal?.current ?? null}
        title={iconModal ? `Icône · ${iconModal.name}` : 'Choisir une icône'}
        onClose={() => setIconModal(null)}
        onSelect={(icon) => {
          if (iconModal) updateCategory.mutate({ id: iconModal.id, name: iconModal.name, type: iconModal.type, icon });
        }}
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 4, marginRight: 12 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: c.text },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
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
  seedBtnLabel: { fontSize: 16, fontWeight: '700', color: c.onAccent },
  // ── Onglets Dépenses / Recettes (filtre global de la page) ──
  typeTabs: { flexDirection: 'row', gap: 6, padding: 4, marginBottom: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12 },
  typeTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 9 },
  typeTabActive: { backgroundColor: c.emerald },
  typeTabText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  typeTabTextActive: { color: c.onAccent, fontWeight: '800' },
  // Styles du modal d'édition (renommer + choisir Fixe/Variable sur une catégorie de dépense).
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
  toggleLabelActive: { color: c.onAccent, fontWeight: '600' },
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
  inlineError: { backgroundColor: c.danger + '1F', borderWidth: 1, borderColor: c.danger + '66', borderRadius: 8, padding: 10, marginBottom: 10 },
  inlineErrorText: { fontSize: 13, color: c.danger, lineHeight: 18 },
  loader: { marginVertical: 24 },
  // Une carte = UNE catégorie parente et ses sous-catégories. C'est la carte qui porte la
  // hiérarchie ; les lignes enfants gardent le fond de la carte (aucun voile gris).
  groupCard: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.cardBorder,
    overflow: 'hidden',
    marginBottom: 12,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: c.emerald + '12',
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
  groupTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: c.text },
  groupEmpty: { paddingHorizontal: 14, paddingVertical: 14, fontSize: 12.5, fontStyle: 'italic', color: c.textSecondary },
  // ── Création sur place ──
  addTrigger: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: c.cardBorder },
  addTriggerText: { fontSize: 13.5, fontWeight: '700', color: c.emerald },
  addRow: { borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: c.cardBorder, backgroundColor: c.emerald + '0A' },
  addInput: {
    flex: 1, fontSize: 14, color: c.text, paddingVertical: 6, marginRight: 4,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addRowError: { fontSize: 12, color: c.danger, paddingHorizontal: 14, paddingBottom: 10, lineHeight: 16 },
  rootAddCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  rootAddTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: c.emerald + '80', marginTop: 4 },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.cardBorder,
  },
  childRowLast: { borderBottomWidth: 0 },
  // Couleur de texte PLEINE : en secondaire, les sous-catégories passaient pour désactivées.
  childName: { flex: 1, fontSize: 14, color: c.text },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actionBtn: { padding: 6 },
  actionBtnDisabled: { opacity: 0.25 },
  catIconBtn: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald + '14', marginRight: 10 },
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
  modalBtnLabelPrimary: { color: c.onAccent, fontWeight: '600' },
});
}

/* OUVERTURE INSTANTANÉE : silhouette de page pendant le montage du corps (cf. useDeferredMount). */
export default withDeferredMount(CategoriesScreen);
