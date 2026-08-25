/**
 * Admin — Pages légales (§P9). Édite le texte des pages « Confidentialité » et « Mentions légales ».
 * Laisser vide = afficher le contenu par défaut codé dans l'app.
 */
import React, { useMemo, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useLegalContent, useSaveLegalContent } from '../../../../hooks/config/useLegalContent';

export default function AdminLegal() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
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
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Pages légales" onBack={goBack} /><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
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
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Pages légales" onBack={goBack} />
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
    sub: { fontSize: 12, color: c.textSecondary, marginBottom: 14, lineHeight: 16 },
    label: { fontSize: 13, color: c.textSecondary, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    area: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 13, minHeight: 180,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
    },
    saveBtn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
    saveLabel: { color: c.onAccent, fontWeight: '700', fontSize: 15 },
    msg: { textAlign: 'center', marginTop: 10, fontWeight: '600' },
  });
}
