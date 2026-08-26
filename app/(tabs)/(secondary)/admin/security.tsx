/**
 * Admin — CENTRE DE SÉCURITÉ.
 *  1) Coupure globale (kill switch) : verrouille l'app pour tous les users en cas d'attaque/piratage.
 *  2) Crashs & erreurs : journal remonté par les appareils (client_errors), résolution & purge.
 *  3) Mots de passe : réinitialisation manuelle d'un compte e-mail (repli sans messagerie).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator, Switch, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useFeatureFlags, useSaveFeatureFlags } from '../../../../hooks/config/useFeatureFlags';
import { useClientErrors, useResolveClientError, useResolveAllClientErrors, usePurgeClientErrors, useAdminSetPassword, useClientErrorsRealtime, type ClientError } from '../../../../hooks/platform/useSecurity';
import PasswordStrength from '../../../../components/auth/PasswordStrength';
import { evaluatePassword } from '../../../../lib/auth/passwordPolicy';
import KeyboardAwareScrollView from '../../../../components/layout/KeyboardAwareScrollView';

export default function AdminSecurity() {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée, comme les autres pages admin
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  useClientErrorsRealtime(isAdmin);

  if (!isAdmin) {
    return (
      <View style={s.root}><StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={[s.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Centre de sécurité" onBack={goBack} /><Text style={s.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[s.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Centre de sécurité" onBack={goBack} />
        <KeyboardAwareScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={s.subtitle}>Coupure globale, détection des erreurs et gestion des mots de passe.</Text>

          <LockdownCard c={COLORS} s={s} />
          <ErrorsCard c={COLORS} s={s} />
          <PasswordResetCard c={COLORS} s={s} />
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ── 1) COUPURE GLOBALE ─────────────────────────────────────────────────── */
function LockdownCard({ c, s }: { c: any; s: any }) {
  const { data: flags } = useFeatureFlags();
  const save = useSaveFeatureFlags();
  const locked = Boolean(flags?.app_lockdown_enabled);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);

  // Initialise les champs depuis la config.
  React.useEffect(() => {
    if (!flags) return;
    setTitle(flags.app_lockdown_title ?? '');
    setMessage(flags.app_lockdown_message ?? '');
  }, [flags]);

  /* ⚠️ LA COUPURE GLOBALE NE DOIT JAMAIS ÉCHOUER EN SILENCE. C'est le geste qu'on fait en
     urgence, pendant une attaque : l'écriture partait sans aucun retour d'erreur, et l'écran ne
     change d'état qu'une fois les drapeaux relus. Si elle échouait, l'administrateur repartait
     convaincu d'avoir verrouillé l'application alors que tous les utilisateurs y avaient encore
     un accès complet — et rien à l'écran ne l'aurait détrompé. */
  const onLockdownError = (e: unknown) => Alert.alert(
    'La coupure n’a PAS été appliquée',
    `L'application n'a pas changé d'état : ${e instanceof Error ? e.message : 'écriture refusée'}. Vérifie ta connexion et recommence — n'en conclus rien tant que la ligne ci-dessus n'affiche pas « ACTIVE ».`,
  );

  const toggle = () => {
    if (!locked) {
      Alert.alert(
        'Activer la coupure globale ?',
        "Tous les utilisateurs (sauf les admins) seront IMMÉDIATEMENT bloqués : voile plein écran, aucune interaction possible. À n'utiliser qu'en cas d'attaque ou de piratage en cours.",
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Verrouiller l\'app', style: 'destructive', onPress: () => save.mutate({ app_lockdown_enabled: true }, { onError: onLockdownError }) },
        ],
      );
    } else {
      Alert.alert('Réactiver l\'app ?', 'Les utilisateurs retrouveront l\'accès immédiatement.', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réactiver', onPress: () => save.mutate({ app_lockdown_enabled: false }, { onError: onLockdownError }) },
      ]);
    }
  };

  const saveTexts = () => save.mutate(
    { app_lockdown_title: title.trim() || undefined, app_lockdown_message: message.trim() || undefined },
    {
      onSuccess: () => { setSavedMsg(true); setTimeout(() => setSavedMsg(false), 1500); },
      onError: (e: unknown) => Alert.alert('Un souci', e instanceof Error ? e.message : "Ces textes n'ont pas pu être enregistrés."),
    },
  );

  return (
    <View style={[s.card, locked && s.cardDanger]}>
      <View style={s.cardHead}>
        <View style={[s.dot, { backgroundColor: locked ? c.danger : c.success }]} />
        <Text style={s.cardTitle}>Coupure globale {locked ? '· ACTIVE' : '· inactive'}</Text>
      </View>
      <Text style={s.cardDesc}>
        Bouton d'arrêt d'urgence. Une fois activé, l'app est verrouillée pour tous les utilisateurs
        jusqu'à réactivation — utile pour stopper net un incident (attaque, fuite, piratage).
      </Text>

      <TouchableOpacity style={[s.bigBtn, { backgroundColor: locked ? c.success : c.danger }]} onPress={toggle} disabled={save.isPending}>
        <Ionicons name={locked ? 'lock-open' : 'lock-closed'} size={18} color="#fff" />
        <Text style={s.bigBtnTxt}>{save.isPending ? '…' : locked ? 'Réactiver l\'application' : 'VERROUILLER l\'application'}</Text>
      </TouchableOpacity>

      <Text style={[s.label, { marginTop: 16 }]}>Titre affiché aux utilisateurs (optionnel)</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="Application temporairement indisponible" placeholderTextColor={c.textSecondary} />
      <Text style={s.label}>Message (optionnel)</Text>
      <TextInput style={[s.input, s.area]} value={message} onChangeText={setMessage} placeholder="Nous avons momentanément suspendu l'accès pour protéger tes données…" placeholderTextColor={c.textSecondary} multiline />
      <TouchableOpacity style={s.secondaryBtn} onPress={saveTexts}>
        <Text style={s.secondaryTxt}>{savedMsg ? '✓ Enregistré' : 'Enregistrer le message'}</Text>
      </TouchableOpacity>

      <Text style={s.hint}>
        ℹ️ Le verrou bloque l'app côté client. Contre une attaque frappant directement l'API, complète
        par la mise en pause du projet Supabase et la rotation des clés (cf. docs/SECURITY.md).
      </Text>
    </View>
  );
}

