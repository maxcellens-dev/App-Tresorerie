import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../hooks/useProfile';
import { useAppColors } from '../../hooks/useAppColors';
import { THEME_MODES, THEME_PRESETS, type AppColors, type ThemeMode, type ThemePreset } from '../../theme/palette';
import CurrencyPicker from '../../components/CurrencyPicker';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';

const APP_VERSION = '1.0.0';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);

  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const [marginInput, setMarginInput] = useState(''); // ancien % - conservé pour compatibilité
  const [safetyAmountInput, setSafetyAmountInput] = useState('');

  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;

  // ── Guide "bulles" ──
  const guide = useScreenGuide('parametres', user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const categoriesRowRef = useRef<any>(null);
  const marginRowRef = useRef<any>(null);

  const GUIDE_STEPS: BubbleStep[] = [
    {
      getRef: () => categoriesRowRef,
      icon: 'pie-chart-outline',
      iconColor: COLORS.emerald,
      title: 'Gérer les catégories',
      description: 'Ajoutez, renommez ou supprimez vos catégories et sous-catégories de dépenses et de recettes. Elles structurent votre plan de trésorerie et vos statistiques.',
    },
    {
      getRef: () => marginRowRef,
      icon: 'shield-outline',
      iconColor: '#60a5fa',
      title: 'Marge de sécurité',
      description: 'Montant minimum conservé sur vos comptes courants quoi qu\'il arrive. Déduit du "Reste du mois" dans le Pilotage.',
    },
  ];

  // ── Safety margin (montant en €) ──
  const handleSafetyAmountSave = useCallback(() => {
    const val = Math.max(0, parseFloat(safetyAmountInput.replace(',', '.')) || 0);
    setSafetyAmountInput(String(val));
    updateProfile.mutate({ safety_margin_amount: val });
  }, [safetyAmountInput, updateProfile]);

  const currentSafetyAmount = profile?.safety_margin_amount ?? 0;
  useEffect(() => {
    setSafetyAmountInput(String(currentSafetyAmount));
  }, [currentSafetyAmount]);

  // ── Thème ──
  const setMode = (mode: ThemeMode) => updateProfile.mutate({ theme_mode: mode });
  const setPreset = (preset: ThemePreset) => updateProfile.mutate({ theme_preset: preset });

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
      <StatusBar style={currentMode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── Mon compte ── */}
          <Text style={styles.sectionTitle}>Mon compte</Text>
          <View style={styles.card}>
            <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/profile')}>
              <Ionicons name="person-circle-outline" size={20} color={COLORS.emerald} />
              <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Mon profil</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.emerald} />
            </TouchableOpacity>
          </View>

          {/* ── Profil Financier ── */}
          <Text style={styles.sectionTitle}>Profil Financier</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push('/(tabs)/(secondary)/profil-financier')}
            >
              <Ionicons name="trending-up-outline" size={20} color="#a78bfa" />
              <Text style={styles.rowLabel}>Mon profil financier</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={() => router.push('/(tabs)/reporting')}
            >
              <Ionicons name="bar-chart-outline" size={20} color="#f59e0b" />
              <Text style={styles.rowLabel}>Reporting</Text>
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
                  style={[styles.input, { width: 80, marginBottom: 0, textAlign: 'right' }]}
                  value={safetyAmountInput}
                  onChangeText={(t) => setSafetyAmountInput(t.replace(/[^0-9.,]/g, ''))}
                  onBlur={handleSafetyAmountSave}
                  onSubmitEditing={handleSafetyAmountSave}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.textSecondary}
                  maxLength={8}
                  returnKeyType="done"
                />
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' }}>€</Text>
                {String(parseFloat(safetyAmountInput.replace(',', '.')) || 0) !== String(currentSafetyAmount) && (
                  <TouchableOpacity
                    onPress={handleSafetyAmountSave}
                    style={{ backgroundColor: COLORS.emerald, borderRadius: 8, padding: 6 }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="checkmark" size={16} color={COLORS.bg} />
                  </TouchableOpacity>
                )}
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingLeft: 30 }}>
                Montant minimum à conserver sur vos comptes courants quoi qu'il arrive.
              </Text>
            </View>
          </View>

          {/* ── Apparence ── */}
          <Text style={styles.sectionTitle}>Apparence</Text>
          <View style={styles.card}>
            {/* Mode clair / sombre */}
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
              <Text style={styles.rowLabel}>Mode d'affichage</Text>
              <View style={styles.segmentRow}>
                {THEME_MODES.map((m) => {
                  const active = currentMode === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.segment, active && styles.segmentActive]}
                      onPress={() => setMode(m.id)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name={m.icon as any} size={16} color={active ? COLORS.bg : COLORS.textSecondary} />
                      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Preset de couleur */}
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
              <Text style={styles.rowLabel}>Couleur d'accent</Text>
              <View style={styles.presetRow}>
                {THEME_PRESETS.map((p) => {
                  const active = currentPreset === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.presetDot, { backgroundColor: p.swatch }, active && styles.presetDotActive]}
                      onPress={() => setPreset(p.id)}
                      activeOpacity={0.8}
                      accessibilityLabel={p.label}
                    >
                      {active && <Ionicons name="checkmark" size={18} color="#ffffff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Devise d'affichage */}
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10, borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Devise</Text>
              <CurrencyPicker
                value={profile?.currency_code ?? 'EUR'}
                onChange={(code) => updateProfile.mutate({ currency_code: code })}
              />
              <Text style={styles.currencyHint}>Change le symbole des montants partout. Aucune conversion n'est appliquée.</Text>
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

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: 100 },
    text: { color: c.text },

    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    input: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 12,
    },
    saveBtn: { backgroundColor: c.emerald, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 28 },
    saveBtnLabel: { fontSize: 15, fontWeight: '700', color: c.bg },

    sectionTitle: { fontSize: 12, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: {
      backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      overflow: 'hidden', marginBottom: 20,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 14, paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: c.cardBorder,
    },
    rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text },

    // Apparence
    segmentRow: { flexDirection: 'row', gap: 8 },
    segment: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg,
    },
    segmentActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    segmentLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
    segmentLabelActive: { color: c.bg },
    currencyHint: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },
    presetRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    presetDot: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    presetDotActive: {
      borderWidth: 2, borderColor: c.text,
    },

    versionCard: { alignItems: 'center', marginBottom: 20, gap: 4, marginTop: 8 },
    appName: { fontSize: 18, fontWeight: '800', color: c.text },
    versionBadge: { backgroundColor: c.cardBorder, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 2 },

    signOutBtn: { backgroundColor: c.card, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, marginBottom: 8 },
    signOutLabel: { fontSize: 15, fontWeight: '600', color: c.text },
    footer: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 40 },
  });
}
