import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { withDeferredMount } from '../../../hooks/useDeferredMount';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, Switch, Linking, Alert } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/KeyboardAwareScrollView';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/useProfile';
import { currencySymbolFor } from '../../../lib/currency';
import { useAppColors } from '../../../hooks/useAppColors';
import { useResponsive } from '../../../hooks/useResponsive';
import { pageColumn, IS_WEB } from '../../../lib/webLayout';
import { THEME_MODES, THEME_PRESETS, type AppColors, type ThemeMode, type ThemePreset } from '../../../theme/palette';
import { useStyleConfig, orderPresetIds } from '../../../hooks/useStyleConfig';
import { useFeatureFlags } from '../../../hooks/useFeatureFlags';
import CurrencyPicker from '../../../components/CurrencyPicker';
import { useNavBack } from '../../../hooks/useNavBack';
import { useCalculator } from '../../../contexts/CalculatorContext';
import { usePilotageTips, useRecoDismissals, useQuickAddPref, CALCULATOR_PAGES } from '../../../hooks/useUiPrefs';
import { useRecoThresholds } from '../../../hooks/useRecoThresholds';
import { useFinancialProfile } from '../../../hooks/useFinancialProfile';
import { resolveConsumptionMode, getConsumptionOrder, RECO_TYPE_LABELS, RECO_COLORS } from '../../../lib/recommendationEngine';
import type { FinancialProfileId } from '../../../types/database';
import { APP_VERSION } from '../../../lib/appVersion';
import { APP_LOCK_SUPPORTED, getAppLockEnabled, setAppLockEnabled, isDeviceAuthAvailable, runDeviceAuth } from '../../../lib/appLock';
import { diagnosePushRegistration } from '../../../lib/pushNotifications';
import { usePushPermission } from '../../../hooks/usePushPermission';

const ANDROID_PACKAGE = 'com.relyka.myapp';

// Réglage « Bouton de saisie rapide » (position / masquage) : masqué de l'écran, code conservé.
// Le bouton « + » est désormais un élément fixe de l'app (Pilotage, Comptes, Transactions).
const SHOW_QUICK_ADD_SETTING = false;

