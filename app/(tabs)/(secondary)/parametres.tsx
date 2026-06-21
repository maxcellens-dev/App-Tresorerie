import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, Switch } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/useProfile';
import { currencySymbolFor } from '../../../lib/currency';
import { useAppColors } from '../../../hooks/useAppColors';
import { useAppNameFont } from '../../../hooks/useBrandFont';
import { THEME_MODES, THEME_PRESETS, type AppColors, type ThemeMode, type ThemePreset } from '../../../theme/palette';
import { useStyleConfig, orderPresetIds } from '../../../hooks/useStyleConfig';
import { headerProfileRect } from '../../../lib/tourTargets';
import { useTour } from '../../../contexts/TourContext';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import CurrencyPicker from '../../../components/CurrencyPicker';
import GuideOverlay from '../../../components/GuideOverlay';
import type { BubbleStep } from '../../../components/GuideOverlay';
import { useScreenGuide } from '../../../hooks/useScreenGuide';
import { useNavBack } from '../../../hooks/useNavBack';
import { useCalculator } from '../../../contexts/CalculatorContext';
import { usePilotageTips } from '../../../hooks/useUiPrefs';
import { useRecoThresholds } from '../../../hooks/useRecoThresholds';
import { useFinancialProfile } from '../../../hooks/useFinancialProfile';
import { resolveConsumptionMode, getConsumptionOrder, RECO_TYPE_LABELS, RECO_COLORS } from '../../../lib/recommendationEngine';
import type { FinancialProfileId } from '../../../types/database';
import { APP_VERSION } from '../../../lib/appVersion';

