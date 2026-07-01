/**
 * Admin — édition des CATÉGORIES DE BASE (référentiel commun). Ajouter / renommer / archiver / déplacer,
 * puis « Appliquer à tous » propage aux utilisateurs (ajoute, met à jour le placement, renomme si le
 * user ne l'a pas renommé). Réservé aux admins.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import ScreenGradient from '../../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useBaseCategories, useAddBaseCategory, useUpdateBaseCategory, useReorderBaseCategories, useApplyBaseCategories, type BaseCategory } from '../../../../hooks/useBaseCategories';

export default function AdminCategoriesScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: cats = [], isLoading } = useBaseCategories();
  const add = useAddBaseCategory();
  const upd = useUpdateBaseCategory();
  const reorder = useReorderBaseCategories();
  const apply = useApplyBaseCategories();

  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [addChildTo, setAddChildTo] = useState<string | null>(null);
  const [childName, setChildName] = useState('');

  if (!profile?.is_admin) {
    return (
      <View style={styles.root}><ScreenGradient /><SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Catégories de base" onBack={() => router.back()} />
        <Text style={styles.denied}>Réservé aux administrateurs.</Text>
      </SafeAreaView></View>
    );
  }

  const bySort = (a: BaseCategory, b: BaseCategory) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);
  const parents = cats.filter((c) => c.type === type && !c.parent_id).sort(bySort);
  const childrenOf = (pid: string) => cats.filter((c) => c.parent_id === pid).sort(bySort);

  const saveName = (c: BaseCategory) => { if (editName.trim()) upd.mutate({ id: c.id, name: editName.trim() }); setEditingId(null); };
  // Déplace en réécrivant TOUT le groupe (frères/sœurs) en sort_order séquentiel → robuste aux égalités.
  const move = (c: BaseCategory, dir: -1 | 1) => {
    const group = (c.parent_id ? childrenOf(c.parent_id) : parents);
    const i = group.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= group.length) return;
    const arr = [...group];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    const items = arr.map((x, idx) => ({ id: x.id, sort_order: idx * 10 })).filter((it, idx) => (arr[idx].sort_order ?? 0) !== it.sort_order);
    if (items.length) reorder.mutate(items);
  };
  const toggleArchive = (c: BaseCategory) => upd.mutate({ id: c.id, is_active: !c.is_active });

  const doApply = () => {
    Alert.alert('Appliquer à tous', 'Propager le référentiel à TOUS les utilisateurs ? (ajoute les nouveautés, met à jour le placement, renomme sauf si déjà renommé par le user)', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Appliquer', onPress: () => apply.mutate(undefined, { onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'), onSuccess: () => Alert.alert('Fait', 'Référentiel propagé à tous les utilisateurs.') }) },
    ]);
  };

  const renderCat = (c: BaseCategory, isChild: boolean) => (
    <View key={c.id} style={[styles.row, isChild && { paddingLeft: 26 }, !c.is_active && { opacity: 0.45 }]}>
      {editingId === c.id ? (
        <TextInput style={styles.editInput} value={editName} onChangeText={setEditName} autoFocus onSubmitEditing={() => saveName(c)} />
      ) : (
        <Text style={[styles.name, !isChild && { fontWeight: '700' }]} numberOfLines={1}>{c.name}{!c.is_active ? ' (archivée)' : ''}</Text>
      )}
      <TouchableOpacity onPress={() => move(c, -1)}><Ionicons name="chevron-up" size={18} color={COLORS.textSecondary} /></TouchableOpacity>
      <TouchableOpacity onPress={() => move(c, 1)}><Ionicons name="chevron-down" size={18} color={COLORS.textSecondary} /></TouchableOpacity>
      {editingId === c.id ? (
        <TouchableOpacity onPress={() => saveName(c)}><Ionicons name="checkmark" size={18} color={COLORS.emerald} /></TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => { setEditingId(c.id); setEditName(c.name); }}><Ionicons name="pencil" size={16} color={COLORS.blue} /></TouchableOpacity>
      )}
      <TouchableOpacity onPress={() => toggleArchive(c)}><Ionicons name={c.is_active ? 'archive-outline' : 'refresh-outline'} size={17} color={c.is_active ? COLORS.danger : COLORS.emerald} /></TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <ScreenGradient />
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Catégories de base" onBack={() => router.back()} />
        <View style={styles.typeRow}>
          {([['expense', 'Dépenses'], ['income', 'Recettes']] as const).map(([t, lbl]) => (
            <TouchableOpacity key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
              <Text style={[styles.typeText, type === t && { color: COLORS.text }]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {isLoading ? <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 30 }} /> : parents.map((p) => (
            <View key={p.id} style={styles.group}>
              {renderCat(p, false)}
              {childrenOf(p.id).map((ch) => renderCat(ch, true))}
              {addChildTo === p.id ? (
                <View style={[styles.row, { paddingLeft: 26 }]}>
                  <TextInput style={styles.editInput} value={childName} onChangeText={setChildName} placeholder="Nouvelle sous-catégorie" placeholderTextColor={COLORS.textSecondary} autoFocus />
                  <TouchableOpacity onPress={() => { if (childName.trim()) add.mutate({ name: childName.trim(), type, parent_id: p.id, is_variable: p.is_variable, sort_order: p.sort_order }); setChildName(''); setAddChildTo(null); }}>
                    <Ionicons name="checkmark" size={18} color={COLORS.emerald} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addChild} onPress={() => { setAddChildTo(p.id); setChildName(''); }}>
                  <Ionicons name="add" size={15} color={COLORS.blue} /><Text style={styles.addChildText}>Sous-catégorie</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/* Ajouter une catégorie parente */}
          <View style={styles.addParent}>
            <TextInput style={styles.editInput} value={newParent} onChangeText={setNewParent} placeholder="Nouvelle catégorie parente" placeholderTextColor={COLORS.textSecondary} />
            <TouchableOpacity onPress={() => { if (newParent.trim()) { const maxSort = Math.max(0, ...parents.map((p) => p.sort_order ?? 0)); add.mutate({ name: newParent.trim(), type, sort_order: maxSort + 10 }); setNewParent(''); } }}>
              <Ionicons name="add-circle" size={26} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        <TouchableOpacity style={[styles.applyBtn, apply.isPending && { opacity: 0.6 }]} onPress={doApply} disabled={apply.isPending}>
          {apply.isPending ? <ActivityIndicator color={COLORS.bg} /> : <><Ionicons name="cloud-upload-outline" size={18} color={COLORS.bg} /><Text style={styles.applyLabel}>Appliquer à tous les utilisateurs</Text></>}
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    denied: { textAlign: 'center', color: c.textSecondary, marginTop: 40 },
    typeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    typeChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    typeChipActive: { backgroundColor: c.text + '12', borderColor: c.text },
    typeText: { fontSize: 13.5, fontWeight: '700', color: c.textSecondary },
    scroll: { flex: 1 },
    group: { marginBottom: 14, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 8, backgroundColor: c.card },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    name: { flex: 1, fontSize: 14, color: c.text },
    editInput: { flex: 1, borderWidth: 1, borderColor: c.blue, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, fontSize: 14, color: c.text },
    addChild: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 26, paddingVertical: 4 },
    addChildText: { color: c.blue, fontSize: 12.5, fontWeight: '600' },
    addParent: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 20 },
    applyBtn: { position: 'absolute', left: 20, right: 20, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.emerald, paddingVertical: 15, borderRadius: 14 },
    applyLabel: { color: c.bg, fontSize: 15, fontWeight: '800' },
  });
}
