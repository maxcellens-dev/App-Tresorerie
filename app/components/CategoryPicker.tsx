import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, Modal, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Category } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';
import { CATEGORY_ICON_GLOSSARY, iconForCategory } from '../lib/categoryIcons';

/** Normalise pour une recherche insensible à la casse et aux accents. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export type CategoryGroup = { parentId: string; parentName: string; children: Category[] };

/** Construit la liste des sous-catégories groupées par catégorie parente, triée par nom. */
export function useSubCategoriesGrouped(
  categories: Category[],
  type: 'income' | 'expense'
): CategoryGroup[] {
  return useMemo(() => {
    const typeNorm = type.toLowerCase();
    const byType = categories.filter((c) => String(c.type).toLowerCase() === typeNorm);
    const subCats = byType.filter((c) => c.parent_id != null && c.parent_id !== '') as (Category & { parent_id: string })[];
    const parentIds = [...new Set(subCats.map((c) => c.parent_id))];
    const parentMap = new Map(byType.filter((c) => c.parent_id == null || c.parent_id === '').map((c) => [c.id, c]));
    // Ordre identique à l'écran Catégories : tri par sort_order (parents et enfants), puis nom.
    // « Mouvements » (virements) masqué dans les pages dépenses/recettes.
    const groups: CategoryGroup[] = parentIds
      .map((parentId) => {
        const parent = parentMap.get(parentId);
        const children = subCats
          .filter((c) => c.parent_id === parentId)
          .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.name.localeCompare(b.name));
        return { parentId, parentName: parent?.name ?? 'Catégorie', children };
      })
      .filter((g) => g.children.length > 0 && norm(g.parentName) !== 'mouvements')
      .sort((a, b) => {
        const pa = (parentMap.get(a.parentId)?.sort_order ?? 9999);
        const pb = (parentMap.get(b.parentId)?.sort_order ?? 9999);
        return pa - pb || a.parentName.localeCompare(b.parentName);
      });
    return groups;
  }, [categories, type]);
}

interface CategoryPickerProps {
  groups: CategoryGroup[];
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
  label?: string;
  /** Catégories parentes disponibles pour créer une sous-catégorie (hors « Mouvements »). */
  parents?: { id: string; name: string }[];
  /** Crée une sous-catégorie (avec son icône) et renvoie son id. */
  onCreateSubcategory?: (name: string, parentId: string, icon: string) => Promise<string>;
}

