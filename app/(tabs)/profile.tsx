import { useRef } from 'react';
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { supabase } from '../lib/supabase';
import { compressAvatarToWebP } from '../lib/avatarCompress';
import { uploadAvatar, deleteAvatar } from '../services/avatarService';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
};

export default function ProfileScreen() {
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
    const { launchImageLibraryAsync } = await import('expo-image-picker');
    const { status } = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
    if (status !== 'granted') {
      Alert.alert('Accès refusé', "Autorisez l'accès à la galerie pour choisir une photo.");
      return;
    }
    const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] });
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

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={[]}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
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
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        {Platform.OS === 'web' && typeof document !== 'undefined' && (
          <input
            ref={(el: any) => { fileInputRef.current = el; }}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange as any}
          />
        )}

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.avatarSection}>
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

          <TouchableOpacity
            style={[styles.submitBtn, updateProfile.isPending && styles.submitBtnDisabled]}
            onPress={handleSaveProfile}
            disabled={updateProfile.isPending}
            accessibilityRole="button"
          >
            {updateProfile.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.submitLabel}>Enregistrer le profil</Text>}
          </TouchableOpacity>

          <View style={styles.section}>
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
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginBottom: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  avatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.emerald,
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
    borderColor: COLORS.danger,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  avatarBtnDisabled: { opacity: 0.6 },
  avatarBtnLabel: { fontSize: 14, fontWeight: '600', color: COLORS.bg },
  avatarBtnLabelDanger: { fontSize: 14, fontWeight: '600', color: COLORS.danger },
  avatarHint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 16,
  },
  inputReadOnly: { opacity: 0.8 },
  hint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 20 },
  submitBtn: { backgroundColor: COLORS.emerald, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 32 },
  submitBtnDisabled: { opacity: 0.6 },
  submitLabel: { fontSize: 16, fontWeight: '700', color: COLORS.bg },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  passwordBtn: { backgroundColor: COLORS.cardBorder, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  text: { color: COLORS.text },
  loginActions: { marginTop: 16, gap: 12 },
  signOutBtn: { backgroundColor: '#1f2937', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder },
  signOutLabel: { fontSize: 16, fontWeight: '600', color: COLORS.text },
});
