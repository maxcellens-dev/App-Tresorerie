/**
 * Admin — Pages légales (§P9). Édite le texte des pages « Confidentialité » et « Mentions légales ».
 * Laisser vide = afficher le contenu par défaut codé dans l'app.
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../../components/ScreenGradient';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useLegalContent, useSaveLegalContent } from '../../../../hooks/useLegalContent';

export default function AdminLegal() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const { data: loaded } = useLegalContent();
  const save = useSaveLegalContent();

  const [privacy, setPrivacy] = useState<string | null>(null);
  const [legal, setLegal] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && privacy === null) {
      setPrivacy(loaded.privacy ?? '');
      setLegal(loaded.legal ?? '');
    }
  }, [loaded]);

  if (privacy === null) {
    return <View style={styles.root}><SafeAreaView style={styles.safe} edges={['top']}><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }

  async function persist() {
    setMsg(null);
    try { await save.mutateAsync({ privacy: privacy?.trim() || undefined, legal: legal.trim() || undefined }); setMsg('Enregistré ✓'); }
    catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Erreur'); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Pages légales</Text>
        <Text style={styles.sub}>Remplace le texte affiché dans « Confidentialité » et « Mentions légales ». Laisser vide pour garder le contenu par défaut de l'app.</Text>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>
          <Text style={styles.label}>Politique de confidentialité</Text>
          <TextInput
            style={styles.area}
            value={privacy}
            onChangeText={setPrivacy}
            placeholder="(vide = contenu par défaut)"
            placeholderTextColor={COLORS.textSecondary}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Mentions légales</Text>
          <TextInput
            style={styles.area}
            value={legal}
            onChangeText={setLegal}
            placeholder="(vide = contenu par défaut)"
            placeholderTextColor={COLORS.textSecondary}
            multiline
            textAlignVertical="top"
          />

          <TouchableOpacity style={[styles.saveBtn, save.isPending && { opacity: 0.6 }]} onPress={persist} disabled={save.isPending}>
            {save.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveLabel}>Enregistrer</Text>}
          </TouchableOpacity>
          {msg && <Text style={[styles.msg, { color: msg.includes('Erreur') ? COLORS.danger : COLORS.emerald }]}>{msg}</Text>}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 22, fontWeight: '800', color: c.text },
    sub: { fontSize: 12, color: c.textSecondary, marginBottom: 14, lineHeight: 16 },
    label: { fontSize: 13, color: c.textSecondary, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    area: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, minHeight: 180,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
    saveLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
