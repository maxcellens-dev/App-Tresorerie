/**
 * Filtre par SOUS-CATÉGORIE — une seule source pour la page Transactions et l'onglet Transactions
 * d'un compte : recherche insensible aux accents, sous-catégories groupées par parent (Dépenses,
 * puis Recettes), une seule sélection à la fois.
 *
 * - `SubCategoryFilterList` : la recherche + la liste (posée dans un panneau existant).
 * - `SubCategoryFilterPanel` : le panneau complet (titre, « Tout effacer », fermer, bouton « Voir N »),
 *   pour un écran qui n'a QUE ce filtre — la fiche d'un compte, où le compte est déjà choisi.
 */
import { isGardenPalette as isGardenPaletteF } from '../../lib/garden/gardenPalette';
import { gardenFormStyles } from '../../lib/garden/legacyStyles';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSubCategoriesGrouped } from './CategoryPicker';
import AppButton from '../ui/AppButton';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { iconForCategory } from '../../lib/ui/categoryIcons';
import { isProjectSpendTx } from '../../lib/finance/projectTx';
import type { AppColors } from '../../theme/palette';

/** Normalise pour une recherche insensible à la casse et aux accents. */
export function normSearch(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Garde les opérations d'une sous-catégorie. Les opérations de projet sont hors « catégories »
 * (virements / réservations), SAUF les dépenses d'un projet « Dépenser petit à petit », qui sont des
 * dépenses catégorisées normales — même règle que la page Transactions.
 */
export function filterBySubCategory<T extends { category_id?: string | null; project_id?: string | null }>(list: T[], categoryId: string | null): T[] {
  if (!categoryId) return list;
  return list.filter((t) => !(!!t.project_id && !isProjectSpendTx(t as any)) && t.category_id === categoryId);
}

interface ListProps {
  categories: any[];
  value: string | null;
  onChange: (id: string | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
}

export function SubCategoryFilterList({ categories, value, onChange, query, onQueryChange }: ListProps) {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const expenseGroups = useSubCategoriesGrouped(categories, 'expense');
  const incomeGroups = useSubCategoriesGrouped(categories, 'income');
  const sections = useMemo(
    () => [
      { key: 'expense', label: 'Dépenses', groups: expenseGroups },
      { key: 'income', label: 'Recettes', groups: incomeGroups },
    ].filter((x) => x.groups.length > 0),
    [expenseGroups, incomeGroups],
  );
  // Un parent reste visible si son nom correspond, sinon seuls ses enfants correspondants restent.
  const filteredSections = useMemo(() => {
    const q = normSearch(query);
    if (!q) return sections;
    return sections
      .map((x) => ({
        ...x,
        groups: x.groups
          .map((g) => (normSearch(g.parentName).includes(q) ? g : { ...g, children: g.children.filter((ch) => normSearch(ch.name).includes(q)) }))
          .filter((g) => g.children.length > 0),
      }))
      .filter((x) => x.groups.length > 0);
  }, [sections, query]);

  if (sections.length === 0) return <Text style={s.empty}>Aucune sous-catégorie. Ajoutes-en dans Catégories.</Text>;

  return (
    <>
      <View style={s.searchRow}>
        <Ionicons name="search" size={15} color={c.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={onQueryChange}
          placeholder="Rechercher une sous-catégorie…"
          placeholderTextColor={c.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Effacer la recherche" onPress={() => onQueryChange('')} hitSlop={8}>
            <Ionicons name="close-circle" size={17} color={c.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      {/* Hauteur plafonnée + défilement interne : le panneau pousse la liste vers le bas, il ne doit
          jamais la chasser entièrement de l'écran. */}
      <ScrollView style={s.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <TouchableOpacity style={[s.row, !value && s.rowActive]} onPress={() => onChange(null)}>
          <Text style={[s.text, !value && s.textActive]}>Toutes</Text>
        </TouchableOpacity>
        {filteredSections.length === 0 && <Text style={s.empty}>Aucun résultat pour « {query} ».</Text>}
        {filteredSections.map((section) => (
          <View key={section.key}>
            <Text style={s.kind}>{section.label}</Text>
            {section.groups.map((group) => (
              <View key={group.parentId}>
                <Text style={s.parent}>{group.parentName}</Text>
                {group.children.map((cat) => {
                  const active = value === cat.id;
                  return (
                    <TouchableOpacity key={cat.id} style={[s.row, s.rowChild, active && s.rowActive]} onPress={() => onChange(active ? null : cat.id)}>
                      <Ionicons name={iconForCategory(cat) as any} size={15} color={active ? c.emerald : c.textSecondary} />
                      <Text style={[s.text, active && s.textActive]} numberOfLines={1}>{cat.name}</Text>
                      {active && <Ionicons name="checkmark" size={16} color={c.emerald} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

interface PanelProps {
  categories: any[];
  value: string | null;
  onChange: (id: string | null) => void;
  onClose: () => void;
  /** Nombre d'opérations retenues, pour le bouton « Voir N opérations ». */
  resultCount: number;
}

export function SubCategoryFilterPanel({ categories, value, onChange, onClose, resultCount }: PanelProps) {
  const c = useAppColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const [query, setQuery] = useState('');
  const close = () => { setQuery(''); onClose(); };
  return (
    <View style={s.panel}>
      <View style={s.head}>
        <Text style={s.title}>Filtrer par sous-catégorie</Text>
        <View style={s.headActions}>
          {!!value && (
            <TouchableOpacity onPress={() => onChange(null)} hitSlop={8}>
              <Text style={s.reset}>Tout effacer</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fermer les filtres">
            <Ionicons name="close" size={19} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
      <SubCategoryFilterList categories={categories} value={value} onChange={onChange} query={query} onQueryChange={setQuery} />
      <AppButton
        label={resultCount === 0 ? 'Aucune transaction' : `Voir ${resultCount} transaction${resultCount > 1 ? 's' : ''}`}
        size="lg"
        onPress={close}
        style={{ marginTop: 16 }}
      />
    </View>
  );
}

function makeStyles(c: AppColors) {
  const base = makeBaseStyles(c);
  // JARDIN : même écran, habillé comme le reste de l'app (cf. lib/garden/legacyStyles › gardenFormStyles).
  return isGardenPaletteF(c as any) ? gardenFormStyles(base) : base;
}

function makeBaseStyles(c: AppColors) {
  return StyleSheet.create({
    panel: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, marginBottom: 12 },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    headActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    reset: { fontSize: 13, fontWeight: '600', color: c.emerald },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, height: 40, marginBottom: 8 },
    searchInput: { flex: 1, fontSize: 13.5, color: c.text, paddingVertical: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
    list: { maxHeight: 220, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10 },
    kind: { fontSize: 11, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 },
    parent: { fontSize: 12, fontWeight: '700', color: c.text, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
    rowChild: { paddingLeft: 20 },
    rowActive: { backgroundColor: c.emerald + '1A' },
    text: { flex: 1, fontSize: 13.5, color: c.text },
    textActive: { color: c.emerald, fontWeight: '700' },
    empty: { fontSize: 12.5, color: c.textSecondary, paddingHorizontal: 12, paddingVertical: 10 },
  });
}
