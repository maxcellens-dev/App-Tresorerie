import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);

  const [marginInput, setMarginInput] = useState('');

  // ── Guide "bulles" ──
  const guide = useScreenGuide('parametres', user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const categoriesRowRef = useRef<any>(null);
  const marginRowRef = useRef<any>(null);

  const GUIDE_STEPS: BubbleStep[] = [
    {
      getRef: () => categoriesRowRef,
      icon: 'pie-chart-outline',
      iconColor: '#34d399',
      title: 'Gérer les catégories',
      description: 'Ajoutez, renommez ou supprimez vos catégories et sous-catégories de dépenses et de recettes. Elles structurent votre plan de trésorerie et vos statistiques.',
    },
    {
      getRef: () => marginRowRef,
      icon: 'shield-outline',
      iconColor: '#60a5fa',
      title: 'Marge de sécurité',
      description: 'Pourcentage de prudence appliqué à votre budget disponible. Plus la marge est élevée, plus l\'application garde une réserve face aux imprévus.',
    },
  ];

  // ── Safety margin ──
  const handleMarginSave = useCallback(() => {
    const val = Math.max(0, Math.min(100, parseInt(marginInput) || 0));
    setMarginInput(String(val));
    updateProfile.mutate({ safety_margin_percent: val });
  }, [marginInput, updateProfile]);

  // Init margin from profile (only once)
  const currentMargin = (profile as any)?.safety_margin_percent;
  useEffect(() => {
    if (currentMargin !== undefined && currentMargin !== null) {
      setMarginInput(String(currentMargin));
    }
  }, [currentMargin]);

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

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── Mon compte ── */}
          <Text style={styles.sectionTitle}>Mon compte</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/profile')}>
              <Ionicons name="person-circle-outline" size={20} color={COLORS.emerald} />
              <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Mon profil</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {/* ── Profil Financier ── */}
          <Text style={styles.sectionTitle}>Profil Financier</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={() => router.push('/(tabs)/(secondary)/profil-financier')}
            >
              <Ionicons name="trending-up-outline" size={20} color="#a78bfa" />
              <Text style={styles.rowLabel}>Mon profil financier</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Gestion ── */}
          <Text style={styles.sectionTitle}>Gestion</Text>
          <View style={styles.card}>
            <TouchableOpacity ref={categoriesRowRef} style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/categories')}>
              <Ionicons name="pie-chart-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Gérer les catégories</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <View ref={marginRowRef} style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 8, borderBottomWidth: 0 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
                <Ionicons name="shield-outline" size={20} color={COLORS.textSecondary} />
                <Text numberOfLines={1} style={[styles.rowLabel, { flex: 1 }]}>Marge de sécurité</Text>
                <TextInput
                  style={[styles.input, { width: 52, marginBottom: 0, textAlign: 'center' }]}
                  value={marginInput}
                  onChangeText={setMarginInput}
                  onBlur={handleMarginSave}
                  onSubmitEditing={handleMarginSave}
                  keyboardType="numeric"
                  placeholder="10"
                  placeholderTextColor={COLORS.textSecondary}
                  maxLength={3}
                  returnKeyType="done"
                />
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' }}>%</Text>
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingLeft: 30 }}>
                Pourcentage de marge sur les dépenses en sécurité.
              </Text>
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
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/confidentialite')}>
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

      <GuideOverlay
        visible={guide.visible}
        steps={GUIDE_STEPS}
        currentStep={guide.step}
        onNext={() => guide.goNext(GUIDE_STEPS.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Paramètres"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  text: { color: COLORS.text },

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

  // Version
  versionCard: { alignItems: 'center', marginBottom: 20, gap: 4, marginTop: 8 },
  appName: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  versionBadge: { backgroundColor: '#1e293b', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 2 },

  // Sign out
  signOutBtn: { backgroundColor: '#1f2937', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 8 },
  signOutLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  footer: { fontSize: 11, color: COLORS.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 40 },
});
