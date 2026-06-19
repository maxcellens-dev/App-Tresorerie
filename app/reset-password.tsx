/**
 * /reset-password — réinitialisation du mot de passe.
 * - Sans session de récupération : demande l'e-mail et envoie un lien de réinitialisation
 *   (Supabase). Message clair + repli « contactez un administrateur » (Supabase gratuit).
 * - Avec session de récupération (arrivée via le lien e-mail) : saisie du nouveau mot de passe.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useBrandColors } from '../hooks/useBrandColors';
import { useAuth } from '../contexts/AuthContext';

function showAlert(title: string, message: string) {
  Alert.alert(title, message); // in-app global (§7)
}

export default function ResetPasswordScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const router = useRouter();
  const { passwordRecovery, clearPasswordRecovery } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function sendLink() {
    if (!email.trim()) { showAlert('Email requis', 'Renseignez votre adresse e-mail.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    setLoading(true);
    try {
      const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;
      setSent(true);
    } catch (e: unknown) {
      showAlert('Erreur', e instanceof Error ? e.message : 'Envoi impossible.');
    } finally { setLoading(false); }
  }

  async function setNewPassword() {
    if (password.length < 6) { showAlert('Mot de passe', 'Au moins 6 caractères.'); return; }
    if (password !== confirm) { showAlert('Confirmation', 'Les deux mots de passe ne correspondent pas.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      clearPasswordRecovery();
      showAlert('Mot de passe modifié', 'Votre mot de passe a été mis à jour.');
      router.replace('/');
    } catch (e: unknown) {
      showAlert('Erreur', e instanceof Error ? e.message : 'Mise à jour impossible.');
    } finally { setLoading(false); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>

          {passwordRecovery ? (
            <>
              <Text style={styles.title}>Nouveau mot de passe</Text>
              <Text style={styles.subtitle}>Choisissez un nouveau mot de passe pour votre compte.</Text>
              <Text style={styles.label}>Nouveau mot de passe (min. 6 caractères)</Text>
              <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor={COLORS.textSecondary} secureTextEntry />
              <Text style={styles.label}>Confirmer</Text>
              <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="••••••••" placeholderTextColor={COLORS.textSecondary} secureTextEntry onSubmitEditing={setNewPassword} returnKeyType="go" />
              <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={setNewPassword} disabled={loading}>
                <Text style={styles.btnLabel}>{loading ? 'Mise à jour…' : 'Mettre à jour'}</Text>
              </TouchableOpacity>
            </>
          ) : sent ? (
            <>
              <Text style={styles.title}>Lien envoyé</Text>
              <Text style={styles.subtitle}>
                Si un compte existe pour <Text style={{ fontWeight: '700', color: COLORS.text }}>{email.trim()}</Text>, un e-mail de réinitialisation vient d'être envoyé. Cliquez sur le lien pour choisir un nouveau mot de passe.
              </Text>
              <Text style={styles.note}>
                ℹ️ Vous ne recevez rien ? La messagerie n'est pas toujours disponible (offre gratuite). Contactez un administrateur pour réinitialiser votre mot de passe manuellement.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => router.replace('/login')}>
                <Text style={styles.btnLabel}>Retour à la connexion</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>Mot de passe oublié</Text>
              <Text style={styles.subtitle}>Saisissez votre e-mail pour recevoir un lien de réinitialisation.</Text>
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="vous@exemple.fr" placeholderTextColor={COLORS.textSecondary} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} onSubmitEditing={sendLink} returnKeyType="go" />
              <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={sendLink} disabled={loading}>
                <Text style={styles.btnLabel}>{loading ? 'Envoi…' : 'Envoyer le lien'}</Text>
              </TouchableOpacity>
              <Text style={styles.note}>
                ℹ️ La récupération par e-mail n'est pas garantie (offre gratuite). En cas de problème, contactez un administrateur.
              </Text>
            </>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 24 },
    keyboard: { flex: 1 },
    back: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 24 },
    title: { fontSize: 28, fontWeight: '800', color: c.text, marginBottom: 8 },
    subtitle: { fontSize: 15, color: c.textSecondary, marginBottom: 28, lineHeight: 21 },
    label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 20, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    btn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnDisabled: { opacity: 0.6 },
    btnLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
    note: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 18 },
  });
}
