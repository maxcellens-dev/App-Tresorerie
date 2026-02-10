import { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { supabase } from '../../lib/supabase';
import { compressAvatarToWebP } from '../../lib/avatarCompress';
import { uploadAvatar, deleteAvatar } from '../../services/avatarService';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  danger: '#f87171',
};

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile, refetch } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const fileInputRef = useRef<any>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [marginInput, setMarginInput] = useState('');

  useEffect(() => {
    setFullName(profile?.full_name ?? user?.user_metadata?.full_name ?? '');
    setEmail(user?.email ?? profile?.email ?? '');
    setAvatarUrl(profile?.avatar_url ?? '');
    const currentMargin = (profile as any)?.safety_margin_percent;
    if (currentMargin !== undefined && currentMargin !== null) {
      setMarginInput(String(currentMargin));
    }
  }, [profile, user]);

  // ── Avatar ──
  async function handlePickAndUpload() {
    if (!user?.id) return;
    if (Platform.OS === 'web') {
      (fileInputRef.current as any)?.click();
      return;
    }
    const { launchImageLibraryAsync } = await import('expo-image-picker');
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
      if (window.confirm('Supprimer la photo de profil ?')) doRemove();
      return;
    }
    Alert.alert('Supprimer la photo', 'Supprimer la photo de profil ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => doRemove() },
    ]);
  }

  // ── Profile save ──
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

  // ── Password ──
  async function handleChangePassword() {
    const newP = newPassword.trim();
    if (newP.length < 6) { Alert.alert('Mot de passe', 'Min. 6 caractères.'); return; }
    if (newP !== confirmPassword.trim()) { Alert.alert('Mot de passe', 'La confirmation ne correspond pas.'); return; }
    setPasswordLoading(true);
    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ password: newP });
        if (error) throw error;
        setNewPassword(''); setConfirmPassword('');
        Alert.alert('Mot de passe', 'Mis à jour avec succès.');
      }
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Impossible de changer le mot de passe.');
    } finally { setPasswordLoading(false); }
  }

  // ── Safety margin ──
  const handleMarginSave = useCallback(() => {
    const val = Math.max(0, Math.min(50, parseInt(marginInput) || 0));
    setMarginInput(String(val));
    updateProfile.mutate({ safety_margin_percent: val } as any);
  }, [marginInput, updateProfile]);

  // ── Sign out ──
  async function handleSignOut() {
    await signOut();
    router.replace('/welcome');
  }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={[]}>
          <Text style={styles.text}>Connectez-vous pour accéder aux paramètres.</Text>
          <View style={{ marginTop: 16, gap: 12 }}>
            <TouchableOpacity style={styles.saveBtn} onPress={() => router.push('/login')}>
              <Text style={styles.saveBtnLabel}>Se connecter</Text>
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

          {/* ── Profil ── */}
          <Text style={styles.sectionTitle}>Mon compte</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/profile')}>
              <Ionicons name="person-circle-outline" size={20} color={COLORS.emerald} />
              <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Mon profil</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {/* ── Profil inline (avatar, nom, email) ── */}
          <View style={styles.avatarSection}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={48} color={COLORS.textSecondary} />
              </View>
            )}
            <View style={styles.avatarActions}>
              <TouchableOpacity style={[styles.avatarBtn, avatarLoading && { opacity: 0.6 }]} onPress={handlePickAndUpload} disabled={avatarLoading}>
                {avatarLoading ? <ActivityIndicator size="small" color={COLORS.bg} /> : (
                  <>
                    <Ionicons name={avatarUrl ? 'camera' : 'cloud-upload'} size={18} color={COLORS.bg} />
                    <Text style={styles.avatarBtnLabel}>{avatarUrl ? 'Remplacer' : 'Importer'}</Text>
                  </>
                )}
              </TouchableOpacity>
              {!!avatarUrl && (
                <TouchableOpacity style={[styles.avatarBtnDanger, avatarLoading && { opacity: 0.6 }]} onPress={handleRemoveAvatar} disabled={avatarLoading}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <Text style={styles.fieldLabel}>Nom</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Votre nom" placeholderTextColor={COLORS.textSecondary} />
          <Text style={styles.fieldLabel}>E-mail</Text>
          <TextInput style={[styles.input, { opacity: 0.7 }]} value={email} editable={false} />
          <TouchableOpacity style={[styles.saveBtn, updateProfile.isPending && { opacity: 0.6 }]} onPress={handleSaveProfile} disabled={updateProfile.isPending}>
            {updateProfile.isPending ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.saveBtnLabel}>Enregistrer le profil</Text>}
          </TouchableOpacity>

          {/* ── Catégories ── */}
          <Text style={styles.sectionTitle}>Catégories</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/categories')}>
              <Ionicons name="pie-chart-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Gérer les catégories</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Pilotage ── */}
          <Text style={styles.sectionTitle}>Pilotage</Text>
          <View style={styles.card}>
            <View style={{ padding: 16 }}>
              <Text style={[styles.rowLabel, { marginBottom: 8 }]}>Marge de sécurité (%)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={marginInput}
                  onChangeText={setMarginInput}
                  onBlur={handleMarginSave}
                  keyboardType="numeric"
                  placeholder="10"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>0 – 50 %</Text>
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6 }}>
                Pourcentage ajouté aux seuils d'épargne pour plus de confort.
              </Text>
            </View>
          </View>

          {/* ── Admin ── */}
          {isAdmin && (
            <>
              <Text style={styles.sectionTitle}>Administration</Text>
              <View style={styles.card}>
                <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/admin')}>
                  <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.emerald} />
                  <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Panneau Admin</Text>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.emerald} />
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── Mot de passe ── */}
          <Text style={styles.sectionTitle}>Sécurité</Text>
          <View style={styles.card}>
            <View style={{ padding: 16, gap: 10 }}>
              <Text style={styles.fieldLabel}>Nouveau mot de passe</Text>
              <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} placeholder="Min. 6 caractères" placeholderTextColor={COLORS.textSecondary} secureTextEntry />
              <Text style={styles.fieldLabel}>Confirmer</Text>
              <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirmer" placeholderTextColor={COLORS.textSecondary} secureTextEntry />
              <TouchableOpacity style={[styles.passwordBtn, passwordLoading && { opacity: 0.6 }]} onPress={handleChangePassword} disabled={passwordLoading}>
                {passwordLoading ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.saveBtnLabel}>Mettre à jour</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Support & Infos ── */}
          <Text style={styles.sectionTitle}>Support</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/assistance')}>
              <Ionicons name="headset-outline" size={20} color={COLORS.emerald} />
              <Text style={styles.rowLabel}>Assistance</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/ideas')}>
              <Ionicons name="bulb-outline" size={20} color="#f59e0b" />
              <Text style={styles.rowLabel}>Boîte à idées</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/privacy')}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#60a5fa" />
              <Text style={styles.rowLabel}>Confidentialité</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/legal')}>
              <Ionicons name="document-text-outline" size={20} color="#a78bfa" />
              <Text style={styles.rowLabel}>Mentions légales</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Version ── */}
          <View style={styles.versionCard}>
            <Text style={styles.appName}>Trésorerie</Text>
            <Text style={{ fontSize: 12, color: COLORS.emerald, fontWeight: '500' }}>Laissez-vous guider pour faire des économies.</Text>
            <View style={styles.versionBadge}>
              <Text style={{ fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' }}>Version {APP_VERSION}</Text>
            </View>
          </View>

          {/* ── Déconnexion ── */}
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <Text style={styles.signOutLabel}>Se déconnecter</Text>
          </TouchableOpacity>

          <Text style={styles.footer}>© 2026 Trésorerie. Tous droits réservés.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  text: { color: COLORS.text },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: 20 },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center', justifyContent: 'center',
  },
  avatarActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  avatarBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.emerald, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  avatarBtnDanger: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.danger, width: 36, height: 36, borderRadius: 10,
  },
  avatarBtnLabel: { fontSize: 13, fontWeight: '600', color: COLORS.bg },

  // Fields
  fieldLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.text, marginBottom: 12,
  },
  saveBtn: { backgroundColor: COLORS.emerald, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 28 },
  saveBtnLabel: { fontSize: 15, fontWeight: '700', color: COLORS.bg },

  // Sections
  sectionTitle: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder,
    overflow: 'hidden', marginBottom: 20,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: COLORS.text },

  // Password
  passwordBtn: { backgroundColor: COLORS.cardBorder, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },

  // Version
  versionCard: { alignItems: 'center', marginBottom: 20, gap: 4, marginTop: 8 },
  appName: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  versionBadge: { backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 2 },

  // Sign out
  signOutBtn: { backgroundColor: '#1f2937', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 8 },
  signOutLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  footer: { fontSize: 11, color: COLORS.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 40 },
});
