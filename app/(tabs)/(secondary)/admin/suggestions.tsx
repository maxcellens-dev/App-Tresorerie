import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../contexts/AuthContext';
import { useRoadmapIdeas, useAddRoadmapIdea, useDeleteRoadmapIdea } from '../../../../hooks/useRoadmapIdeas';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useMarkSuggestionsRead } from '../../../../hooks/useUnreadBadges';


interface Suggestion {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
  status?: string;
  profiles?: { full_name: string | null; email: string | null } | null;
}

function useAllSuggestions() {
  return useQuery({
    queryKey: ['admin-suggestions'],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('suggestions')
        .select('*, profiles(full_name, email)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Suggestion[];
    },
  });
}

export default function AdminSuggestions() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const goBack = useNavBack();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: suggestions = [], isLoading } = useAllSuggestions();
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open');

  // Ouvrir la page = lire les idées → le badge admin (assistance + idées) se décrémente.
  const markIdeasRead = useMarkSuggestionsRead();
  useEffect(() => { markIdeasRead.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredSuggestions = suggestions.filter((s) =>
    filter === 'all' ? true : filter === 'closed' ? s.status === 'closed' : s.status !== 'closed'
  );

  // ── Idées en cours de développement (roadmap) ──
  const { data: roadmapIdeas = [] } = useRoadmapIdeas();
  const addRoadmapIdea = useAddRoadmapIdea(user?.id);
  const deleteRoadmapIdea = useDeleteRoadmapIdea();
  const [newIdea, setNewIdea] = useState('');

  const handleAddRoadmap = async () => {
    if (!newIdea.trim()) return;
    try {
      await addRoadmapIdea.mutateAsync({ title: newIdea.trim() });
      setNewIdea('');
    } catch (e: unknown) { console.error(e); }
  };

  const handleDeleteRoadmap = (id: string) => {
    const doIt = () => deleteRoadmapIdea.mutate(id);
    Alert.alert('Supprimer', 'Retirer cette idée de la roadmap ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: doIt },
    ]);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Supabase indisponible');
      const { error } = await supabase.from('suggestions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-suggestions'] }); },
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Supabase indisponible');
      const { error } = await supabase.from('suggestions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-suggestions'] }); },
  });

  const setStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'open' | 'closed' }) => {
      if (!supabase) throw new Error('Supabase indisponible');
      const { error } = await supabase.from('suggestions').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-suggestions'] }); qc.invalidateQueries({ queryKey: ['suggestions'] }); },
  });

  const handleDelete = (id: string) => {
    const doIt = () => deleteMutation.mutate(id);
    Alert.alert('Supprimer', 'Supprimer cette suggestion ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: doIt },
    ]);
  };

  const handleDeleteAll = () => {
    const doIt = () => deleteAllMutation.mutate();
    Alert.alert('Tout supprimer', `Supprimer les ${suggestions.length} suggestions ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer tout', style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

          {/* ── Idées en cours de développement (visibles côté utilisateur) ── */}
          <Text style={styles.sectionLabel}>Idées en cours de développement</Text>
          <Text style={styles.sectionHint}>Affichées dans la « Boîte à idées ». Si vide, la section est masquée côté utilisateur.</Text>
          <View style={styles.roadmapCard}>
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                value={newIdea}
                onChangeText={setNewIdea}
                placeholder="Ex. Import automatique des relevés…"
                placeholderTextColor={COLORS.textSecondary}
                onSubmitEditing={handleAddRoadmap}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[styles.addBtn, addRoadmapIdea.isPending && { opacity: 0.6 }]}
                onPress={handleAddRoadmap}
                disabled={addRoadmapIdea.isPending}
              >
                {addRoadmapIdea.isPending
                  ? <ActivityIndicator color={COLORS.bg} size="small" />
                  : <Ionicons name="add" size={22} color={COLORS.bg} />}
              </TouchableOpacity>
            </View>

            {roadmapIdeas.length === 0 ? (
              <Text style={styles.roadmapEmpty}>Aucune idée. Ajoutez-en une ci-dessus.</Text>
            ) : (
              roadmapIdeas.map((item, i) => (
                <View
                  key={item.id}
                  style={[styles.roadmapRow, i === roadmapIdeas.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Ionicons name={(item.icon as any) ?? 'construct-outline'} size={18} color={COLORS.emerald} />
                  <Text style={styles.roadmapText}>{item.title}</Text>
                  <TouchableOpacity onPress={() => handleDeleteRoadmap(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={COLORS.red} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Suggestions reçues</Text>
              <Text style={styles.subtitle}>{suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} reçue{suggestions.length !== 1 ? 's' : ''}</Text>
            </View>
            {suggestions.length > 0 && (
              <TouchableOpacity style={styles.deleteAllBtn} onPress={handleDeleteAll}>
                <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                <Text style={styles.deleteAllText}>Tout supprimer</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.filterRow}>
            {(['open', 'closed', 'all'] as const).map((f) => (
              <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
                <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
                  {f === 'open' ? 'En cours' : f === 'closed' ? 'Clôturées' : 'Toutes'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {isLoading && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />}

          {!isLoading && filteredSuggestions.length === 0 && (
            <View style={styles.emptyCard}>
              <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>{filter === 'open' ? 'Aucune suggestion en cours.' : filter === 'closed' ? 'Aucune suggestion clôturée.' : 'Aucune suggestion pour le moment.'}</Text>
            </View>
          )}

          {filteredSuggestions.map((s) => {
            const name = s.profiles?.full_name || s.profiles?.email || 'Utilisateur';
            const date = new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const isClosed = s.status === 'closed';
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.userBadge}>
                    <Ionicons name="person-circle-outline" size={20} color={COLORS.emerald} />
                    <Text style={styles.userName}>{name}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: (isClosed ? COLORS.textSecondary : COLORS.emerald) + '22' }]}>
                    <Text style={[styles.statusPillText, { color: isClosed ? COLORS.textSecondary : COLORS.emerald }]}>{isClosed ? 'Traitée' : 'En cours'}</Text>
                  </View>
                </View>
                <Text style={styles.dateText}>{date}</Text>
                <Text style={styles.contentText}>{s.content}</Text>
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => setStatusMutation.mutate({ id: s.id, status: isClosed ? 'open' : 'closed' })}
                  >
                    <Ionicons name={isClosed ? 'refresh-outline' : 'checkmark-done-outline'} size={16} color={COLORS.emerald} />
                    <Text style={[styles.actionBtnText, { color: COLORS.emerald }]}>{isClosed ? 'Rouvrir' : 'Clôturer'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(s.id)}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                    <Text style={[styles.actionBtnText, { color: COLORS.red }]}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },

  // Roadmap (idées en cours de dev)
  sectionLabel: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: c.textSecondary, marginBottom: 12, lineHeight: 16 },
  roadmapCard: {
    backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
    padding: 14, marginBottom: 28, gap: 10,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: {
    flex: 1, backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 14,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: c.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
  roadmapEmpty: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', paddingVertical: 6 },
  roadmapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder,
  },
  roadmapText: { flex: 1, fontSize: 14, color: c.text },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder },
  chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
  chipText: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  chipTextActive: { color: c.bg },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: c.textSecondary },
  deleteAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.red + '18', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  deleteAllText: { fontSize: 12, fontWeight: '600', color: c.red },
  emptyCard: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: c.textSecondary },
  card: {
    backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
    padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  userBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 13, fontWeight: '600', color: c.emerald },
  statusPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  dateText: { fontSize: 11, color: c.textSecondary, marginBottom: 10 },
  contentText: { fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 12 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
});
}