// Réglage « Marge de sécurité » : masqué ici — il se règle dans le Pilotage, et un même réglage à
// deux endroits prête à confusion. Code conservé (passer à `true` pour le rétablir).
const SHOW_SAFETY_MARGIN = false;
/** Renvoie true si `a` est une version plus récente que `b` ("1.0.2" > "1.0.1"). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export default withDeferredMount(SettingsScreen, 'list');
function SettingsScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const currencySymbol = currencySymbolFor(profile?.currency_code);

  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne de réglages centrée
  const { enabled: calculatorEnabled, setEnabled: setCalculatorEnabled, pages: calculatorPages, setPages: setCalculatorPages } = useCalculator();
  const { enabled: tipsEnabled, setEnabled: setTipsEnabled } = usePilotageTips(user?.id);
  const { position: quickAddPos, setPosition: setQuickAddPos } = useQuickAddPref(user?.id);
  const { resetDismissals } = useRecoDismissals(user?.id);
  const [recosReset, setRecosReset] = useState(false);
  /** Résultat du diagnostic push (admin uniquement, natif). */
  const [pushDiag, setPushDiag] = useState<string | null>(null);
  /** Autorisation SYSTÈME de notifier — relue au retour des réglages de l'OS. */
  const pushPerm = usePushPermission();
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

  // Verrouillage de l'app (biométrie / code appareil) — réglage LOCAL à cet appareil.
  const [appLockOn, setAppLockOn] = useState(false);
  useEffect(() => { getAppLockEnabled().then(setAppLockOn); }, []);
  const toggleAppLock = useCallback(async (next: boolean) => {
    if (next) {
      if (!(await isDeviceAuthAvailable())) {
        Alert.alert('Indisponible', 'Configure d\'abord une empreinte, Face ID ou un code de verrouillage dans les réglages de ton téléphone.');
        return;
      }
      // Confirme que l'utilisateur peut bien déverrouiller (évite de s'enfermer dehors).
      if (!(await runDeviceAuth('Confirme pour activer le verrouillage'))) return;
      await setAppLockEnabled(true); setAppLockOn(true);
    } else {
      if (!(await runDeviceAuth('Confirme pour désactiver le verrouillage'))) return;
      await setAppLockEnabled(false); setAppLockOn(false);
    }
  }, []);

  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const currentPreset = (profile?.theme_preset ?? 'emerald') as ThemePreset;
  const isAdmin = profile?.is_admin ?? false;
  /** Ce que l'utilisateur SOUHAITE (base) — à croiser avec l'autorisation système avant affichage. */
  const wantsNotifs = (profile as any)?.notifications_enabled ?? true;
  const { data: featureFlags } = useFeatureFlags();
  const closureEnabled = Boolean(featureFlags?.monthly_closure_enabled);
  // Bouton « Mise à jour » : compare la version installée à la dernière publiée (config admin).
  const updateAvailable = !!featureFlags?.latest_version && isNewerVersion(featureFlags.latest_version, APP_VERSION);
  const checkUpdate = () => {
    if (updateAvailable) {
      const url = Platform.OS === 'ios'
        ? (featureFlags?.update_url_ios || 'https://apps.apple.com/')
        : (featureFlags?.update_url_android || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`);
      Linking.openURL(url).catch(() => {});
    } else {
      Alert.alert('À jour', `Tu es bien sur la dernière version (v${APP_VERSION}).`);
    }
  };

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
  const scrollRef = useRef<ScrollView>(null);
  // Scroll auto vers la section « Affichage & aides » quand on arrive via la roue crantée du bandeau conseils.
  const params = useLocalSearchParams<{ scrollTo?: string }>();
  const displaySectionY = useRef(0);
  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (params.scrollTo !== 'display' || didAutoScroll.current) return;
    didAutoScroll.current = true;
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, displaySectionY.current - 16), animated: true }), 350);
    return () => clearTimeout(t);
  }, [params.scrollTo]);
  const categoriesRowRef = useRef<any>(null);
  const marginRowRef = useRef<any>(null);
  const monProfilRowRef = useRef<any>(null);


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
  // signOut() se charge de tout (voile, navigation, purge) — cf. AuthContext.
  function handleSignOut() { signOut(); }

  if (!user) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={[]}>
          <Text style={styles.text}>Connecte-toi pour accéder aux paramètres.</Text>
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
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right', 'bottom']}>

        <KeyboardAwareScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

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

          {/* ── Gestion ── */}
          <Text style={styles.sectionTitle}>Gestion</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/profil-financier')}>
              <Ionicons name="trending-up-outline" size={20} color="#a78bfa" />
              <Text style={styles.rowLabel}>Mon profil financier</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* Marge de sécurité : réglage MASQUÉ ici — il se définit dans le Pilotage (une seule
                place pour un même réglage). Code conservé (SHOW_SAFETY_MARGIN pour le rétablir). */}
            {SHOW_SAFETY_MARGIN && (
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
                Montant que tu souhaites avoir au minimum sur tes comptes courants à la fin du mois, par sécurité.
              </Text>
            </View>
            )}

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
                Détermine si tes revenus à venir (ex. salaire pas encore reçu) sont pris en compte dans le calcul de ton Relyka — le montant que tu peux allouer aux recommandations.{'\n'}Plus on est prudent, plus on se base sur l'argent déja encaissé.
              </Text>
              {/* Ordre de déduction : dans quel ordre les recos sont grignotées si vous dépassez vos dépenses variables. */}
              <View style={{ paddingLeft: 30, gap: 6, marginTop: 2 }}>
                <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>
                  Si tu dépasses tes dépenses variables habituelles, tes recommandations diminuent dans cet ordre :
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

          {/* ── Paramétrage (catégories + devise de référence) ── */}
          <Text style={styles.sectionTitle}>Paramétrage</Text>
          <View style={styles.card}>
            <TouchableOpacity ref={categoriesRowRef} style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/categories')}>
              <Ionicons name="pie-chart-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Gérer les catégories</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10, borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Devise de référence</Text>
              <CurrencyPicker
                value={profile?.currency_code ?? 'EUR'}
                onChange={(code) => updateProfile.mutate({ currency_code: code })}
              />
              <Text style={styles.currencyHint}>Devise de tes totaux (Vue d'ensemble, Pilotage, Projection…). Chaque compte garde sa propre devise ; les totaux y sont convertis au taux du jour (≈ si plusieurs devises).</Text>
            </View>
          </View>

          {/* ── Affichage & aides (conseils Pilotage + calculatrice) ── */}
          <Text style={styles.sectionTitle} onLayout={(e) => { displaySectionY.current = e.nativeEvent.layout.y; }}>Affichage & aides</Text>
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
              Affiche le bandeau de conseils en haut de la page Pilotage. Désactive-le pour un écran plus épuré.
            </Text>
            <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: 0 }]}
              onPress={() => { resetDismissals(); setRecosReset(true); }}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={20} color={COLORS.emerald} />
              <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Relancer les recommandations</Text>
              {recosReset && <Ionicons name="checkmark-circle" size={20} color={COLORS.emerald} />}
            </TouchableOpacity>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Réaffiche dans le Pilotage toutes les recommandations ignorées ce mois-ci (selon ta situation actuelle).
            </Text>
            <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
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
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: calculatorEnabled ? 8 : 14, marginTop: -4, lineHeight: 15 }}>
              Affiche un bouton d'accès rapide à une calculatrice flottante et déplaçable, sur les pages choisies ci-dessous.
            </Text>
            {calculatorEnabled && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CALCULATOR_PAGES.map((p) => {
                    const on = calculatorPages.includes(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[
                          { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: COLORS.cardBorder },
                          on && { backgroundColor: COLORS.emerald + '18', borderColor: COLORS.emerald },
                        ]}
                        onPress={() => setCalculatorPages(on ? calculatorPages.filter((id) => id !== p.id) : [...calculatorPages, p.id])}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                      >
                        <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? COLORS.emerald : COLORS.textSecondary }}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {calculatorPages.length === 0 && (
                  <Text style={{ color: COLORS.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 8, fontStyle: 'italic' }}>
                    Aucune page sélectionnée : le bouton n'apparaîtra nulle part.
                  </Text>
                )}
              </View>
            )}
            {SHOW_QUICK_ADD_SETTING && featureFlags?.quick_add_enabled !== false && (() => {
              const bubbleMode = (featureFlags?.quick_add_mode ?? 'tabbar') === 'bubble';
              // Plus d'option « Masquer » : le bouton + porte désormais la mise à jour du solde,
              // le seul geste qui VÉRIFIE les données. Le masquer privait l'utilisateur de
              // l'action la plus utile de l'app, sans autre chemin mis en avant. Seule la
              // POSITION reste réglable (et rien en mode bulle, où elle est imposée).
              const opts = bubbleMode
                ? ([] as const)
                : ([['right', 'Droite'], ['left', 'Gauche']] as const);
              if (opts.length === 0) return null;
              return (
                <>
                  <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
                  <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 8, borderBottomWidth: 0 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Ionicons name="add-circle-outline" size={20} color={COLORS.textSecondary} />
                      <Text style={styles.rowLabel}>Position du bouton de saisie rapide</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {opts.map(([val, lbl]) => {
                        const active = quickAddPos === val;
                        return (
                          <TouchableOpacity
                            key={val}
                            style={[{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.cardBorder, alignItems: 'center' }, active && { backgroundColor: COLORS.emerald + '18', borderColor: COLORS.emerald }]}
                            onPress={() => setQuickAddPos(val)}
                            activeOpacity={0.8}
                          >
                            <Text style={{ fontSize: 13, fontWeight: active ? '700' : '600', color: active ? COLORS.emerald : COLORS.textSecondary }}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 11, lineHeight: 15 }}>
                      {bubbleMode
                        ? 'Bouton « + » volant en bas à droite, sur l\'écran Pilotage uniquement, pour saisir vite un virement, une dépense ou une recette.'
                        : 'Gros bouton « + » surélevé dans la barre du bas pour saisir vite un virement, une dépense ou une recette.'}
                    </Text>
                  </View>
                </>
              );
            })()}
          </View>

          {/* ── Application ─────────────────────────────────────────────────────────────────
              Masquée sur le WEB : les trois réglages qu'elle porte n'y existent pas. Les
              notifications sont celles du mobile, le verrouillage s'appuie sur Face ID / l'empreinte
              de l'appareil, et la « mise à jour » installe un correctif OTA — sur un navigateur,
              recharger la page suffit. Les proposer là-bas revenait à afficher trois interrupteurs
              sans effet. */}
          {/* ── NOTIFICATIONS : les deux canaux au MÊME endroit ─────────────────────────────────
              E-mail et push répondent à la même question — « comment Relyka me joint ? ». Les
              séparer obligeait à chercher dans deux sections pour un seul réglage mental.
              Le push reste masqué sur le web (il n'y existe pas), l'e-mail est visible partout :
              une boîte mail se règle depuis n'importe quel appareil. */}
          <Text style={styles.sectionTitle}>Notifications</Text>
          <View style={styles.card}>
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Ionicons name="mail-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>E-mails d’information</Text>
              <Switch
                value={(profile as any)?.email_opt_in ?? true}
                onValueChange={(v) => updateProfile.mutate({ email_opt_in: v })}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Nouveautés et conseils. Les e-mails de sécurité (mot de passe, changement d’adresse)
              partent toujours : sans eux, tu ne pourrais plus récupérer ton compte.
            </Text>
            {!IS_WEB && (
              <>
                {/* ── L'interrupteur reflète le TÉLÉPHONE, pas seulement le souhait enregistré ──
                    `notifications_enabled` ne dit que ce que l'utilisateur VEUT. Si Android/iOS
                    refuse, rien n'arrivera jamais : afficher « activé » dans ce cas, c'est mentir.
                    L'état visible est donc la CONJONCTION des deux, et allumer l'interrupteur
                    déclenche ce qui manque réellement — la demande système, ou l'ouverture des
                    réglages quand l'OS ne permet plus de demander. */}
                <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Ionicons name="notifications-outline" size={20} color={COLORS.textSecondary} />
                  <Text style={styles.rowLabel}>Notifications sur le téléphone</Text>
                  <Switch
                    value={wantsNotifs && pushPerm.granted}
                    onValueChange={async (v) => {
                      if (!v) { updateProfile.mutate({ notifications_enabled: false }); return; }
                      // Activer = obtenir l'autorisation système AVANT d'enregistrer le souhait.
                      if (pushPerm.granted) { updateProfile.mutate({ notifications_enabled: true }); return; }
                      const res = await pushPerm.request();
                      if (res === 'granted') { updateProfile.mutate({ notifications_enabled: true }); return; }
                      /* Refus définitif : l'app ne peut plus rien demander, seul l'OS décide. On
                         n'enregistre PAS le souhait — sinon l'interrupteur se rallumerait sans que
                         la moindre notification puisse passer, et on retomberait sur le mensonge. */
                      Alert.alert(
                        'Autorisation refusée',
                        "Les notifications de Relyka sont bloquées dans les réglages de ton téléphone. Ouvre-les pour les autoriser.",
                        [
                          { text: 'Plus tard', style: 'cancel' },
                          { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings().catch(() => {}) },
                        ],
                      );
                    }}
                    trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                    thumbColor="#ffffff"
                  />
                </View>
                <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
                  Réponses à l'assistance, rappels et annonces Relyka.
                </Text>
                {/* Le cas qui piégeait : souhait enregistré, mais téléphone bloqué. On le DIT, avec
                    le seul geste qui débloque. */}
                {pushPerm.blocked && wantsNotifs && (
                  <TouchableOpacity
                    style={{ marginHorizontal: 16, marginBottom: 14, marginTop: -4, padding: 11, borderRadius: 10, backgroundColor: COLORS.orange + '14', borderWidth: 1, borderColor: COLORS.orange + '55', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    onPress={() => Linking.openSettings().catch(() => {})}
                  >
                    <Ionicons name="warning-outline" size={16} color={COLORS.orange} />
                    <Text style={{ flex: 1, color: COLORS.orange, fontSize: 11.5, lineHeight: 16, fontWeight: '600' }}>
                      Ton téléphone bloque les notifications de Relyka. Touche ici pour les autoriser dans les réglages.
                    </Text>
                  </TouchableOpacity>
                )}
                {/* Diagnostic technique — ADMIN uniquement. Pour un utilisateur, l'interrupteur
                    ci-dessus doit suffire : s'il est fiable, ce bouton n'a plus de raison d'être, et
                    proposer une trace technique à quelqu'un qui n'en fera rien crée de l'inquiétude
                    plus qu'il n'aide. */}
                {isAdmin && (
                  <>
                    <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
                    <TouchableOpacity
                      style={[styles.row, { borderBottomWidth: 0 }]}
                      onPress={async () => {
                        setPushDiag('Analyse en cours…');
                        try { setPushDiag(await diagnosePushRegistration()); }
                        catch (e: any) { setPushDiag(`Diagnostic impossible : ${e?.message ?? String(e)}`); }
                      }}
                    >
                      <Ionicons name="pulse-outline" size={20} color={COLORS.textSecondary} />
                      <Text style={styles.rowLabel}>Diagnostic push (admin)</Text>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                    {!!pushDiag && (
                      <View style={{ marginHorizontal: 16, marginBottom: 14, padding: 11, borderRadius: 10, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.cardBorder }}>
                        <Text style={{ color: COLORS.text, fontSize: 11.5, lineHeight: 17 }} selectable>{pushDiag}</Text>
                      </View>
                    )}
                  </>
                )}
              </>
            )}
          </View>

          {!IS_WEB && (<>
          <Text style={styles.sectionTitle}>Application</Text>
          <View style={styles.card}>
            {APP_LOCK_SUPPORTED && (
              <>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} />
                  <Text style={styles.rowLabel}>Verrouiller l'app</Text>
                  <Switch
                    value={appLockOn}
                    onValueChange={toggleAppLock}
                    trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                    thumbColor="#ffffff"
                  />
                </View>
                <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
                  Demande Face ID / empreinte (ou le code de ton téléphone) au lancement de l'app. Protège tes données sur cet appareil.
                </Text>
                <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
              </>
            )}
            <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} onPress={checkUpdate} activeOpacity={0.7}>
              <Ionicons name={updateAvailable ? 'arrow-up-circle' : 'checkmark-circle-outline'} size={20} color={updateAvailable ? COLORS.emerald : COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Mise à jour</Text>
                <Text style={{ color: updateAvailable ? COLORS.emerald : COLORS.textSecondary, fontSize: 12, marginTop: 1 }}>
                  {updateAvailable ? 'Nouvelle version disponible · appuyez pour l\'installer' : `Version installée v${APP_VERSION}`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          </>)}
        </KeyboardAwareScrollView>
      </SafeAreaView>

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
    versionBadge: { backgroundColor: c.cardBorder, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, marginTop: 2 },

    signOutBtn: { backgroundColor: c.card, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: c.cardBorder, marginBottom: 8 },
    signOutLabel: { fontSize: 15, fontWeight: '600', color: c.text },
    footer: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 12, marginBottom: 40 },
  });
}
