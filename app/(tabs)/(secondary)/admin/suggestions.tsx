import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useRoadmapIdeas, useAddRoadmapIdea, useDeleteRoadmapIdea } from '../../../hooks/useRoadmapIdeas';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  red: '#ef4444',
};

interface Suggestion {
  id: string;
  profile_id: string;
  content: string;
  created_at: string;
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
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: suggestions = [], isLoading } = useAllSuggestions();

  // ── Idées en cours de développement (roadmap) ──
  const { data: roadmapIdeas = [] } = useRoadmapIdeas();
  const addRoadmapIdea = useAddRoadmapIdea(user?.id);
  const deleteRoadmapIdea = useDeleteRoadmapIdea();
  const [newIdea, setNewIdea] = useState('');

  const handleAddRoadmap = async () => {
    if (!newIdea.trim()) { Alert.alert('Champ requis', 'Saisissez une idée.'); return; }
    try {
      await addRoadmapIdea.mutateAsync({ title: newIdea.trim() });
      setNewIdea('');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible d\'ajouter.');
    }
  };

  const handleDeleteRoadmap = (id: string) => {
    Alert.alert('Supprimer', 'Retirer cette idée de la roadmap ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteRoadmapIdea.mutate(id) },
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

  const handleDelete = (id: string) => {
    Alert.alert('Supprimer', 'Supprimer cette suggestion ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const handleDeleteAll = () => {
    Alert.alert('Tout supprimer', `Supprimer les ${suggestions.length} suggestions ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer tout', style: 'destructive', onPress: () => deleteAllMutation.mutate() },
    ]);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

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

          {isLoading && <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} />}

          {!isLoading && suggestions.length === 0 && (
            <View style={styles.emptyCard}>
              <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>Aucune suggestion pour le moment.</Text>
            </View>
          )}

          {suggestions.map((s) => {
            const name = s.profiles?.full_name || s.profiles?.email || 'Utilisateur';
            const date = new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.userBadge}>
                    <Ionicons name="person-circle-outline" size={20} color={COLORS.emerald} />
                    <Text style={styles.userName}>{name}</Text>
                  </View>
                  <Text style={styles.dateText}>{date}</Text>
                </View>
                <Text style={styles.contentText}>{s.content}</Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(s.id)}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                  <Text style={styles.deleteBtnText}>Supprimer</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: COLORS.text, marginLeft: 4 },

  // Roadmap (idées en cours de dev)
  sectionLabel: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  sectionHint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 16 },
  roadmapCard: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 14, marginBottom: 28, gap: 10,
  },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: {
    flex: 1, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.cardBorder,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, fontSize: 14,
  },
  addBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
  roadmapEmpty: { fontSize: 13, color: COLORS.textSecondary, fontStyle: 'italic', paddingVertical: 6 },
  roadmapRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  roadmapText: { flex: 1, fontSize: 14, color: COLORS.text },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: COLORS.textSecondary },
  deleteAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.red + '18', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  deleteAllText: { fontSize: 12, fontWeight: '600', color: COLORS.red },
  emptyCard: { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.textSecondary },
  card: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  userBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userName: { fontSize: 13, fontWeight: '600', color: COLORS.emerald },
  dateText: { fontSize: 11, color: COLORS.textSecondary },
  contentText: { fontSize: 14, color: COLORS.text, lineHeight: 20, marginBottom: 12 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  deleteBtnText: { fontSize: 12, color: COLORS.red },
});
