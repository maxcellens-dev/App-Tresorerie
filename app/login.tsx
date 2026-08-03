import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';

function showAlert(title: string, message: string) {
  // Dialogue in-app global (§7) — plus de pop-up navigateur.
  Alert.alert(title, message);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useBrandColors } from '../hooks/useBrandColors';
import SocialAuthButtons from '../components/SocialAuthButtons';
import { useKeyboardAwareScroll } from '../hooks/useKeyboardAwareScroll';
import { useResponsive } from '../hooks/useResponsive';
import { authPage, authCard } from '../lib/webLayout';


export default function LoginScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Bureau : le formulaire est centré VERTICALEMENT dans la fenêtre (app/_layout le centre déjà
  // horizontalement dans une colonne de 480 px) → page de connexion de site web, pas écran d'app.
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const { scrollRef, handleFocus, onScroll } = useKeyboardAwareScroll();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      showAlert('Champs requis', 'Renseignez email et mot de passe.');
      return;
    }
    setLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // onAuthStateChange met à jour le contexte → le guard dans _layout redirigera vers home
      } else {
        showAlert('Connexion', 'Backend non configuré. Utilise l\u2019app en mode démo.');
        router.back();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible.';
      if (msg.includes('Email not confirmed')) {
        showAlert('Email non confirmé', 'Vérifie ta boîte mail et clique sur le lien de confirmation avant de te connecter.');
      } else {
        showAlert('Erreur', msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0} style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingBottom: 32 }, authPage(isDesktop)]}>
          {/* Bureau : tout le formulaire vit dans une CARTE posée sur la page (cf. authCard). */}
          <View style={authCard(isDesktop, COLORS)}>
          <Text style={styles.title}>Connexion</Text>
          <Text style={styles.subtitle}>Accède à ta trésorerie sur tous tes appareils.</Text>

          {/* Connexion sociale (mise en avant) */}
          <SocialAuthButtons mode="login" />

          {/* Séparateur */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou avec une adresse e-mail</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              onFocus={handleFocus}
              placeholder="vous@exemple.fr"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput
              ref={passwordRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onFocus={handleFocus}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              <Text style={styles.btnLabel}>{loading ? 'Connexion…' : 'Se connecter par e-mail'}</Text>
            </TouchableOpacity>
            {/* L'ancienne mention « pas de récupération automatique, contacte un administrateur »
                était vraie tant qu'aucun SMTP n'était branché. Avec Brevo, le lien de
                réinitialisation part vraiment : la laisser aurait dissuadé de s'en servir. */}
            <Text style={styles.emailNote}>
              ℹ️ Tu recevras un e-mail pour confirmer ton adresse et pour réinitialiser ton mot de
              passe si tu l'oublies.
            </Text>
            <TouchableOpacity style={styles.link} onPress={() => router.push('/reset-password')}>
              <Text style={[styles.linkText, { color: COLORS.textSecondary }]}>Mot de passe oublié ?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={() => router.replace('/register')}>
              <Text style={styles.linkText}>Pas de compte ? S’inscrire</Text>
            </TouchableOpacity>
          </View>
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
