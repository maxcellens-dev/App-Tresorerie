import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import type { Category } from '../types/database';

const COLORS = {
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

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
  const childIds = useMemo(() => new Set(groups.flatMap((g) => g.children.map((c) => c.id))), [groups]);
  const isNoneSelected = !selectedCategoryId || !childIds.has(selectedCategoryId);
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.listContainer}>
        <ScrollView style={styles.list} nestedScrollEnabled showsVerticalScrollIndicator contentContainerStyle={styles.listContent}>
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
          {groups.map((group) => (
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

const styles = StyleSheet.create({
  block: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  listContainer: { maxHeight: 200, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 12, backgroundColor: COLORS.card },
  list: { flex: 1 },
  listContent: { paddingVertical: 4, paddingBottom: 12 },
  section: { marginTop: 8 },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, paddingHorizontal: 12, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  rowChild: { paddingLeft: 24 },
  rowActive: { backgroundColor: 'rgba(52, 211, 153, 0.15)' },
  rowText: { fontSize: 15, color: COLORS.text },
  rowTextActive: { color: COLORS.emerald, fontWeight: '600' },
  hint: { fontSize: 13, color: COLORS.textSecondary, paddingHorizontal: 12, paddingVertical: 8 },
});
