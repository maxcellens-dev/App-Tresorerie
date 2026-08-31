/**
 * Changer d'adresse e-mail (utilisateur connecté).
 *
 * ── POURQUOI UN ÉCRAN À PART, ET PAS UN CHAMP DANS LE PROFIL ────────────────────────────────────
 * L'adresse e-mail n'est pas un renseignement parmi d'autres : c'est l'IDENTIFIANT DE CONNEXION.
 * La changer se fait donc en trois temps, qu'il faut pouvoir expliquer — ce qu'un champ discret au
 * milieu d'un formulaire ne permet pas :
 *   1. on vérifie que c'est bien le titulaire (mot de passe actuel) ;
 *   2. Supabase envoie un lien à la NOUVELLE adresse (et, si la sécurité renforcée est activée dans
 *      le projet, également à l'ancienne : les deux doivent être ouverts) ;
 *   3. tant que le lien n'est pas ouvert, RIEN ne change — on continue de se connecter avec
 *      l'ancienne adresse. C'est le point que les gens comprennent le moins, donc celui qu'on écrit
 *      le plus gros.
 *
 * ⚠️ CÔTÉ SUPABASE : `relyka-app://profile` (et l'URL web équivalente) doit figurer dans
 *    Authentication → URL Configuration → Redirect URLs, sinon le lien de confirmation retombe sur
 *    le Site URL. Le changement fonctionne quand même — il se termine simplement dans un navigateur
 *    au lieu de l'app.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import PasswordInput from '../../../components/auth/PasswordInput';
import { supabase } from '../../../lib/platform/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import { checkNewEmail, normalizeEmail, canChangeEmail, EMAIL_MAX_LENGTH } from '../../../lib/auth/emailPolicy';
import { describeAuthError } from '../../../lib/auth/authErrors';

export default function ChangeEmailScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive();
  const goBack = useNavBack();
  const { user, realUser, isImpersonating } = useAuth();
  const submit = useSubmitLock();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Demande partie : on remplace le formulaire par la marche à suivre. */
  const [sentTo, setSentTo] = useState<string | null>(null);

  const currentEmail = user?.email ?? '';
  /* En consultation, la session reste celle de l'administrateur : une demande partirait sur SON
     compte, pas sur celui qui est affiché. Même garde que sur le reste du profil. */
  const readOnly = isImpersonating;
  const identities = (realUser as any)?.identities as { provider?: string }[] | undefined;
  const allowed = canChangeEmail(identities);

  async function save() {
    if (readOnly) return;
    const check = checkNewEmail(email, currentEmail);
    if (!check.valid) { setError(check.error ?? null); return; }
    if (!password) { setError('Saisis ton mot de passe actuel pour confirmer.'); return; }
    if (!supabase) { setError('Service indisponible pour le moment.'); return; }
    if (!submit.acquire()) return;
    setLoading(true);
    setError(null);
    try {
      /* VÉRIFICATION DU TITULAIRE. Changer l'adresse de connexion depuis un téléphone déverrouillé
         et laissé sans surveillance suffirait, sinon, à prendre le compte : la nouvelle adresse
         reçoit ensuite les réinitialisations de mot de passe. On revalide donc le mot de passe —
         c'est aussi ce que fait n'importe quelle banque avant de toucher aux coordonnées. */
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password,
      });
      if (authErr) {
        setError('Mot de passe incorrect.');
        return;
      }

      const next = normalizeEmail(email);
      /* Lien de retour vers l'APP après le clic (cf. AuthContext : `type=email_change`).
         Protégé : `createURL` lit le schéma déclaré côté natif, et rien ne garantit qu'il réponde
         partout (web, environnement de test, configuration incomplète). Sans ce garde, une simple
         erreur de fabrication d'URL bloquait tout l'envoi — bouton figé, aucun message. Sans lien
         de retour, Supabase retombe sur l'adresse du site : la confirmation se termine dans un
         navigateur au lieu de l'app. C'est moins agréable, mais ça marche. */
      /* ⚠️ `profile`, PAS `/(tabs)/(secondary)/profile`. Les segments entre parenthèses sont des
         GROUPES d'expo-router : ils organisent les fichiers, ils n'apparaissent pas dans l'adresse.
         Les inclure produisait une URL avec des parenthèses encodées (`%28tabs%29`), qui ne
         correspond à aucune route ET qu'il aurait fallu déclarer telle quelle côté Supabase.
         L'adresse réelle de cet écran est `/profile`. */
      let redirectTo: string | undefined;
      try { redirectTo = Linking.createURL('profile'); } catch { redirectTo = undefined; }
      const { error: updErr } = await supabase.auth.updateUser(
        { email: next },
        redirectTo ? { emailRedirectTo: redirectTo } : {},
      );
      if (updErr) throw updErr;
      setSentTo(next);
      setPassword('');
    } catch (e: unknown) {
      setError(describeAuthError(e).message);
    } finally {
      setLoading(false);
      submit.release();
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        <ScreenHeader title="Changer d'adresse e-mail" onBack={goBack} />
        <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>

          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>Adresse actuelle</Text>
            <Text style={styles.currentValue}>{currentEmail || '—'}</Text>
          </View>

          {readOnly ? (
            <View style={styles.notice}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Consultation seule : la demande partirait sur ton propre compte, pas sur celui que tu
                consultes. Quitte le mode consultation d'abord.
              </Text>
            </View>
          ) : !allowed ? (
            /* Compte Google : l'adresse vient de là-bas. La remplacer ici ne changerait pas la
               façon de se connecter — autant le dire clairement plutôt que d'offrir un bouton qui
               met le compte en désaccord avec lui-même. */
            <View style={styles.notice}>
              <Ionicons name="logo-google" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Ton compte utilise la connexion Google : c'est ton adresse Google qui t'identifie ici.
                Pour en changer, modifie-la dans ton compte Google — elle suivra à ta prochaine
                connexion.
              </Text>
            </View>
          ) : sentTo ? (
            <View style={styles.sentCard}>
              <Ionicons name="mail-unread-outline" size={30} color={COLORS.emerald} />
              <Text style={styles.sentTitle}>Vérifie ta boîte mail</Text>
              <Text style={styles.sentText}>
                Un lien de confirmation vient d'être envoyé à{' '}
                <Text style={styles.sentEmail}>{sentTo}</Text>. Ouvre-le pour valider le changement.
              </Text>
              <Text style={styles.sentText}>
                D'ici là, <Text style={styles.strong}>rien ne change</Text> : tu continues de te
                connecter avec {currentEmail}. Un message peut aussi t'être envoyé à cette adresse
                pour confirmer de son côté.
              </Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setSentTo(null)} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>Saisir une autre adresse</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.sub}>
                Tu recevras un lien de confirmation à ta nouvelle adresse. Le changement ne prend
                effet qu'une fois ce lien ouvert.
              </Text>

              <Text style={styles.label}>Nouvelle adresse e-mail</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={(v) => { setEmail(v); if (error) setError(null); }}
                placeholder="nouvelle@exemple.com"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                maxLength={EMAIL_MAX_LENGTH}
                accessibilityLabel="Nouvelle adresse e-mail"
              />

              <Text style={styles.label}>Ton mot de passe actuel</Text>
              <PasswordInput
                variant="current"
                colors={COLORS}
                style={styles.input}
                value={password}
                onChangeText={(v: string) => { setPassword(v); if (error) setError(null); }}
                placeholder="••••••••••••"
                placeholderTextColor={COLORS.textSecondary}
                onSubmitEditing={save}
                returnKeyType="go"
              />
              <Text style={styles.hint}>
                Demandé pour vérifier que c'est bien toi : la nouvelle adresse recevra ensuite les
                messages de connexion et de récupération de compte.
              </Text>

              {!!error && <Text style={styles.error}>{error}</Text>}

              <TouchableOpacity
                style={[styles.btn, loading && { opacity: 0.6 }]}
                onPress={save}
                disabled={loading}
                accessibilityRole="button"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                {loading
                  ? <ActivityIndicator color={COLORS.onAccent} />
                  : <Text style={styles.btnLabel}>Envoyer le lien de confirmation</Text>}
              </TouchableOpacity>
            </>
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    sub: { fontSize: 13, color: c.textSecondary, marginBottom: 22, lineHeight: 19 },
    currentCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, marginBottom: 18 },
    currentLabel: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    currentValue: { fontSize: 15, fontWeight: '600', color: c.text, marginTop: 4 },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: c.textSecondary },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 18, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: -8, marginBottom: 16 },
    error: { fontSize: 13, fontWeight: '600', color: c.danger, marginBottom: 14, lineHeight: 18 },
    btn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 2 },
    btnLabel: { fontSize: 16, fontWeight: '700', color: c.onAccent },
    sentCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.emerald + '40', borderRadius: 16, padding: 20, alignItems: 'center', gap: 10 },
    sentTitle: { fontSize: 17, fontWeight: '800', color: c.text },
    sentText: { fontSize: 13.5, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
    sentEmail: { fontWeight: '700', color: c.text },
    strong: { fontWeight: '700', color: c.text },
    secondaryBtn: { paddingVertical: 14, paddingHorizontal: 16, marginTop: 4 },
    secondaryLabel: { fontSize: 13.5, fontWeight: '700', color: c.accentText },
  });
}
