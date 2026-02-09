import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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

export default function StyleEditor() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [colors, setColors] = useState<Record<string, string>>({ primary: '#2563eb', background: '#ffffff', text: '#0f172a' });
  const [appName, setAppName] = useState('MyTreasury');
  const [tagline, setTagline] = useState("Votre santé financière en un coup d'œil");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.from('app_config').select('theme, texts').eq('id', 'default').single();
        if (data) {
          const t = (data as any).theme ?? {};
          const texts = (data as any).texts ?? {};
          setColors({ ...colors, ...(t.colors || {}) });
          setAppName(texts.appName ?? appName);
          setTagline(texts.tagline ?? tagline);
        }
        if (error) {
          console.warn('Supabase error', error);
        }
      } catch (e) {
        console.warn(e);
        setMessage('Erreur chargement config');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    if (!supabase) {
      setMessage('Supabase non configuré (EXPO_PUBLIC_SUPABASE_URL/ANON_KEY)');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        theme: { colors },
        texts: { appName, tagline },
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('app_config').update(payload).eq('id', 'default');
      if (error) throw error;
      setMessage('Config enregistrée. Les apps recevront la mise à jour au prochain sync.');
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Erreur lors de l’enregistrement');
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Style Editor (intégré)</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Nom de l'app</Text>
            <TextInput style={styles.input} value={appName} onChangeText={setAppName} />

            <Text style={styles.label}>Tagline</Text>
            <TextInput style={styles.input} value={tagline} onChangeText={setTagline} />

            <Text style={styles.label}>Couleurs (hex)</Text>
            {Object.keys(colors).map((k) => (
              <View key={k} style={{ marginBottom: 10 }}>
                <Text style={styles.smallLabel}>{k}</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ width: 36, height: 36, backgroundColor: colors[k] ?? '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#111' }} />
                  <TextInput style={[styles.input, { flex: 1 }]} value={colors[k]} onChangeText={(v) => setColors((c) => ({ ...c, [k]: v }))} />
                </View>
              </View>
            ))}

            <TouchableOpacity style={styles.saveBtn} onPress={handleSave} accessibilityRole="button" disabled={saving}>
              <Text style={styles.saveLabel}>{saving ? 'Enregistrement…' : 'Enregistrer dans Supabase'}</Text>
            </TouchableOpacity>
            {message && <Text style={[styles.message, message.startsWith('Erreur') ? { color: '#f43f5e' } : { color: '#10b981' }]}>{message}</Text>}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 14 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.cardBorder },
  label: { color: COLORS.textSecondary, marginBottom: 8, fontWeight: '600' },
  smallLabel: { color: COLORS.text, marginBottom: 6 },
  input: { backgroundColor: '#ffffff10', color: COLORS.text, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#111', marginBottom: 8 },
  saveBtn: { marginTop: 12, backgroundColor: '#0ea5a8', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveLabel: { color: COLORS.bg, fontWeight: '700' },
  message: { marginTop: 10 },
  text: { color: COLORS.text },
});
