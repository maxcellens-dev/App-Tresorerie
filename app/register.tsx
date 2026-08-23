import { useEffect, useMemo, useRef, useState } from 'react';
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
import PasswordStrength from '../components/auth/PasswordStrength';
import { evaluatePassword } from '../lib/auth/passwordPolicy';
import { describeAuthError } from '../lib/auth/authErrors';


export default function RegisterScreen() {
  const COLORS = useBrandColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Bureau : formulaire centré verticalement (cf. app/login).
  const { isDesktop } = useResponsive();
  const router = useRouter();
  const { scrollRef, handleFocus, onScroll, keyboardPadding } = useKeyboardAwareScroll();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  /* L'issue de l'inscription se joue DANS l'écran, pas dans un dialogue : un modal par-dessus le
     formulaire se lit comme une erreur alors que c'est l'étape suivante du parcours. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  /* Renvoi de l'e-mail : COMPTE À REBOURS, pas un verrou définitif.
     Le bouton restait grisé pour toujours après un seul renvoi ; quelqu'un dont l'e-mail se perd
     vraiment (filtre, boîte pleine, faute de frappe côté serveur) n'avait plus AUCUN recours dans
     l'écran — il fallait quitter et recommencer une inscription. On respecte la limite de débit de
     Supabase (~60 s sur la même adresse) et on la rend visible plutôt que de la subir. */
  const RESEND_COOLDOWN_S = 60;
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [cooldown, setCooldown] = useState(0);
  /* Deux appuis rapprochés sur « S'inscrire » partaient tous les deux : le 2ᵉ se faisait répondre
     « un compte existe déjà » (le 1ᵉʳ venait de le créer) ou « trop de demandes » — un message
     alarmant et faux, affiché PAR-DESSUS l'écran « vérifie ta boîte mail ». Cf. useSubmitLock. */
  const submit = useSubmitLock();

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/welcome'));

  useEffect(() => {
    if (resentAt === null) return;
    const tick = () => {
      const left = Math.max(0, RESEND_COOLDOWN_S - Math.floor((Date.now() - resentAt) / 1000));
      setCooldown(left);
      return left;
    };
    if (tick() === 0) return;
    const id = setInterval(() => { if (tick() === 0) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [resentAt]);

  async function handleRegister() {
    setFormError(null);
    setExisting(false);
    if (!email.trim() || !password) {
      setFormError('Renseigne ton e-mail et un mot de passe.');
      return;
    }
    const pwEval = evaluatePassword(password);
    if (!pwEval.valid) {
      setFormError(pwEval.firstError ?? 'Choisis un mot de passe plus robuste.');
      return;
    }
    if (!submit.acquire()) return;
    setLoading(true);
    try {
      if (supabase) {
        const addr = email.trim();
        const { data, error } = await supabase.auth.signUp({ email: addr, password });
        if (error) throw error;
        /* Compte DÉJÀ EXISTANT : avec la protection contre l'énumération d'adresses (activée par
           défaut côté Supabase), `signUp` ne renvoie AUCUNE erreur — il renvoie un utilisateur
           factice sans identité rattachée. Sans ce test, on enchaînait sur « vérifie ton e-mail »
           pour un e-mail qui n'en recevra jamais : l'utilisateur attendait un message fantôme. */
        if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
          setExisting(true);
          setFormError('Un compte existe déjà avec cette adresse.');
          return;
        }
        /* ⚠️ GARDE-FOU : on n'annonce « vérifie ton mail » QUE si le serveur a bien rendu un
           utilisateur. Ni session ni utilisateur = rien n'a été créé ; annoncer la confirmation
           dans ce cas, c'est envoyer quelqu'un attendre indéfiniment un e-mail qui n'existe pas —
           avec, au bout, un compte introuvable partout (ni `auth.users`, ni `profiles`). */
        if (!data.session && !data.user) {
          setFormError("La création du compte n'a pas abouti : rien n'a été enregistré. Réessaie dans quelques instants.");
          return;
        }
        if (!data.session) setSentTo(addr);
        // Si session active, onAuthStateChange met à jour le contexte
        // et le guard dans _layout redirigera automatiquement vers home
      } else {
        showAlert('Inscription', 'Backend non configuré. Mode démo.');
        goBack();
      }
    } catch (e: unknown) {
      /* Message TRADUIT et actionnable (cf. lib/authErrors) : une inscription annulée par le
         serveur — quota d'envoi, e-mail non parti, échec de création — doit dire noir sur blanc
         que le compte n'existe pas, sans quoi l'utilisateur repart en attendant un e-mail
         fantôme. C'est ce silence qui a produit des comptes introuvables. */
      const info = describeAuthError(e);
      setExisting(!!info.alreadyExists);
      setFormError(info.message);
    } finally {
      setLoading(false);
      submit.release();
    }
  }

  async function resendEmail() {
    if (!supabase || !sentTo || cooldown > 0) return;
    if (!submit.acquire()) return;
    setFormError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: sentTo });
      if (error) throw error;
      setResentAt(Date.now());
    } catch (e: unknown) {
      // Le renvoi retombe sur la même limite de débit que l'inscription : on l'annonce en clair
      // (« attends N secondes ») plutôt que de laisser croire à une panne.
      setFormError(describeAuthError(e).message);
    } finally {
      setLoading(false);
      submit.release();
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Pas de KeyboardAvoidingView : elle DOUBLAIT le `keyboardPadding` de
            useKeyboardAwareScroll (cf. app/login.tsx pour le détail). */}
        <View style={styles.keyboard}>
          <TouchableOpacity style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Retour">
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingBottom: 32 }, authPage(isDesktop), keyboardPadding]}>
          {/* Bureau : tout le formulaire vit dans une CARTE posée sur la page (cf. authCard). */}
          <View style={authCard(isDesktop, COLORS)}>
          {sentTo ? (
            /* Étape suivante du parcours, pas un incident : l'écran ENTIER devient la confirmation. */
            <View>
              <View style={styles.sentIcon}><Ionicons name="mail-open-outline" size={30} color={COLORS.emerald} /></View>
              <Text style={styles.title}>Vérifie ta boîte mail</Text>
              <Text style={styles.subtitle}>
                On vient d'envoyer un lien de confirmation à <Text style={styles.sentMail}>{sentTo}</Text>.
                Ouvre-le pour activer ton compte, puis reviens te connecter.
              </Text>
              <Text style={styles.emailNote}>
                ℹ️ Rien reçu au bout de quelques minutes ? Regarde dans les indésirables — l'e-mail
                arrive parfois là.
              </Text>
              {formError && <Text style={styles.errorText}>{formError}</Text>}
              {resentAt !== null && <Text style={styles.okText}>E-mail renvoyé.</Text>}
              <TouchableOpacity
                style={[styles.btn, (loading || cooldown > 0) && styles.btnDisabled]}
                onPress={resendEmail}
                disabled={loading || cooldown > 0}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading || cooldown > 0, busy: loading }}
              >
                <Text style={styles.btnLabel}>
                  {loading ? 'Envoi…' : cooldown > 0 ? `Renvoyer dans ${cooldown} s` : 'Renvoyer l’e-mail'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.link} onPress={() => router.replace('/login')} accessibilityRole="button">
                <Text style={styles.linkText}>Aller à la connexion</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.subtitle}>Tes données seront synchronisées et sauvegardées.</Text>

          {/* Inscription sociale (mise en avant) */}
          <SocialAuthButtons mode="register" />

          {/* L'e-mail est un moyen d'inscription À PART ENTIÈRE, plus une petite ligne repliée sous
              les boutons sociaux : depuis que le SMTP est branché, il donne accès à la vérification
              d'adresse et à la récupération de mot de passe — c'est-à-dire au compte le plus
              robuste des trois. Il a donc le même bouton que Google et Facebook. */}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>ou</Text>
            <View style={styles.dividerLine} />
          </View>
          {!showEmail && (
            <TouchableOpacity style={styles.emailBtn} onPress={() => setShowEmail(true)} activeOpacity={0.85} accessibilityRole="button">
              <Ionicons name="mail-outline" size={20} color={COLORS.text} />
              <Text style={styles.emailBtnLabel}>Continuer avec un e-mail</Text>
            </TouchableOpacity>
          )}

          <View style={styles.form}>
            {showEmail && (
              <>
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
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                />
                <Text style={styles.label}>Mot de passe</Text>
                {/* Œil « afficher » indispensable ici : la politique exige 12 caractères avec
                    majuscule, minuscule, chiffre ET caractère spécial — impossible à saisir de
                    façon fiable à l'aveugle sur un clavier de téléphone. */}
                <PasswordInput
                  ref={passwordRef}
                  variant="new"
                  colors={COLORS}
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={handleFocus}
                  placeholder="••••••••••••"
                  placeholderTextColor={COLORS.textSecondary}
                  returnKeyType="go"
                  onSubmitEditing={handleRegister}
                />
                <PasswordStrength value={password} colors={COLORS} />
                {formError && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={16} color={COLORS.danger} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.errorText}>{formError}</Text>
                      {existing && (
                        <TouchableOpacity onPress={() => router.replace('/login')} style={{ marginTop: 6 }} accessibilityRole="button">
                          <Text style={styles.linkText}>Se connecter avec cette adresse</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleRegister}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loading, busy: loading }}
                >
                  <Text style={styles.btnLabel}>{loading ? 'Inscription…' : 'S’inscrire par e-mail'}</Text>
                </TouchableOpacity>
                <Text style={styles.emailNote}>
                  ℹ️ Tu recevras un e-mail pour confirmer ton adresse. C'est elle qui te permettra de
                  réinitialiser ton mot de passe si tu l'oublies.
                </Text>
              </>
            )}
            <TouchableOpacity style={styles.link} onPress={() => router.replace('/login')} accessibilityRole="button">
              <Text style={styles.linkText}>Déjà un compte ? Se connecter</Text>
            </TouchableOpacity>
          </View>
          </>
          )}
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
  // Même gabarit que les boutons sociaux (SocialAuthButtons) : trois moyens, trois boutons.
  emailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card,
    borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  emailBtnLabel: { fontSize: 15, fontWeight: '700', color: c.text },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.danger + '14', borderWidth: 1, borderColor: c.danger + '55', borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText: { fontSize: 13, color: c.danger, lineHeight: 18, flexShrink: 1 },
  okText: { fontSize: 13, color: c.emerald, marginTop: 10, fontWeight: '600' },
  sentIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald + '1e', marginBottom: 16 },
  sentMail: { color: c.text, fontWeight: '700' },
  link: { alignItems: 'center', marginTop: 20 },
  linkText: { fontSize: 14, color: c.emerald, fontWeight: '500' },
});
}