/* ── 2) CRASHS & ERREURS ────────────────────────────────────────────────── */
function ErrorsCard({ c, s }: { c: any; s: any }) {
  const [onlyOpen, setOnlyOpen] = useState(true);
  const { data: errors = [], isLoading } = useClientErrors(onlyOpen);
  const resolve = useResolveClientError();
  const resolveAll = useResolveAllClientErrors();
  const purge = usePurgeClientErrors();
  const [expanded, setExpanded] = useState<string | null>(null);

  const fatal = errors.filter((e) => e.kind === 'fatal').length;
  const openCount = errors.filter((e) => !e.resolved).length;
  const busy = resolveAll.isPending || purge.isPending;

  const doPurge = () => Alert.alert('Purger les anciennes erreurs ?', 'Supprime les entrées de plus de 30 jours.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Purger', style: 'destructive', onPress: () => purge.mutate(30, { onSuccess: (n) => Alert.alert('Purge', `${n} entrée(s) supprimée(s).`) }) },
  ]);

  /* Actions de MASSE. Après une vague de crashs déjà corrigés, la seule sortie était de cocher les
     entrées une par une (et la purge ne mordait que sur les plus de 30 jours, donc jamais sur
     celles qui venaient d'arriver). */
  const doResolveAll = () => Alert.alert(
    'Tout marquer comme résolu ?',
    'Toutes les erreurs encore ouvertes passent en résolu. Rien n\'est supprimé : elles restent consultables en décochant le filtre.',
    [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Tout résoudre', onPress: () => resolveAll.mutate(undefined, {
        onSuccess: (n) => Alert.alert('Résolues', `${n} entrée(s) marquée(s) comme résolue(s).`),
        onError: (e) => Alert.alert('Échec', e.message),
      }) },
    ],
  );

  const doPurgeAll = () => Alert.alert(
    'Tout supprimer ?',
    'Supprime DÉFINITIVEMENT tout le journal d\'erreurs, y compris les entrées récentes et non résolues. Irréversible.',
    [
      { text: 'Annuler', style: 'cancel' },
      // 0 jour → borne = maintenant → toutes les entrées sont antérieures.
      { text: 'Tout supprimer', style: 'destructive', onPress: () => purge.mutate(0, {
        onSuccess: (n) => Alert.alert('Journal vidé', `${n} entrée(s) supprimée(s).`),
        onError: (e) => Alert.alert('Échec', e.message),
      }) },
    ],
  );

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Ionicons name="bug-outline" size={18} color={c.text} />
        <Text style={s.cardTitle}>Crashs & erreurs</Text>
      </View>
      <View style={s.statRow}>
        <View style={s.stat}><Text style={[s.statNum, { color: c.danger }]}>{fatal}</Text><Text style={s.statLbl}>fatales</Text></View>
        <View style={s.stat}><Text style={s.statNum}>{errors.length}</Text><Text style={s.statLbl}>{onlyOpen ? 'ouvertes' : 'affichées'}</Text></View>
      </View>

      <View style={s.filterRow}>
        <Text style={s.filterLbl}>Uniquement non résolues</Text>
        <Switch value={onlyOpen} onValueChange={setOnlyOpen} trackColor={{ true: c.emerald }} />
      </View>

      {isLoading ? (
        <ActivityIndicator color={c.textSecondary} style={{ marginVertical: 16 }} />
      ) : errors.length === 0 ? (
        <Text style={s.empty}>Aucune erreur {onlyOpen ? 'ouverte' : ''} — tout va bien. 🎉</Text>
      ) : (
        errors.map((e) => (
          <ErrorRow key={e.id} e={e} c={c} s={s} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} onResolve={() => resolve.mutate({ id: e.id, resolved: !e.resolved }, { onError: (err: unknown) => Alert.alert('Un souci', err instanceof Error ? err.message : "L'entrée n'a pas pu être mise à jour.") })} />
        ))
      )}

      {errors.length > 0 && (
        <View style={{ gap: 8, marginTop: 8 }}>
          {openCount > 0 && (
            <TouchableOpacity style={s.secondaryBtn} onPress={doResolveAll} disabled={busy}>
              <Text style={s.secondaryTxt}>Tout marquer comme résolu</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.secondaryBtn} onPress={doPurge} disabled={busy}>
            <Text style={s.secondaryTxt}>Purger les entrées {'>'} 30 jours</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.secondaryBtn} onPress={doPurgeAll} disabled={busy}>
            <Text style={[s.secondaryTxt, { color: c.danger }]}>Tout supprimer</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function ErrorRow({ e, c, s, expanded, onToggle, onResolve }: { e: ClientError; c: any; s: any; expanded: boolean; onToggle: () => void; onResolve: () => void }) {
  const kindColor = e.kind === 'fatal' ? c.danger : e.kind === 'unhandled_rejection' ? c.warning : c.textSecondary;
  const when = new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <View style={s.errRow}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={{ flex: 1 }}>
        <View style={s.errHead}>
          <View style={[s.kindPill, { borderColor: kindColor }]}><Text style={[s.kindTxt, { color: kindColor }]}>{e.kind}</Text></View>
          <Text style={s.errMeta}>{e.platform ?? '—'} · v{e.app_version ?? '—'} · {when}</Text>
        </View>
        <Text style={s.errMsg} numberOfLines={expanded ? undefined : 2}>{e.message}</Text>
        {!!e.route && <Text style={s.errRoute}>↳ {e.route}</Text>}
        {expanded && !!e.stack && <Text style={s.errStack}>{e.stack}</Text>}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={e.resolved ? 'Rouvrir l\'incident' : 'Marquer comme résolu'} onPress={onResolve} hitSlop={8} style={s.resolveBtn}>
        <Ionicons name={e.resolved ? 'refresh-outline' : 'checkmark-circle-outline'} size={22} color={e.resolved ? c.textSecondary : c.success} />
      </TouchableOpacity>
    </View>
  );
}

/* ── 3) RÉINITIALISATION MOT DE PASSE ──────────────────────────────────── */
function PasswordResetCard({ c, s }: { c: any; s: any }) {
  const setPw = useAdminSetPassword();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const evalr = evaluatePassword(password);

  const submit = () => {
    if (!email.trim()) { Alert.alert('E-mail requis', 'Renseigne l\'e-mail du compte.'); return; }
    if (!evalr.valid) { Alert.alert('Mot de passe trop faible', evalr.firstError ?? ''); return; }
    setPw.mutate({ email: email.trim(), password }, {
      onSuccess: () => { Alert.alert('Mot de passe réinitialisé', `Le compte ${email.trim()} peut se connecter avec le nouveau mot de passe.`); setEmail(''); setPassword(''); },
      onError: (err: any) => Alert.alert('Échec', err?.message ?? 'Erreur'),
    });
  };

  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Ionicons name="key-outline" size={18} color={c.text} />
        <Text style={s.cardTitle}>Réinitialiser un mot de passe</Text>
      </View>
      <Text style={s.cardDesc}>
        Pour les comptes e-mail sans messagerie de récupération. Définis un nouveau mot de passe robuste
        et communique-le à l'utilisateur (il pourra le changer ensuite).
      </Text>
      <Text style={s.label}>E-mail du compte</Text>
      {/* Pas d'auto-remplissage : c'est le compte d'un AUTRE utilisateur, pas celui de l'admin. */}
      <TextInput
        style={s.input} value={email} onChangeText={setEmail} placeholder="email@user.com"
        autoCapitalize="none" keyboardType="email-address" placeholderTextColor={c.textSecondary}
        autoComplete="off" textContentType="none" importantForAutofill="no" autoCorrect={false}
      />
      <Text style={s.label}>Nouveau mot de passe</Text>
      <TextInput
        style={s.input} value={password} onChangeText={setPassword} placeholder="••••••••••••" secureTextEntry
        placeholderTextColor={c.textSecondary}
        autoComplete="off" textContentType="newPassword" importantForAutofill="no" autoCorrect={false}
      />
      <PasswordStrength value={password} colors={c} />
      <TouchableOpacity style={[s.bigBtn, { backgroundColor: c.emerald }]} onPress={submit} disabled={setPw.isPending}>
        <Text style={s.bigBtnTxt}>{setPw.isPending ? '…' : 'Définir le mot de passe'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 100 },
    subtitle: { fontSize: 12, color: c.textSecondary, marginBottom: 16, lineHeight: 16 },
    text: { color: c.text },

    card: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 14 },
    cardDanger: { borderColor: c.danger },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    cardTitle: { fontSize: 15, fontWeight: '800', color: c.text },
    cardDesc: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 12 },
    dot: { width: 10, height: 10, borderRadius: 5 },

    bigBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 15, marginTop: 4 },
    bigBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
    secondaryBtn: { borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
    secondaryTxt: { color: c.text, fontSize: 13, fontWeight: '700' },

    label: { fontSize: 12.5, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 8 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: c.text, marginBottom: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    area: { minHeight: 70, textAlignVertical: 'top' },
    hint: { fontSize: 11.5, color: c.textSecondary, lineHeight: 17, marginTop: 12 },

    statRow: { flexDirection: 'row', gap: 24, marginBottom: 10 },
    stat: { alignItems: 'center' },
    statNum: { fontSize: 22, fontWeight: '800', color: c.text },
    statLbl: { fontSize: 11, color: c.textSecondary },
    filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    filterLbl: { fontSize: 13, color: c.text },
    empty: { fontSize: 13, color: c.textSecondary, paddingVertical: 14, textAlign: 'center' },

    errRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderTopWidth: 1, borderTopColor: c.cardBorder, paddingVertical: 11 },
    errHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
    kindPill: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    kindTxt: { fontSize: 10, fontWeight: '800' },
    errMeta: { fontSize: 11, color: c.textSecondary },
    errMsg: { fontSize: 13, color: c.text, lineHeight: 18 },
    errRoute: { fontSize: 11.5, color: c.textSecondary, marginTop: 2 },
    errStack: { fontSize: 11, color: c.textSecondary, marginTop: 6, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
    resolveBtn: { padding: 2 },
  });
}
