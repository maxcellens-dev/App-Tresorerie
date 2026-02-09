import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { supabase } from '../../../lib/supabase';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

export default function SEOCenter() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [seoData, setSeoData] = useState<Record<string, string>>({
    pageTitle: 'MyTreasury – Santé financière prédictive',
    pageDescription: 'Gérez vos comptes, catégories et transactions en mode offline-first.',
    keywords: 'trésorerie, finances, santé financière, offline-first',
  });

  useEffect(() => {
    if (!isAdmin) return;
    loadConfig();
  }, [isAdmin]);

  async function loadConfig() {
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('texts')
        .eq('id', 'default')
        .single();

      if (data && data.texts?.seo) {
        setSeoData(data.texts.seo as Record<string, string>);
      }
    } catch (e) {
      console.warn(e);
      setMessage('Erreur chargement config');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!supabase) {
      setMessage('Supabase non configuré');
      return;
    }
    setSaving(true);
    setMessage(null);

    try {
      const { error } = await supabase
        .from('app_config')
        .update({
          texts: { seo: seoData },
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'default');

      if (error) throw error;
      setMessage('✓ SEO config enregistrée.');
      Alert.alert('Succès', 'Configuration SEO enregistrée avec succès.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement';
      setMessage(`✗ ${msg}`);
      Alert.alert('Erreur', msg);
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={COLORS.emerald} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>SEO Center</Text>
          <Text style={styles.subtitle}>Modifiez les titres, descriptions et mots-clés pour le référencement.</Text>

          <View style={styles.card}>
            {Object.keys(seoData).map((key) => (
              <View key={key} style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{key}</Text>
                <TextInput
                  style={styles.input}
                  value={seoData[key]}
                  onChangeText={(val) => setSeoData((d) => ({ ...d, [key]: val }))}
                  multiline={false}
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
            ))}

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              <Ionicons name="checkmark" size={18} color={COLORS.bg} style={{ marginRight: 6 }} />
              <Text style={styles.saveLabel}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
            </TouchableOpacity>

            {message && (
              <Text style={[styles.message, message.startsWith('✗') ? { color: '#ef4444' } : { color: COLORS.emerald }]}>
                {message}
              </Text>
            )}
          </View>
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.cardBorder },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: '#ffffff10', color: COLORS.text, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: COLORS.cardBorder, fontSize: 14 },
  saveBtn: { marginTop: 20, backgroundColor: COLORS.emerald, paddingVertical: 12, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  saveLabel: { color: COLORS.bg, fontWeight: '700', fontSize: 16 },
  message: { marginTop: 14, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  text: { color: COLORS.text },
});
