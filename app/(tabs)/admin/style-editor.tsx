import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../../hooks/useProfile';
import { supabase } from '../../lib/supabase';
import { useAppColors } from '../../hooks/useAppColors';


export default function StyleEditor() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [colors, setColors] = useState<Record<string, string>>({ primary: '#2563eb', background: '#ffffff', text: '#0f172a' });
  const [appName, setAppName] = useState('Relyka');
  const [tagline, setTagline] = useState("Laissez-vous guider pour faire les meilleurs choix pour vos économies.");
  // Polices : URL d'import (CSS / Google Fonts) + famille appliquée au nom de l'app.
  const [fontImportUrl, setFontImportUrl] = useState('');
  const [appNameFont, setAppNameFont] = useState('Arial Rounded MT Bold');
  const queryClient = useQueryClient();

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
          if (t.style?.font_import_url !== undefined) setFontImportUrl(t.style.font_import_url);
          if (t.style?.app_name_font !== undefined && t.style.app_name_font) setAppNameFont(t.style.app_name_font);
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
      // Préserver le reste du thème (theme.style : polices, presets, gradients…)
      const { data: existing } = await supabase.from('app_config').select('theme').eq('id', 'default').single();
      const existingTheme = (existing as any)?.theme ?? {};
      const payload = {
        theme: {
          ...existingTheme,
          colors,
          style: {
            ...(existingTheme.style ?? {}),
            font_import_url: fontImportUrl.trim(),
            app_name_font: appNameFont.trim(),
          },
        },
        texts: { appName, tagline },
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('app_config').update(payload).eq('id', 'default');
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['style_config'] });
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

            <Text style={styles.label}>Importer une police (URL CSS / Google Fonts)</Text>
            <TextInput
              style={styles.input}
              value={fontImportUrl}
              onChangeText={setFontImportUrl}
              placeholder="https://fonts.googleapis.com/css2?family=Pacifico&display=swap"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.help}>
              Collez le lien CSS d'une police (ex. Google Fonts « @import / link »). La police est chargée sur le web et devient utilisable ci-dessous.
            </Text>

            <Text style={styles.label}>Police du nom de l'app</Text>
            <TextInput
              style={styles.input}
              value={appNameFont}
              onChangeText={setAppNameFont}
              placeholder="Ex. Pacifico, Arial Rounded MT Bold"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.help}>
              Nom EXACT de la famille de police (tel qu'indiqué par la police importée). Appliqué au titre « {appName} » partout où il apparaît.
            </Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={[styles.smallLabel, { color: '#94a3b8' }]}>Aperçu :</Text>
              <Text style={{ fontSize: 28, color: COLORS.text, fontFamily: appNameFont.trim() || undefined }}>{appName}</Text>
            </View>

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

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  title: { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: 14 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 120 },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: c.cardBorder },
  label: { color: c.textSecondary, marginBottom: 8, fontWeight: '600' },
  help: { color: c.textSecondary, fontSize: 11, lineHeight: 16, marginTop: -2, marginBottom: 12 },
  smallLabel: { color: c.text, marginBottom: 6 },
  input: { backgroundColor: '#ffffff10', color: c.text, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#111', marginBottom: 8 },
  saveBtn: { marginTop: 12, backgroundColor: '#0ea5a8', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveLabel: { color: c.bg, fontWeight: '700' },
  message: { marginTop: 10 },
  text: { color: c.text },
});
}