export default function CategoryPicker({ groups, selectedCategoryId, onSelect, label = 'Sous-catégorie (optionnel)', parents, onCreateSubcategory }: CategoryPickerProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [query, setQuery] = useState('');

  // ── Création rapide de sous-catégorie (§12) ──
  const canCreate = !!onCreateSubcategory && !!parents && parents.length > 0;
  const defaultParentId = useMemo(() => {
    if (!parents || parents.length === 0) return '';
    const frais = parents.find((p) => norm(p.name) === 'frais variables');
    return (frais ?? parents[0]).id;
  }, [parents]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openCreate = () => {
    setNewName('');
    setNewParentId(defaultParentId);
    setNewIcon('');
    setCreateError(null);
    setShowCreate(true);
  };
  const handleCreate = async () => {
    if (!onCreateSubcategory) return;
    const name = newName.trim();
    if (!name) { setCreateError('Le nom est requis.'); return; }
    if (!newParentId) { setCreateError('Choisissez une catégorie parente.'); return; }
    setCreating(true); setCreateError(null);
    try {
      const icon = newIcon || iconForCategory({ name });
      const newId = await onCreateSubcategory(name, newParentId, icon);
      setShowCreate(false);
      setQuery('');
      if (newId) onSelect(newId);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Impossible de créer la sous-catégorie.');
    } finally {
      setCreating(false);
    }
  };
  const childIds = useMemo(() => new Set(groups.flatMap((g) => g.children.map((c) => c.id))), [groups]);
  const isNoneSelected = !selectedCategoryId || !childIds.has(selectedCategoryId);

  // Sous-catégorie sélectionnée (pour l'afficher directement dans le champ, sans avoir à scroller).
  const selectedCat = useMemo(() => {
    for (const g of groups) {
      const c = g.children.find((c) => c.id === selectedCategoryId);
      if (c) return { name: c.name, parentName: g.parentName, icon: c.icon };
    }
    return null;
  }, [groups, selectedCategoryId]);

  // Filtrage par recherche (insensible casse/accents). Un parent reste affiché
  // si son nom matche OU s'il a au moins un enfant qui matche.
  const filteredGroups = useMemo(() => {
    const q = norm(query);
    if (!q) return groups;
    return groups
      .map((g) => {
        if (norm(g.parentName).includes(q)) return g;
        const children = g.children.filter((c) => norm(c.name).includes(q));
        return { ...g, children };
      })
      .filter((g) => g.children.length > 0);
  }, [groups, query]);

  // Une sous-catégorie est choisie → on l'affiche dans le champ avec une croix (pas de liste à scroller).
  if (selectedCat) {
    return (
      <View style={styles.block}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.selectedChip}>
          <Ionicons name={iconForCategory(selectedCat) as any} size={16} color={COLORS.emerald} />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectedText} numberOfLines={1}>{selectedCat.name}</Text>
            <Text style={styles.selectedParent} numberOfLines={1}>{selectedCat.parentName}</Text>
          </View>
          <TouchableOpacity onPress={() => { onSelect(''); setQuery(''); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Retirer la sous-catégorie">
            <Ionicons name="close-circle" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {(groups.length > 0 || canCreate) && (
        <View style={styles.searchCreateRow}>
          {groups.length > 0 ? (
            <View style={[styles.searchRow, { flex: 1, marginBottom: 0 }]}>
              <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Rechercher une sous-catégorie…"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          ) : <View style={{ flex: 1 }} />}
          {canCreate && (
            <TouchableOpacity style={styles.createBtn} onPress={openCreate} accessibilityRole="button" accessibilityLabel="Créer une sous-catégorie">
              <Ionicons name="add" size={22} color={COLORS.emerald} />
            </TouchableOpacity>
          )}
        </View>
      )}
      <View style={styles.listContainer}>
        <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={[styles.row, isNoneSelected && styles.rowActive]}
            onPress={() => onSelect('')}
            accessibilityRole="button"
          >
            <Text style={[styles.rowText, isNoneSelected && styles.rowTextActive]}>Aucune</Text>
          </TouchableOpacity>
          {groups.length === 0 && (
            <Text style={styles.hint}>Aucune sous-catégorie. Ajoutez-en dans l’onglet Catégories.</Text>
          )}
          {groups.length > 0 && filteredGroups.length === 0 && (
            <Text style={styles.hint}>Aucun résultat pour « {query} ».</Text>
          )}
          {filteredGroups.map((group) => (
            <View key={group.parentId} style={styles.section}>
              <Text style={styles.sectionHeader}>{group.parentName}</Text>
              {group.children.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.row, styles.rowChild, selectedCategoryId === cat.id && styles.rowActive]}
                  onPress={() => onSelect(cat.id)}
                  accessibilityRole="button"
                >
                  <Ionicons name={iconForCategory(cat) as any} size={15} color={selectedCategoryId === cat.id ? COLORS.emerald : COLORS.textSecondary} style={{ marginRight: 8 }} />
                  <Text style={[styles.rowText, selectedCategoryId === cat.id && styles.rowTextActive]} numberOfLines={1}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>

      {/* Modal de création rapide d'une sous-catégorie (§12) */}
      {canCreate && (
        <Modal visible={showCreate} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowCreate(false)}>
          <Pressable style={styles.createOverlay} onPress={() => setShowCreate(false)}>
            <Pressable style={styles.createBox} onPress={() => {}}>
              <View style={styles.createHeader}>
                <Text style={styles.createTitle}>Nouvelle sous-catégorie</Text>
                <TouchableOpacity onPress={() => setShowCreate(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={COLORS.text} />
                </TouchableOpacity>
              </View>
              <Text style={styles.createLabel}>Catégorie parente</Text>
              <View style={styles.parentChips}>
                {(parents ?? []).map((p) => {
                  const active = newParentId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.parentChip, active && { backgroundColor: COLORS.emerald, borderColor: COLORS.emerald }]}
                      onPress={() => setNewParentId(p.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.parentChipText, active && { color: COLORS.bg }]}>{p.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.createLabel}>Nom</Text>
              <TextInput
                style={styles.createInput}
                value={newName}
                onChangeText={(v) => { setNewName(v); if (createError) setCreateError(null); }}
                placeholder="Ex. Restaurant, Abonnement…"
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreate}
              />
              <Text style={styles.createLabel}>Icône</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} keyboardShouldPersistTaps="handled">
                {Array.from(new Set(CATEGORY_ICON_GLOSSARY)).map((ic) => {
                  const eff = newIcon || iconForCategory({ name: newName });
                  const active = eff === ic;
                  return (
                    <TouchableOpacity key={ic} style={[styles.iconCell, active && { backgroundColor: COLORS.emerald + '22', borderColor: COLORS.emerald }]} onPress={() => setNewIcon(ic)} activeOpacity={0.7}>
                      <Ionicons name={ic as any} size={20} color={active ? COLORS.emerald : COLORS.text} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {createError && <Text style={styles.createErrorText}>{createError}</Text>}
              <TouchableOpacity style={[styles.createSubmit, creating && { opacity: 0.6 }]} onPress={handleCreate} disabled={creating} activeOpacity={0.8}>
                {creating ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.createSubmitText}>Ajouter</Text>}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  block: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: c.emerald, borderRadius: 12,
    backgroundColor: c.emerald + '14', paddingHorizontal: 14, paddingVertical: 12,
  },
  selectedText: { fontSize: 15, fontWeight: '700', color: c.text },
  selectedParent: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 10 : 8, marginBottom: 8,
  },
  searchCreateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  createBtn: {
    width: 42, height: 42, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed' as any,
    borderColor: c.emerald, backgroundColor: c.emerald + '12', alignItems: 'center', justifyContent: 'center',
  },
  // Modal création
  createOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  createBox: { width: '100%', maxWidth: 440, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18, gap: 6 },
  createHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  createTitle: { fontSize: 17, fontWeight: '800', color: c.text },
  createLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  parentChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  parentChip: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.card },
  parentChipText: { fontSize: 13, fontWeight: '600', color: c.text },
  createInput: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'web' ? 11 : 10, fontSize: 15, color: c.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  iconCell: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  createErrorText: { fontSize: 12, color: c.danger, marginTop: 6 },
  createSubmit: { marginTop: 14, backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  createSubmitText: { fontSize: 15, fontWeight: '800', color: c.bg },
  searchInput: {
    flex: 1, fontSize: 15, color: c.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  listContainer: { maxHeight: 200, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, backgroundColor: c.cardSolid },
  list: { flex: 1 },
  listContent: { paddingVertical: 4, paddingBottom: 12 },
  section: { marginTop: 8 },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: c.textSecondary, paddingHorizontal: 12, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  rowChild: { paddingLeft: 24 },
  rowActive: { backgroundColor: c.emerald + '26' },
  rowText: { fontSize: 15, color: c.text },
  rowTextActive: { color: c.emerald, fontWeight: '600' },
  hint: { fontSize: 13, color: c.textSecondary, paddingHorizontal: 12, paddingVertical: 8 },
  });
}