export default function SettingsScreen() {
  const appNameFont = useAppNameFont();
  const router = useRouter();
  const goBack = useNavBack();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const currencySymbol = currencySymbolFor(profile?.currency_code);

  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { enabled: calculatorEnabled, setEnabled: setCalculatorEnabled } = useCalculator();
  const { enabled: tipsEnabled, setEnabled: setTipsEnabled } = usePilotageTips(user?.id);
  const { data: recoThresholds } = useRecoThresholds();
  const { data: financialProfile } = useFinancialProfile(user?.id);

  // Ordre de déduction des recos selon la prudence active (Auto → dérivé du profil financier).
  // Affiché sous le sélecteur pour expliquer dans quel ordre les recos sont grignotées en cas de
  // dépassement des dépenses variables.
  const deductionOrder = useMemo(() => {
    const mode = resolveConsumptionMode(
      ((profile as any)?.prudence_level ?? null) as number | null,
      financialProfile?.profile_id as FinancialProfileId | undefined,
      recoThresholds?.auto_profile_map,
    );
    return getConsumptionOrder(mode, recoThresholds?.consumption_orders);
  }, [profile, financialProfile, recoThresholds]);

  const [marginInput, setMarginInput] = useState(''); // ancien % - conservé pour compatibilité
  const [safetyAmountInput, setSafetyAmountInput] = useState('');

  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;
  const isAdmin = profile?.is_admin ?? false;
  const tour = useTour();
  const { data: featureFlags } = useFeatureFlags();
  const closureEnabled = Boolean(featureFlags?.monthly_closure_enabled);

  // Liste complète des presets : natifs (avec surcharge hex éventuelle) + presets personnalisés
  const { data: styleConfig } = useStyleConfig();
  const allPresets = useMemo(() => {
    const hidden = new Set(styleConfig?.hidden_presets ?? []);
    const native = THEME_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      swatch: styleConfig?.custom_accents?.[p.id] ?? p.swatch,
    }));
    const extra = (styleConfig?.extra_presets ?? []).map((p) => ({
      id: p.id,
      label: p.label,
      swatch: p.dark,
    }));
    const all = [...native, ...extra];
    const ordered = orderPresetIds(all.map((p) => p.id), styleConfig?.preset_order);
    return ordered
      .map((id) => all.find((p) => p.id === id)!)
      .filter((p) => p && !hidden.has(p.id));
  }, [styleConfig]);

  // ── Guide "bulles" ──
  const insets = useSafeAreaInsets();
  const guide = useScreenGuide('parametres', user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const categoriesRowRef = useRef<any>(null);
  const marginRowRef = useRef<any>(null);
  const monProfilRowRef = useRef<any>(null);

  const GUIDE_STEPS: BubbleStep[] = [
    {
      getRect: () => headerProfileRect(insets.top),
      icon: 'settings',
      iconColor: COLORS.emerald,
      title: 'Paramètres',
      description: 'Accessible en haut à droite via votre avatar. Vous y réglez l\'app, vos catégories et l\'assistance.',
    },
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
      description: 'Montant que vous souhaitez conserver au minimum sur vos comptes courants à la fin du mois, par sécurité. Déduit du "Budget libre à allouer" dans le Pilotage.',
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
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>

        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Header */}
          <TouchableOpacity style={styles.backRow} onPress={goBack}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.pageTitle}>Paramètres</Text>

          {/* Clôture mensuelle (si activée) */}
          {closureEnabled && (
            <View style={styles.card}>
              <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/cloture')}>
                <Ionicons name="lock-closed-outline" size={20} color="#60a5fa" />
                <Text style={styles.rowLabel}>Clôture mensuelle</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {/* ── Profil financier ── */}
          <Text style={styles.sectionTitle}>Profil financier</Text>
          <View style={styles.card}>
            <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/profil-financier')}>
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
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' }}>{currencySymbol}</Text>
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
                Montant que vous souhaitez avoir au minimum sur vos comptes courants à la fin du mois, par sécurité.
              </Text>
            </View>

            {/* Prudence : pilote la confiance dans les revenus à venir et l'horizon de projection */}
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: 8, borderBottomWidth: 0, marginTop: 4 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}>
                <Ionicons name="speedometer-outline" size={20} color={COLORS.textSecondary} />
                <Text numberOfLines={1} style={[styles.rowLabel, { flex: 1 }]}>Prudence du budget</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 30 }}>
                {([
                  { label: 'Auto', value: null as number | null },
                  { label: 'Dynamique', value: 25 },
                  { label: 'Équilibré', value: 50 },
                  { label: 'Prudent', value: 75 },
                ]).map((opt) => {
                  const active = (((profile as any)?.prudence_level ?? null) as number | null) === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => updateProfile.mutate({ prudence_level: opt.value })}
                      style={{ borderWidth: 1, borderColor: active ? COLORS.emerald : COLORS.cardBorder, backgroundColor: active ? COLORS.emerald + '1A' : 'transparent', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}
                      activeOpacity={0.85}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? COLORS.emerald : COLORS.textSecondary }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingLeft: 30 }}>
                Détermine si vos revenus à venir (ex. salaire pas encore reçu) sont pris en compte dans le calcul de votre Relyka — le montant que vous pouvez allouer aux recommandations.{'\n'}Plus on est prudent, plus on se base sur l'argent déja encaissé.
              </Text>
              {/* Ordre de déduction : dans quel ordre les recos sont grignotées si vous dépassez vos dépenses variables. */}
              <View style={{ paddingLeft: 30, gap: 6, marginTop: 2 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>
                  Si vous dépassez vos dépenses variables habituelles, vos recommandations diminuent dans cet ordre :
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {deductionOrder.map((type, i) => (
                    <View key={type} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: RECO_COLORS[type] + '55', backgroundColor: RECO_COLORS[type] + '14', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: RECO_COLORS[type] }} />
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: RECO_COLORS[type] }}>{RECO_TYPE_LABELS[type]}</Text>
                      </View>
                      {i < deductionOrder.length - 1 && (
                        <Ionicons name="chevron-forward" size={12} color={COLORS.textSecondary} />
                      )}
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* ── Conseils (affichage en haut du Pilotage) ── */}
          <Text style={styles.sectionTitle}>Conseils</Text>
          <View style={styles.card}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Ionicons name="bulb-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Afficher les conseils</Text>
              <Switch
                value={tipsEnabled}
                onValueChange={setTipsEnabled}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Affiche le bandeau de conseils en haut de la page Pilotage. Désactivez-le pour un écran plus épuré.
            </Text>
          </View>

          {/* ── Notifications ── */}
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Ionicons name="notifications-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Activer les notifications</Text>
              <Switch
                value={(profile as any)?.notifications_enabled ?? true}
                onValueChange={(v) => updateProfile.mutate({ notifications_enabled: v })}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Concerne uniquement les notifications mobiles (réponses à l'assistance, annonces Relyka).
            </Text>
          </View>

          {/* ── Calculatrice ── */}
          <Text style={styles.sectionTitle}>Calculatrice</Text>
          <View style={styles.card}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Ionicons name="calculator-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Afficher la calculatrice</Text>
              <Switch
                value={calculatorEnabled}
                onValueChange={setCalculatorEnabled}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Affiche un bouton d'accès rapide à une calculatrice flottante, déplaçable, sur les écrans de saisie et de projection.
            </Text>
          </View>

          {/* ── Devise ── */}
          <Text style={styles.sectionTitle}>Devise</Text>
          <View style={styles.card}>
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10, borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Devise de référence</Text>
              <CurrencyPicker
                value={profile?.currency_code ?? 'EUR'}
                onChange={(code) => updateProfile.mutate({ currency_code: code })}
              />
              <Text style={styles.currencyHint}>Devise de tes totaux (Total liquidités, Pilotage, Projection…). Chaque compte garde sa propre devise ; les totaux y sont convertis au taux du jour (≈ si plusieurs devises).</Text>
            </View>
          </View>
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

    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    pageTitle: { fontSize: 24, fontWeight: '800', color: c.text, marginBottom: 16 },
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
    presetRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
    presetDot: {
      width: 32, height: 32, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.cardBorder,
    },
    presetDotActive: {
      borderWidth: 2, borderColor: c.text,
    },

    versionCard: { alignItems: 'center', marginBottom: 20, gap: 4, marginTop: 8 },
    appName: { fontSize: 18, fontWeight: '800', color: c.text, fontFamily: 'Arial Rounded MT Bold' },
    versionBadge: { backgroundColor: c.cardBorder, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 2 },

    signOutBtn: { backgroundColor: c.card, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, marginBottom: 8 },
    signOutLabel: { fontSize: 15, fontWeight: '600', color: c.text },
    footer: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 40 },
  });
}
