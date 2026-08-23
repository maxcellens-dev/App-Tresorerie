import { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';

function showAlert(title: string, message: string) {
  // Dialogue in-app global (§7) — plus de pop-up navigateur.
  Alert.alert(title, message);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/platform/supabase';
import { useBrandColors } from '../hooks/theme/useBrandColors';
import SocialAuthButtons from '../components/auth/SocialAuthButtons';
import PasswordInput from '../components/auth/PasswordInput';
import { useKeyboardAwareScroll } from '../hooks/platform/useKeyboardAwareScroll';
import { useSubmitLock } from '../hooks/platform/useSubmitLock';
import { useResponsive } from '../hooks/theme/useResponsive';
import { authPage, authCard } from '../lib/ui/webLayout';
import { describeAuthError } from '../lib/auth/authErrors';


export default function LoginScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Bureau : le formulaire est centré VERTICALEMENT dans la fenêtre (app/_layout le centre déjà
  // horizontalement dans une colonne de 480 px) → page de connexion de site web, pas écran d'app.
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const { scrollRef, handleFocus, onScroll, keyboardPadding } = useKeyboardAwareScroll();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  /* `disabled={loading}` ne prend effet qu'au rendu SUIVANT : deux appuis rapprochés partaient tous
     les deux, et le second se faisait refuser par la limite de débit de Supabase — on annonçait donc
     « trop de tentatives » à quelqu'un qui n'en avait fait qu'une (cf. hooks/useSubmitLock). */
  const submit = useSubmitLock();

  // `router.back()` sans historique ne fait RIEN (arrivée directe par URL, lien profond) : le bouton
  // paraissait cassé. Même repli que le bouton « Retour » de l'en-tête.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));

  async function handleLogin() {
    if (!email.trim() || !password) {
      // L'app TUTOIE partout : ce « Renseignez » était le dernier vouvoiement de l'interface.
      showAlert('Champs requis', 'Renseigne ton e-mail et ton mot de passe.');
      return;
    }
    if (!submit.acquire()) return;
    setLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // onAuthStateChange met à jour le contexte → le guard dans _layout redirigera vers home
      } else {
        showAlert('Connexion', 'Backend non configuré. Utilise l\u2019app en mode démo.');
        goBack();
      }
    } catch (e: unknown) {
      // Messages traduits et partagés avec l'inscription (cf. lib/authErrors) : une adresse non
      // confirmée, un débit dépassé ou une panne réseau ne doivent plus sortir en anglais brut.
      showAlert('Connexion', describeAuthError(e).message);
    } finally {
      setLoading(false);
      submit.release();
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* PAS de KeyboardAvoidingView ici. Sur Android en edge-to-edge (targetSdk ≥ 35) la fenêtre
            n'est jamais redimensionnée : la lib décale au jugé, et surtout son décalage S'AJOUTAIT au
            `keyboardPadding` de useKeyboardAwareScroll — deux fois la hauteur du clavier de vide sous
            le formulaire, et le champ visé remonté trop haut (le calcul de scroll suppose une vue non
            redimensionnée). Un seul mécanisme, celui de la maison, comme sur /reset-password et
            /change-password. Cf. hooks/useKeyboardHeight. */}
        <View style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Retour">
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingBottom: 32 }, authPage(isDesktop), keyboardPadding]}>
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
              placeholder="toi@exemple.fr"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              // Sans ces deux indices, ni le trousseau ni le navigateur ne proposaient de remplir
              // l'identifiant — ni de l'enregistrer après une connexion réussie.
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
            <Text style={styles.label}>Mot de passe</Text>
            <PasswordInput
              ref={passwordRef}
              variant="current"
              colors={COLORS}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onFocus={handleFocus}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textSecondary}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              <Text style={styles.btnLabel}>{loading ? 'Connexion…' : 'Se connecter par e-mail'}</Text>
            </TouchableOpacity>
            {/* Note recentrée sur CE qui se passe ici. Elle annonçait « tu recevras un e-mail pour
                confirmer ton adresse » — sur l'écran de CONNEXION : cet e-mail-là appartient à
                l'inscription et n'arrivera jamais, on faisait donc attendre un message fantôme.
                (L'ancienne mention « pas de récupération automatique, contacte un administrateur »
                avait déjà sauté : avec Brevo, le lien de réinitialisation part vraiment.) */}
            <Text style={styles.emailNote}>
              ℹ️ Mot de passe oublié ? On t'envoie un lien pour en choisir un nouveau. Ton adresse
              doit avoir été confirmée à l'inscription.
            </Text>
            {/* `accessibilityRole` n'est pas décoratif ici : sur navigateur d'ordinateur, la feuille
                de style de public/index.html ne pose `cursor: pointer` que sur `[role="button"]`.
                Sans lui, tous ces liens gardaient le curseur « texte » — ils ne paraissaient pas
                cliquables sur la page la plus importante de l'app. */}
            <TouchableOpacity style={styles.link} onPress={() => router.push('/reset-password')} accessibilityRole="button">
              <Text style={[styles.linkText, { color: COLORS.textSecondary }]}>Mot de passe oublié ?</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={() => router.replace('/register')} accessibilityRole="button">
              <Text style={styles.linkText}>Pas de compte ? S’inscrire</Text>
            </TouchableOpacity>
          </View>
          </View>
          </ScrollView>
        </View>
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
