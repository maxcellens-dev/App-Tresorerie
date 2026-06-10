/**
 * Changement de mot de passe (utilisateur connecté). Met à jour via supabase.auth.updateUser.
 */
import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../components/ScreenGradient';
import { supabase } from '../../lib/supabase';
import { useAppColors } from '../../hooks/useAppColors';

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n${message}`);
  else Alert.alert(title, message);
}

export default function ChangePasswordScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (password.length < 6) { showAlert('Mot de passe', 'Au moins 6 caractères.'); return; }
    if (password !== confirm) { showAlert('Confirmation', 'Les deux mots de passe ne correspondent pas.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      showAlert('Mot de passe modifié', 'Votre mot de passe a été mis à jour.');
      router.back();
    } catch (e: unknown) {
      showAlert('Erreur', e instanceof Error ? e.message : 'Mise à jour impossible.');
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
          <Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Changer de mot de passe</Text>
        <Text style={styles.sub}>Choisissez un nouveau mot de passe pour votre compte.</Text>

        <Text style={styles.label}>Nouveau mot de passe (min. 6 caractères)</Text>
        <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={COLORS.textSecondary} secureTextEntry />
        <Text style={styles.label}>Confirmer</Text>
        <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="••••••••" placeholderTextColor={COLORS.textSecondary} secureTextEntry onSubmitEditing={save} returnKeyType="go" />

        <TouchableOpacity style={[styles.btn, loading && { opacity: 0.6 }]} onPress={save} disabled={loading}>
          <Text style={styles.btnLabel}>{loading ? 'Mise à jour…' : 'Mettre à jour'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 6 },
    sub: { fontSize: 13, color: c.textSecondary, marginBottom: 24, lineHeight: 18 },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 20, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    btn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
    btnLabel: { fontSize: 16, fontWeight: '700', color: '#fff' },
  });
}
