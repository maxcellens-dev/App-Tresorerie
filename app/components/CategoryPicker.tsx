import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Category } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';

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
    const groups: CategoryGroup[] = parentIds
      .map((parentId) => {
        const parent = parentMap.get(parentId);
        const children = subCats.filter((c) => c.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
        return { parentId, parentName: parent?.name ?? 'Catégorie', children };
      })
      .filter((g) => g.children.length > 0)
      .sort((a, b) => a.parentName.localeCompare(b.parentName));
    return groups;
  }, [categories, type]);
}

interface CategoryPickerProps {
  groups: CategoryGroup[];
  selectedCategoryId: string;
  onSelect: (categoryId: string) => void;
  label?: string;
}

export default function CategoryPicker({ groups, selectedCategoryId, onSelect, label = 'Sous-catégorie (optionnel)' }: CategoryPickerProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [query, setQuery] = useState('');
  const childIds = useMemo(() => new Set(groups.flatMap((g) => g.children.map((c) => c.id))), [groups]);
  const isNoneSelected = !selectedCategoryId || !childIds.has(selectedCategoryId);

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

  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {groups.length > 0 && (
        <View style={styles.searchRow}>
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
                  <Text style={[styles.rowText, selectedCategoryId === cat.id && styles.rowTextActive]} numberOfLines={1}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  block: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 10 : 8, marginBottom: 8,
  },
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
