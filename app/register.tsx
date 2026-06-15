import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';

function showAlert(title: string, message: string) {
  // Dialogue in-app global (§7) — plus de pop-up navigateur.
  Alert.alert(title, message);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './lib/supabase';
import { useBrandColors } from './hooks/useBrandColors';
import SocialAuthButtons from './components/SocialAuthButtons';


export default function RegisterScreen() {
  const COLORS = useBrandColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  async function handleRegister() {
    if (!email.trim() || !password) {
      showAlert('Champs requis', 'Renseignez email et mot de passe.');
      return;
    }
    if (password.length < 6) {
      showAlert('Mot de passe', 'Au moins 6 caractères.');
      return;
    }
    setLoading(true);
    try {
      if (supabase) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) {
          showAlert('Inscription', 'Vérifiez votre email pour confirmer le compte.');
        }
        // Si session active, onAuthStateChange met à jour le contexte
        // et le guard dans _layout redirigera automatiquement vers home
      } else {
        showAlert('Inscription', 'Backend non configuré. Mode démo.');
        router.back();
      }
    } catch (e: unknown) {
      showAlert('Erreur', e instanceof Error ? e.message : 'Inscription impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Vos données seront synchronisées et sauvegardées.</Text>

          {/* Inscription sociale (mise en avant) */}
          <SocialAuthButtons mode="register" />

          {/* Séparateur cliquable : révèle la partie e-mail */}
          <TouchableOpacity style={styles.dividerRow} onPress={() => setShowEmail((v) => !v)} activeOpacity={0.7}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou avec une adresse e-mail</Text>
            <Ionicons name={showEmail ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
            <View style={styles.dividerLine} />
          </TouchableOpacity>

          <View style={styles.form}>
            {showEmail && (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="vous@exemple.fr"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                />
                <Text style={styles.label}>Mot de passe (min. 6 caractères)</Text>
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={COLORS.textSecondary}
                  secureTextEntry
                  returnKeyType="go"
                  onSubmitEditing={handleRegister}
                />
                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleRegister}
                  disabled={loading}
                >
                  <Text style={styles.btnLabel}>{loading ? 'Inscription…' : 'S’inscrire par e-mail'}</Text>
                </TouchableOpacity>
                <Text style={styles.emailNote}>
                  ℹ️ L'adresse e-mail n'est reliée à aucune messagerie : pas de récupération
                  automatique du mot de passe. En cas d'oubli, contactez un administrateur.
                </Text>
              </>
            )}
            <TouchableOpacity style={styles.link} onPress={() => router.replace('/login')}>
              <Text style={styles.linkText}>Déjà un compte ? Se connecter</Text>
            </TouchableOpacity>
          </View>
          </ScrollView>
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
  subtitle: { fontSize: 15, color: c.textSecondary, marginBottom: 32 },
  form: {},
  label: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
    marginBottom: 20,
  },
  btn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnLabel: { fontSize: 15, fontWeight: '700', color: c.text },
  emailNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.cardBorder },
  dividerText: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  link: { alignItems: 'center', marginTop: 20 },
  linkText: { fontSize: 14, color: c.emerald, fontWeight: '500' },
});
}
