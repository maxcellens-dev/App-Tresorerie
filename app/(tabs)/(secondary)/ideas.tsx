import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoadmapIdeas } from '../../hooks/useRoadmapIdeas';
import { useAppColors } from '../../hooks/useAppColors';


function useSuggestions(profileId: string | undefined) {
  return useQuery({
    queryKey: ['suggestions', profileId],
    queryFn: async () => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('suggestions')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!profileId,
  });
}

function useAddSuggestion(profileId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { error } = await supabase.from('suggestions').insert({ profile_id: profileId, content });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suggestions', profileId] }); },
  });
}

export default function IdeasScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const [idea, setIdea] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { data: mySuggestions = [] } = useSuggestions(user?.id);
  const { data: roadmapIdeas = [] } = useRoadmapIdeas();
  const addSuggestion = useAddSuggestion(user?.id);

  const handleSubmit = async () => {
    if (!idea.trim()) {
      Alert.alert('Champ requis', 'Veuillez décrire votre idée.');
      return;
    }
    try {
      await addSuggestion.mutateAsync(idea.trim());
      setSubmitted(true);
      setIdea('');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'envoyer.");
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.pageHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Boîte à idées</Text>
          </View>
          <Text style={styles.subtitle}>
            Aidez-nous à améliorer Trésorerie ! Partagez vos suggestions, idées de fonctionnalités ou améliorations.
          </Text>

          {submitted ? (
            <View style={styles.successCard}>
              <Ionicons name="checkmark-circle" size={48} color={COLORS.emerald} />
              <Text style={styles.successTitle}>Merci pour votre idée !</Text>
              <Text style={styles.successText}>
                Nous examinons chaque suggestion avec attention. Les meilleures idées seront intégrées dans les prochaines mises à jour.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => setSubmitted(false)}>
                <Text style={styles.btnText}>Proposer une autre idée</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.card}>
              <Ionicons name="bulb" size={28} color="#f59e0b" style={{ alignSelf: 'center', marginBottom: 12 }} />
              <Text style={styles.cardTitle}>Votre suggestion</Text>
              <TextInput
                style={styles.input}
                value={idea}
                onChangeText={setIdea}
                placeholder="Décrivez votre idée en détail..."
                placeholderTextColor={COLORS.textSecondary}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
              <TouchableOpacity style={[styles.btn, addSuggestion.isPending && { opacity: 0.6 }]} onPress={handleSubmit} disabled={addSuggestion.isPending}>
                {addSuggestion.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.btnText}>Envoyer ma suggestion</Text>}
              </TouchableOpacity>
            </View>
          )}

          {mySuggestions.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mes suggestions envoyées</Text>
              {mySuggestions.map((s: any, i: number) => (
                <View key={s.id ?? i} style={styles.ideaRow}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.textSecondary} />
                  <Text style={styles.ideaText} numberOfLines={2}>{s.content}</Text>
                  <Text style={styles.ideaDate}>{new Date(s.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</Text>
                </View>
              ))}
            </View>
          )}

          {roadmapIdeas.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Idées en cours de développement</Text>
              {roadmapIdeas.map((item, i) => (
                <View
                  key={item.id}
                  style={[styles.ideaRow, i === roadmapIdeas.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <Ionicons name={(item.icon as any) ?? 'construct-outline'} size={20} color={COLORS.emerald} />
                  <Text style={styles.ideaText}>{item.title}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { padding: 4, marginRight: 12 },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
  card: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder,
    padding: 20, marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12, textAlign: 'center' },
  input: {
    backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: c.text, minHeight: 120, marginBottom: 16,
  },
  btn: { backgroundColor: c.emerald, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '700', color: c.bg },
  successCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.emerald + '40',
    padding: 24, marginBottom: 16, alignItems: 'center', gap: 12,
  },
  successTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  successText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
  ideaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
  ideaText: { flex: 1, fontSize: 13, color: c.text },
  ideaDate: { fontSize: 11, color: c.textSecondary },
  voteBadge: { backgroundColor: c.emerald + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  voteText: { fontSize: 11, fontWeight: '700', color: c.emerald },
});
}
