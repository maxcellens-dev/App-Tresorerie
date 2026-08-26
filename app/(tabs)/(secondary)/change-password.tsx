/**
 * Changement de mot de passe (utilisateur connecté). Met à jour via supabase.auth.updateUser.
 *
 * ⚠️ MÊME POLITIQUE QUE PARTOUT AILLEURS (lib/auth/passwordPolicy). Cet écran exigeait « au moins
 * 6 caractères », alors que l'inscription et la réinitialisation en demandent 12 avec majuscule,
 * minuscule, chiffre et caractère spécial. Autrement dit : n'importe qui pouvait contourner toute la
 * politique en s'inscrivant avec un mot de passe robuste, puis en le remplaçant ici par « aaaaaa ».
 * Et si le serveur, lui, applique bien la règle (Supabase Auth → Policies), l'utilisateur recevait à
 * la place un refus en anglais sans savoir ce qu'on attendait de lui. Un seul juge : evaluatePassword.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/platform/supabase';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../lib/ui/webLayout';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useSubmitLock } from '../../../hooks/platform/useSubmitLock';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import PasswordStrength from '../../../components/auth/PasswordStrength';
import PasswordInput from '../../../components/auth/PasswordInput';
import { evaluatePassword, PASSWORD_MIN_LENGTH } from '../../../lib/auth/passwordPolicy';
import { describeAuthError } from '../../../lib/auth/authErrors';

function showAlert(title: string, message: string) {
  Alert.alert(title, message); // in-app global (§7)
}

export default function ChangePasswordScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const goBack = useNavBack();
  const { isImpersonating } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = useSubmitLock();

  /* ── GARDE-FOU D'IDENTITÉ — la même que « Supprimer mon compte » et « Changer d'adresse » ─────
     `supabase.auth.updateUser` agit sur la session RÉELLE, jamais sur le compte affiché à l'écran.
     En « connecté en tant que », un administrateur venu ici depuis le profil consulté changeait
     donc SON PROPRE mot de passe en croyant changer celui de la personne visitée — sans le moindre
     signe, et sans possibilité de revenir en arrière une fois l'ancien oublié. Les deux autres
     actions de compte portaient déjà ce garde-fou ; celle-ci était la seule à ne pas l'avoir. */
  const readOnly = isImpersonating;

  async function save() {
    if (readOnly) return;
    const pwEval = evaluatePassword(password);
    if (!pwEval.valid) { showAlert('Mot de passe trop faible', pwEval.firstError ?? 'Choisis un mot de passe plus robuste.'); return; }
    if (password !== confirm) { showAlert('Confirmation', 'Les deux mots de passe ne correspondent pas.'); return; }
    if (!supabase) { showAlert('Indisponible', 'Backend non configuré.'); return; }
    if (!submit.acquire()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      showAlert('Mot de passe modifié', 'Ton mot de passe a été mis à jour.');
      /* `router.back()` dépilait la pile imbriquée et pouvait atterrir n'importe où (cf. useNavBack,
         utilisé par le bouton « Retour » juste au-dessus) : on repart par le même chemin. */
      goBack();
    } catch (e: unknown) {
      // Message traduit et partagé avec les autres écrans d'authentification (lib/auth/authErrors) :
      // « New password should be different from the old password » ne disait rien à personne.
      showAlert('Mise à jour impossible', describeAuthError(e).message);
    } finally { setLoading(false); submit.release(); }
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'form')]} edges={[]}>
        {/* En-tête normalisé, comme les autres pages secondaires (le bouton « Retour » maison
            n'avait ni la même taille ni le même espacement que partout ailleurs). */}
        <ScreenHeader title="Changer de mot de passe" onBack={goBack} />
        <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {readOnly ? (
          <View style={styles.notice}>
            <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.noticeText}>
              Consultation seule : le changement porterait sur TON mot de passe, pas sur celui du
              compte que tu consultes. Quitte le mode consultation d'abord.
            </Text>
          </View>
        ) : (
        <>
        <Text style={styles.sub}>Choisis un nouveau mot de passe pour ton compte.</Text>

        <Text style={styles.label}>Nouveau mot de passe (min. {PASSWORD_MIN_LENGTH} caractères)</Text>
        <PasswordInput variant="new" colors={COLORS} style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••••••" placeholderTextColor={COLORS.textSecondary} />
        {/* La check-list dit CE QUI MANQUE pendant la frappe : sans elle, la règle des 12 caractères
            ne se découvrait qu'au moment du refus. */}
        <PasswordStrength value={password} colors={COLORS} />
        <Text style={styles.label}>Confirmer</Text>
        <PasswordInput variant="new" colors={COLORS} style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="••••••••••••" placeholderTextColor={COLORS.textSecondary} onSubmitEditing={save} returnKeyType="go" />

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={save}
          disabled={loading}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          <Text style={styles.btnLabel}>{loading ? 'Mise à jour…' : 'Mettre à jour'}</Text>
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
    sub: { fontSize: 13, color: c.textSecondary, marginBottom: 24, lineHeight: 18 },
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: c.textSecondary },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: c.text, marginBottom: 20, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    btn: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 6 },
    btnLabel: { fontSize: 16, fontWeight: '700', color: c.onAccent },
  });
}
