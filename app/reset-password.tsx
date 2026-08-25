/**
 * /reset-password — réinitialisation du mot de passe.
 * - Sans session de récupération : demande l'e-mail et envoie un lien de réinitialisation (Supabase).
 * - Avec session de récupération (arrivée via le lien e-mail) : saisie du nouveau mot de passe.
 *
 * ⚠️ ÉCRAN PRIORITAIRE : tant que `passwordRecovery` est levé, le garde d'app/_layout ramène ICI
 * depuis n'importe quelle page. Toute sortie doit donc BAISSER ce drapeau (cf. `leave`), sinon le
 * bouton « Retour » renvoie sur cet écran en boucle.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useResponsive } from '../hooks/theme/useResponsive';
import { authPage, authCard } from '../lib/ui/webLayout';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/platform/supabase';
import { useBrandColors } from '../hooks/theme/useBrandColors';
import { useAuth } from '../contexts/AuthContext';
import PasswordStrength from '../components/auth/PasswordStrength';
import PasswordInput from '../components/auth/PasswordInput';
import KeyboardAwareScrollView from '../components/layout/KeyboardAwareScrollView';
import { evaluatePassword } from '../lib/auth/passwordPolicy';
import { describeAuthError } from '../lib/auth/authErrors';
import { parseAuthLink } from '../lib/auth/authDeepLink';
import { useSubmitLock } from '../hooks/platform/useSubmitLock';

function showAlert(title: string, message: string) {
  Alert.alert(title, message); // in-app global (§7)
}

export default function ResetPasswordScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : carte centrée, comme login/inscription
  const router = useRouter();
  const { user, passwordRecovery, clearPasswordRecovery } = useAuth();
  const params = useLocalSearchParams<{ expired?: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  /* Le lien a expiré / a déjà servi : on bascule l'écran vers « redemande un lien » au lieu de
     laisser l'utilisateur retaper un mot de passe qui sera refusé à chaque fois.
     Trois façons d'arriver dans cet état :
       • natif — le lecteur de liens profonds (contexts/AuthContext) nous passe `expired=1` ;
       • web   — le refus reste dans l'URL (`#error_code=otp_expired`), que personne ne lisait :
                 l'écran affichait alors « Mot de passe oublié » comme si de rien n'était, et
                 l'utilisateur ne comprenait pas pourquoi son lien n'avait rien ouvert ;
       • en cours de route — l'enregistrement est refusé pour session périmée (cf. setNewPassword). */
  const [expired, setExpired] = useState(() => {
    if (params.expired === '1') return true;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
    const link = parseAuthLink(window.location.href);
    return link.kind === 'error' && link.expired;
  });
  // Deux appuis sur « Envoyer le lien » = deux e-mails, donc la limite de débit atteinte tout de
  // suite — et un message d'attente pour quelqu'un qui n'a cliqué qu'une fois (cf. useSubmitLock).
  const submit = useSubmitLock();

  /** Sortie propre : on ABAISSE le drapeau de récupération avant de naviguer.
   *  Sans lui, le garde d'app/_layout ramenait ici à la frame suivante — le bouton « Retour »
   *  paraissait mort, et il n'existait aucun moyen de quitter l'écran sans changer son mot de passe
   *  (ou tuer l'application). */
  const leave = () => {
    if (passwordRecovery) clearPasswordRecovery();
    // Le lien de récupération OUVRE une session : si elle existe, on entre dans l'app ; sinon on
    // revient à la connexion (ou d'où l'on vient).
    if (user) router.replace('/');
    else if (router.canGoBack()) router.back();
    else router.replace('/login');
  };

  async function sendLink() {
    if (!email.trim()) { showAlert('Email requis', 'Renseigne ton adresse e-mail.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    if (!submit.acquire()) return;
    setLoading(true);
    try {
      /* MOBILE : le lien doit rouvrir L'APP, pas le site.
         `redirectTo` valait `undefined` sur natif → Supabase retombait sur le Site URL, donc sur la
         version web : quelqu'un qui n'a que l'app installée devait finir sa réinitialisation dans un
         navigateur, se reconnecter là-bas, puis revenir. `relyka-app://reset-password` ramène dans
         l'app, où contexts/AuthContext ouvre la session de récupération.
         ⚠️ Cette URL doit être déclarée dans Supabase → Authentication → URL Configuration →
         Redirect URLs. Si elle ne l'est pas, Supabase l'ignore et retombe sur le Site URL : on
         revient au comportement précédent (le web), jamais à une panne. */
      const redirectTo = Platform.OS === 'web'
        ? (typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined)
        : Linking.createURL('reset-password');
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (error) throw error;
      setSent(true);
    } catch (e: unknown) {
      // Messages TRADUITS, comme sur la connexion et l'inscription (lib/auth/authErrors) : cet écran
      // sortait encore le texte brut de Supabase, en anglais (« For security purposes, you can only
      // request this after 47 seconds »), ce qui se lisait comme une panne.
      showAlert('Envoi impossible', describeAuthError(e).message);
    } finally { setLoading(false); submit.release(); }
  }

  async function setNewPassword() {
    const pwEval = evaluatePassword(password);
    if (!pwEval.valid) { showAlert('Mot de passe trop faible', pwEval.firstError ?? 'Choisis un mot de passe plus robuste.'); return; }
    if (password !== confirm) { showAlert('Confirmation', 'Les deux mots de passe ne correspondent pas.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    if (!submit.acquire()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      clearPasswordRecovery();
      showAlert('Mot de passe modifié', 'Ton mot de passe a été mis à jour.');
      router.replace('/');
    } catch (e: unknown) {
      const info = describeAuthError(e);
      // Lien périmé ou déjà utilisé : l'écran repasse en « demande de lien », sinon l'utilisateur
      // réessaie indéfiniment un enregistrement qui ne peut pas aboutir.
      if (info.recoveryExpired) { clearPasswordRecovery(); setExpired(true); setPassword(''); setConfirm(''); }
      showAlert('Mise à jour impossible', info.message);
    } finally { setLoading(false); submit.release(); }
  }

  // Formulaire « nouveau mot de passe » : uniquement avec une session de récupération valide.
  const showNewPasswordForm = passwordRecovery && !expired;

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* « Retour » HORS de la zone centrée : sinon il se centrerait avec la carte, au lieu de
            rester en haut à gauche comme sur les autres écrans d'authentification. */}
        <TouchableOpacity style={styles.back} onPress={leave} accessibilityRole="button" accessibilityLabel="Retour">
          <Ionicons name="arrow-back" size={24} color={COLORS.text} />
          <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>
            {showNewPasswordForm ? 'Plus tard' : 'Retour'}
          </Text>
        </TouchableOpacity>
        <KeyboardAwareScrollView
          style={styles.keyboard}
          contentContainerStyle={[{ flexGrow: 1, justifyContent: 'center' }, authPage(isDesktop)]}
          showsVerticalScrollIndicator={false}
        >
          {/* Bureau : le contenu vit dans une CARTE posée sur la page (cf. authCard). */}
          <View style={authCard(isDesktop, COLORS)}>
          {showNewPasswordForm ? (
            <>
              <Text style={styles.title}>Nouveau mot de passe</Text>
              <Text style={styles.subtitle}>Choisis un nouveau mot de passe pour ton compte.</Text>
              <Text style={styles.label}>Nouveau mot de passe</Text>
              <PasswordInput variant="new" colors={COLORS} style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••••••" placeholderTextColor={COLORS.textSecondary} />
              <PasswordStrength value={password} colors={COLORS} />
              <Text style={styles.label}>Confirmer</Text>
              <PasswordInput variant="new" colors={COLORS} style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="••••••••••••" placeholderTextColor={COLORS.textSecondary} onSubmitEditing={setNewPassword} returnKeyType="go" />
              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={setNewPassword}
                disabled={loading}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                <Text style={styles.btnLabel}>{loading ? 'Mise à jour…' : 'Mettre à jour'}</Text>
              </TouchableOpacity>
            </>
          ) : sent ? (
            <>
              <Text style={styles.title}>Lien envoyé</Text>
              <Text style={styles.subtitle}>
                Si un compte existe pour <Text style={{ fontWeight: '700', color: COLORS.text }}>{email.trim()}</Text>, un e-mail de réinitialisation vient de partir. Ouvre le lien pour choisir un nouveau mot de passe.
              </Text>
              {/* L'ancienne mention « la messagerie n'est pas toujours disponible (offre gratuite),
                  contacte un administrateur » datait d'avant le branchement de Brevo : elle était
                  FAUSSE, et elle dissuadait d'attendre l'e-mail — exactement ce que l'écran de
                  connexion avait déjà corrigé de son côté. */}
              <Text style={styles.note}>
                ℹ️ Rien reçu au bout de quelques minutes ? Regarde dans tes indésirables : l'e-mail
                y atterrit parfois. Le lien reste valable une heure.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => router.replace('/login')} accessibilityRole="button">
                <Text style={styles.btnLabel}>Retour à la connexion</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.title}>{expired ? 'Lien expiré' : 'Mot de passe oublié'}</Text>
              <Text style={styles.subtitle}>
                {expired
                  ? "Ce lien a expiré ou a déjà servi. Saisis ton e-mail pour en recevoir un nouveau."
                  : 'Saisis ton e-mail pour recevoir un lien de réinitialisation.'}
              </Text>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="toi@exemple.fr"
                placeholderTextColor={COLORS.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                onSubmitEditing={sendLink}
                returnKeyType="go"
              />
              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={sendLink}
                disabled={loading}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                <Text style={styles.btnLabel}>{loading ? 'Envoi…' : 'Envoyer le lien'}</Text>
              </TouchableOpacity>
              <Text style={styles.note}>
                ℹ️ Le lien arrive par e-mail et reste valable une heure. Pense à regarder dans tes
                indésirables.
              </Text>
            </>
          )}
          </View>
        </KeyboardAwareScrollView>
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
    btnLabel: { fontSize: 16, fontWeight: '700', color: c.onAccent },
    note: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 18 },
  });
}
