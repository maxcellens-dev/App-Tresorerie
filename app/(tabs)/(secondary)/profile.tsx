import { useRef } from 'react';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image, Platform, Modal } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { supabase } from '../../lib/supabase';
import { compressAvatarToWebP } from '../../lib/avatarCompress';
import { uploadAvatar, deleteAvatar } from '../../services/avatarService';
import { useAppColors } from '../../hooks/useAppColors';
import GuideOverlay, { type BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';


export default function ProfileScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile, refetch } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const fileInputRef = useRef<any>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Guide de présentation (bulles) ──
  const guide = useScreenGuide('profile', user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const avatarRef = useRef<View>(null);
  const infoRef = useRef<View>(null);
  const pwdRef = useRef<View>(null);
  const PROFILE_GUIDE: BubbleStep[] = [
    { getRef: () => avatarRef, icon: 'person-circle-outline', iconColor: '#34d399', title: 'Votre profil', description: 'Ajoutez une photo et personnalisez votre compte.' },
    { getRef: () => infoRef, icon: 'create-outline', iconColor: '#60a5fa', title: 'Vos informations', description: 'Modifiez votre nom puis enregistrez. L\'e-mail est géré par la connexion.' },
    { getRef: () => pwdRef, icon: 'lock-closed-outline', iconColor: '#a78bfa', title: 'Sécurité', description: 'Changez votre mot de passe quand vous le souhaitez.' },
  ];

  useEffect(() => {
    setFullName(profile?.full_name ?? user?.user_metadata?.full_name ?? '');
    setEmail(user?.email ?? profile?.email ?? '');
    setAvatarUrl(profile?.avatar_url ?? '');
  }, [profile, user]);

  async function handlePickAndUpload() {
    if (!user?.id) return;
    if (Platform.OS === 'web') {
      (fileInputRef.current as any)?.click();
      return;
    }
    const ImagePicker = await import('expo-image-picker');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Accès refusé', "Autorisez l'accès à la galerie pour choisir une photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    await doUpload({ uri: result.assets[0].uri });
  }

  function handleFileChange(e: { target: { files?: FileList | null; value?: string } }) {
    const file = e.target.files?.[0];
    if (e.target.value) (e.target as any).value = '';
    if (!file || !file.type.startsWith('image/')) return;
    doUpload(file);
  }

  async function doUpload(source: string | File | { uri: string }) {
    if (!user?.id) return;
    setAvatarLoading(true);
    try {
      const { data, mime } = await compressAvatarToWebP(source);
      const url = await uploadAvatar(user.id, data, mime);
      await updateProfile.mutateAsync({ avatar_url: url });
      setAvatarUrl(url);
      refetch?.();
      Alert.alert('Photo', 'Photo de profil enregistrée (max 30 Ko, WebP).');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'importer l'image.");
    } finally {
      setAvatarLoading(false);
    }
  }

  async function handleRemoveAvatar() {
    if (!user?.id) return;
    const doRemove = async () => {
      setAvatarLoading(true);
      try {
        await deleteAvatar(user.id);
        await updateProfile.mutateAsync({ avatar_url: null });
        setAvatarUrl('');
        refetch?.();
      } catch (e: unknown) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer.');
      } finally {
        setAvatarLoading(false);
      }
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Supprimer la photo\n\nSupprimer la photo de profil ?')) doRemove();
      return;
    }
    Alert.alert('Supprimer la photo', 'Supprimer la photo de profil ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => doRemove() },
    ]);
  }

  async function handleSaveProfile() {
    const trimmedName = fullName.trim();
    try {
      await updateProfile.mutateAsync({
        full_name: trimmedName || null,
        avatar_url: avatarUrl.trim() || null,
      });
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
      return;
    }
    if (user && trimmedName && supabase) {
      await supabase.auth.updateUser({ data: { full_name: trimmedName } });
    }
    Alert.alert('Profil', 'Modifications enregistrées.');
  }

  async function handleChangePassword() {
    const newP = newPassword.trim();
    const conf = confirmPassword.trim();
    if (newP.length < 6) {
      Alert.alert('Mot de passe', 'Le nouveau mot de passe doit faire au moins 6 caractères.');
      return;
    }
    if (newP !== conf) {
      Alert.alert('Mot de passe', 'La confirmation ne correspond pas.');
      return;
    }
    setPasswordLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ password: newP });
        if (error) throw error;
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        Alert.alert('Mot de passe', 'Mot de passe mis à jour.');
      }
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de changer le mot de passe.');
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText.trim().toLowerCase() !== 'supprimer') {
      Alert.alert('Confirmation requise', 'Saisissez le mot « supprimer » pour confirmer.');
      return;
    }
    if (!supabase) return;
    setDeleteLoading(true);
    try {
      const { error } = await supabase.rpc('delete_own_account');
      if (error) throw error;
      setShowDeleteModal(false);
      await signOut();
      router.replace('/welcome');
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de supprimer le compte.');
    } finally {
      setDeleteLoading(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={[]}>
          <TouchableOpacity style={styles.back} onPress={() => router.push('/(tabs)/(secondary)/parametres' as any)}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 8, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.text}>Connectez-vous pour modifier votre profil.</Text>
          <View style={styles.loginActions}>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={() => router.push('/login')}
              accessibilityRole="button"
            >
              <Text style={styles.submitLabel}>Se connecter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.passwordBtn}
              onPress={() => router.push('/register')}
              accessibilityRole="button"
            >
              <Text style={styles.text}>Créer un compte</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
            <ScreenGradient /><SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {Platform.OS === 'web' && typeof document !== 'undefined' && (
          <input
            ref={(el: any) => { fileInputRef.current = el; }}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange as any}
          />
        )}

        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={() => router.push('/(tabs)/(secondary)/parametres' as any)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Mon profil</Text>
        </View>
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.avatarSection} ref={avatarRef}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={48} color={COLORS.textSecondary} />
              </View>
            )}
            <View style={styles.avatarActions}>
              <TouchableOpacity
                style={[styles.avatarBtn, avatarLoading && styles.avatarBtnDisabled]}
                onPress={handlePickAndUpload}
                disabled={avatarLoading}
                accessibilityRole="button"
              >
                {avatarLoading ? (
                  <ActivityIndicator size="small" color={COLORS.bg} />
                ) : (
                  <>
                    <Ionicons name={avatarUrl ? 'camera' : 'cloud-upload'} size={20} color={COLORS.bg} />
                    <Text style={styles.avatarBtnLabel}>{avatarUrl ? 'Remplacer' : 'Importer'}</Text>
                  </>
                )}
              </TouchableOpacity>
              {avatarUrl && (
                <TouchableOpacity
                  style={[styles.avatarBtnDanger, avatarLoading && styles.avatarBtnDisabled]}
                  onPress={handleRemoveAvatar}
                  disabled={avatarLoading}
                  accessibilityRole="button"
                >
                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                  <Text style={styles.avatarBtnLabelDanger}>Supprimer</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.avatarHint}>WebP/JPEG, max 30 Ko</Text>
          </View>

          <View ref={infoRef}>
            <Text style={styles.label}>Nom</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Votre nom"
              placeholderTextColor={COLORS.textSecondary}
            />

            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={[styles.input, styles.inputReadOnly]}
              value={email}
              editable={false}
              placeholder="email@exemple.com"
              placeholderTextColor={COLORS.textSecondary}
            />
            <Text style={styles.hint}>L'e-mail est géré par la connexion.</Text>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, updateProfile.isPending && styles.submitBtnDisabled]}
            onPress={handleSaveProfile}
            disabled={updateProfile.isPending}
            accessibilityRole="button"
          >
            {updateProfile.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.submitLabel}>Enregistrer le profil</Text>}
          </TouchableOpacity>

          <View style={styles.section} ref={pwdRef}>
            <Text style={styles.sectionTitle}>Changer le mot de passe</Text>
            <Text style={styles.label}>Nouveau mot de passe</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Min. 6 caractères"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry
            />
            <Text style={styles.label}>Confirmer le mot de passe</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirmer"
              placeholderTextColor={COLORS.textSecondary}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleChangePassword}
            />
            <TouchableOpacity
              style={[styles.passwordBtn, passwordLoading && styles.submitBtnDisabled]}
              onPress={handleChangePassword}
              disabled={passwordLoading}
              accessibilityRole="button"
            >
              {passwordLoading ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.submitLabel}>Mettre à jour le mot de passe</Text>}
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 24 }}>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={async () => {
                await signOut();
                router.replace('/welcome');
              }}
              accessibilityRole="button"
            >
              <Text style={styles.signOutLabel}>Se déconnecter</Text>
            </TouchableOpacity>
          </View>

          {/* ── Zone de danger ── */}
          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Zone de danger</Text>
            <Text style={styles.dangerText}>
              La suppression de votre compte efface définitivement toutes vos données : comptes, transactions, projets, objectifs, catégories et profil. Cette action est irréversible.
            </Text>
            <TouchableOpacity
              style={styles.deleteAccountBtn}
              onPress={() => { setDeleteConfirmText(''); setShowDeleteModal(true); }}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              <Text style={styles.deleteAccountLabel}>Supprimer mon compte</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* ── Modale de double confirmation ── */}
        <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalIconCircle}>
                <Ionicons name="warning" size={28} color={COLORS.danger} />
              </View>
              <Text style={styles.modalTitle}>Supprimer définitivement</Text>
              <Text style={styles.modalText}>
                Toutes vos données seront <Text style={{ fontWeight: '700', color: COLORS.danger }}>définitivement supprimées</Text> et ne pourront pas être récupérées.
              </Text>
              <Text style={styles.modalText}>
                Pour confirmer, saisissez <Text style={{ fontWeight: '700', color: COLORS.text }}>supprimer</Text> ci-dessous.
              </Text>
              <TextInput
                style={styles.modalInput}
                value={deleteConfirmText}
                onChangeText={setDeleteConfirmText}
                placeholder="supprimer"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                >
                  <Text style={styles.modalCancelLabel}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalDeleteBtn,
                    (deleteConfirmText.trim().toLowerCase() !== 'supprimer' || deleteLoading) && styles.modalDeleteBtnDisabled,
                  ]}
                  onPress={handleDeleteAccount}
                  disabled={deleteConfirmText.trim().toLowerCase() !== 'supprimer' || deleteLoading}
                >
                  {deleteLoading
                    ? <ActivityIndicator color="#ffffff" />
                    : <Text style={styles.modalDeleteLabel}>Supprimer</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>

      <GuideOverlay
        visible={guide.visible}
        steps={PROFILE_GUIDE}
        currentStep={guide.step}
        onNext={() => guide.goNext(PROFILE_GUIDE.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Profil"
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', padding: 4, marginRight: 12 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: c.text },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  avatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.emerald,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  avatarBtnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: c.danger,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  avatarBtnDisabled: { opacity: 0.6 },
  avatarBtnLabel: { fontSize: 14, fontWeight: '600', color: c.bg },
  avatarBtnLabelDanger: { fontSize: 14, fontWeight: '600', color: c.danger },
  avatarHint: { fontSize: 12, color: c.textSecondary, marginTop: 6 },
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
    marginBottom: 16,
  },
  inputReadOnly: { opacity: 0.8 },
  hint: { fontSize: 12, color: c.textSecondary, marginBottom: 20 },
  submitBtn: { backgroundColor: c.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 32 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: c.bg },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 16 },
  passwordBtn: { backgroundColor: c.cardBorder, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  text: { color: c.text },
  loginActions: { marginTop: 16, gap: 12 },
  signOutBtn: { backgroundColor: '#1f2937', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder },
  signOutLabel: { fontSize: 16, fontWeight: '600', color: c.text },

  // Zone de danger
  dangerZone: {
    marginTop: 32, padding: 16, borderRadius: 12,
    borderWidth: 1, borderColor: c.danger + '40', backgroundColor: c.danger + '0d',
  },
  dangerTitle: { fontSize: 15, fontWeight: '700', color: c.danger, marginBottom: 8 },
  dangerText: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 14 },
  deleteAccountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 10,
    borderWidth: 1, borderColor: c.danger,
  },
  deleteAccountLabel: { fontSize: 15, fontWeight: '700', color: c.danger },

  // Modale de confirmation
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    width: '100%', maxWidth: 400, backgroundColor: c.cardSolid,
    borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder,
    padding: 24, alignItems: 'center', gap: 12,
  },
  modalIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: c.danger + '22', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 19, fontWeight: '800', color: c.text, textAlign: 'center' },
  modalText: { fontSize: 14, color: '#cbd5e1', textAlign: 'center', lineHeight: 20 },
  modalInput: {
    width: '100%', backgroundColor: c.bg, borderWidth: 1, borderColor: c.danger + '60',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: c.text, textAlign: 'center', marginTop: 4,
  },
  modalActions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: c.cardBorder,
  },
  modalCancelLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  modalDeleteBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: c.danger,
  },
  modalDeleteBtnDisabled: { opacity: 0.45 },
  modalDeleteLabel: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
});
}
