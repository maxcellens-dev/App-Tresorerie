import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

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
  const { user } = useAuth();
  const [idea, setIdea] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const { data: mySuggestions = [] } = useSuggestions(user?.id);
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
          <Text style={styles.title}>Boîte à idées</Text>
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

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Idées populaires en cours</Text>
            {[
              { icon: 'card-outline', text: 'Import automatique des relevés bancaires', votes: 42 },
              { icon: 'notifications-outline', text: 'Alertes quand un budget est dépassé', votes: 38 },
              { icon: 'bar-chart-outline', text: 'Comparaison mois par mois', votes: 31 },
              { icon: 'people-outline', text: 'Compte partagé en couple', votes: 27 },
            ].map((item, i) => (
              <View key={i} style={styles.ideaRow}>
                <Ionicons name={item.icon as any} size={20} color={COLORS.textSecondary} />
                <Text style={styles.ideaText}>{item.text}</Text>
                <View style={styles.voteBadge}>
                  <Text style={styles.voteText}>{item.votes}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.cardBorder,
    padding: 20, marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 12, textAlign: 'center' },
  input: {
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: COLORS.text, minHeight: 120, marginBottom: 16,
  },
  btn: { backgroundColor: COLORS.emerald, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '700', color: COLORS.bg },
  successCard: {
    backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.emerald + '40',
    padding: 24, marginBottom: 16, alignItems: 'center', gap: 12,
  },
  successTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text },
  successText: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  ideaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  ideaText: { flex: 1, fontSize: 13, color: COLORS.text },
  ideaDate: { fontSize: 11, color: COLORS.textSecondary },
  voteBadge: { backgroundColor: COLORS.emerald + '20', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  voteText: { fontSize: 11, fontWeight: '700', color: COLORS.emerald },
});
