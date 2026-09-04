import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, Switch, Linking, Alert } from 'react-native';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import KeyboardAwareScrollView from '../../../components/layout/KeyboardAwareScrollView';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/data/useProfile';
import { currencySymbolFor } from '../../../lib/finance/currency';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { pageColumn, IS_WEB } from '../../../lib/ui/webLayout';
import { type AppColors, type ThemeMode } from '../../../theme/palette';
import { useFeatureFlags } from '../../../hooks/config/useFeatureFlags';
import CurrencyPicker from '../../../components/account/CurrencyPicker';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useCalculator } from '../../../contexts/CalculatorContext';
import { usePilotageTips, useRecoDismissals, CALCULATOR_PAGES } from '../../../hooks/config/useUiPrefs';
import { useRecoThresholds } from '../../../hooks/pilotage/useRecoThresholds';
import { useFinancialProfile } from '../../../hooks/pilotage/useFinancialProfile';
import { resolveConsumptionMode, getConsumptionOrder, RECO_TYPE_LABELS, RECO_COLORS } from '../../../lib/finance/recommendationEngine';
import type { FinancialProfileId } from '../../../types/database';
import { APP_VERSION, BUNDLE_VERSION, RUNNING_NEWER_BUNDLE, NATIVE_VERSION_KNOWN, shouldOfferStoreUpdate } from '../../../lib/platform/appVersion';
import { APP_LOCK_SUPPORTED, getAppLockEnabled, setAppLockEnabled, isDeviceAuthAvailable, runDeviceAuth } from '../../../lib/auth/appLock';
import { diagnosePushRegistration } from '../../../lib/platform/pushNotifications';
import { usePushPermission } from '../../../hooks/platform/usePushPermission';
import { sanitizeAmountInput } from '../../../lib/ui/amountInput';

const ANDROID_PACKAGE = 'com.relyka.myapp';


// Réglage « Marge de sécurité » : masqué ici — il se règle dans le Pilotage, et un même réglage à
// deux endroits prête à confusion. Code conservé (passer à `true` pour le rétablir).
const SHOW_SAFETY_MARGIN = false;
// (La comparaison de versions vit dans lib/platform/appVersion — elle décidait du même message
//  ici et dans le bandeau, en deux copies qui pouvaient diverger.)

export default withDeferredMount(SettingsScreen);
function SettingsScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const currencySymbol = currencySymbolFor(profile?.currency_code);

  /* ── « CONNECTÉ EN TANT QUE » : ON REGARDE, ON NE TOUCHE PAS ─────────────────────────────────
     Tous les réglages de cette page s'écrivent dans `profiles` (devise de référence, prudence,
     notifications, e-mails) ou dans `profiles.ui_prefs` (conseils, calculatrice, recommandations
     masquées). Or la politique d'accès autorise un administrateur à écrire sur n'importe quel
     profil : consulter le compte de quelqu'un pour l'aider et effleurer un interrupteur suffisait
     à CHANGER POUR DE BON son réglage — sans confirmation, sans trace, et sans que rien à l'écran
     ne le laisse deviner. C'est la même règle que Mon profil, Apparence et Profil financier, qui
     la portaient déjà chacun de leur côté : cette page était la dernière à ne pas l'avoir. */
  const readOnly = isImpersonating;

  /* Une écriture peut échouer (réseau coupé, refus du serveur). La mise à jour optimiste fait alors
     marche arrière toute seule : l'interrupteur revient à sa position précédente, sans un mot — on
     croit à un bug de l'application. On le dit. */
  const [saveError, setSaveError] = useState(false);
  /** Écrit un réglage de profil — refusé en consultation, et jamais en silence en cas d'échec. */
  const saveProfile = useCallback((patch: Parameters<typeof updateProfile.mutate>[0]) => {
    if (readOnly) return;
    setSaveError(false);
    updateProfile.mutate(patch, { onError: () => setSaveError(true) });
  }, [readOnly, updateProfile]);

  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne de réglages centrée
  const { enabled: calculatorEnabled, setEnabled: setCalculatorEnabled, pages: calculatorPages, setPages: setCalculatorPages } = useCalculator();
  const { enabled: tipsEnabled, setEnabled: setTipsEnabled } = usePilotageTips(user?.id);
  const { resetDismissals } = useRecoDismissals(user?.id);
  /** Retour du bouton « Relancer les recommandations » : idle → done (3 s) ou error. */
  const [recosReset, setRecosReset] = useState<'idle' | 'done' | 'error'>('idle');
  /** Résultat du diagnostic push (admin uniquement, natif). */
  const [pushDiag, setPushDiag] = useState<string | null>(null);
  /** Autorisation SYSTÈME de notifier — relue au retour des réglages de l'OS. */
  const pushPerm = usePushPermission();
  const { data: recoThresholds } = useRecoThresholds();
  const { data: financialProfile, isSuccess: fpLoaded } = useFinancialProfile(user?.id);

  /* Ordre de déduction des recos selon la prudence active (Auto → dérivé du profil financier).
     Affiché sous le sélecteur pour expliquer dans quel ordre les recos sont grignotées en cas de
     dépassement des dépenses variables.

     ⚠️ En mode « Auto », cet ordre DÉPEND du profil financier. Tant que celui-ci n'a pas répondu,
     `resolveProfileId(undefined)` retombe sur P0, donc sur l'ordre « prudent » : la page affichait
     un ordre affirmatif, faux pour la plupart des comptes, qui changeait sous les yeux une seconde
     plus tard. On n'affiche l'ordre qu'une fois qu'on le connaît — et immédiatement quand la
     prudence est réglée à la main, puisqu'elle suffit alors à le déterminer. */
  const prudenceLevel = ((profile as any)?.prudence_level ?? null) as number | null;
  const deductionOrderKnown = prudenceLevel != null || fpLoaded;
  const deductionOrder = useMemo(() => {
    const mode = resolveConsumptionMode(
      prudenceLevel,
      financialProfile?.profile_id as FinancialProfileId | undefined,
      recoThresholds?.auto_profile_map,
    );
    return getConsumptionOrder(mode, recoThresholds?.consumption_orders);
  }, [prudenceLevel, financialProfile, recoThresholds]);

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

  // Sert uniquement à la barre d'état (le réglage du thème vit dans l'écran Apparence).
  const currentMode = (profile?.theme_mode ?? 'dark') as ThemeMode;
  const isAdmin = profile?.is_admin ?? false;
  /** Ce que l'utilisateur SOUHAITE (base) — à croiser avec l'autorisation système avant affichage. */
  const wantsNotifs = (profile as any)?.notifications_enabled ?? true;
  /* `isSuccess` : tant que la configuration n'a pas RÉPONDU, on ne sait pas s'il existe une version
     plus récente — et on ne peut donc affirmer ni l'un ni l'autre (cf. le message d'« À jour »
     ci-dessous, qui promettait « tu es bien sur la dernière version » sur la foi d'une lecture qui
     n'était pas revenue, ou qui avait échoué). */
  const { data: featureFlags, isSuccess: flagsLoaded } = useFeatureFlags();
  const closureEnabled = Boolean(featureFlags?.monthly_closure_enabled);
  /* ── « SUIS-JE À JOUR ? » — trois réponses, dont un « je ne sais pas » assumé ─────────────────
     La comparaison n'a de sens que si l'on connaît la version RÉELLEMENT INSTALLÉE. Sur un binaire
     antérieur à l'ajout d'`expo-application`, `APP_VERSION` retombe sur la version du BUNDLE — donc
     sur celle de la dernière OTA reçue, qui monte à chaque publication. Comparer là-dessus revenait
     à répondre « tu es à jour » d'autant plus sûrement que l'utilisateur recevait des mises à jour :
     l'inverse exact de ce que la question demande. Faute de savoir, on n'affirme rien et on propose
     d'aller voir le store — cf. lib/platform/appVersion. */
  const canCompareVersions = NATIVE_VERSION_KNOWN;
  /* MÊME décision que le bandeau (components/system/UpdateBanner) : une seule fonction, sinon les
     deux finissent par se contredire — l'un annonçant une mise à jour que l'autre ignore. */
  const updateAvailable = shouldOfferStoreUpdate(featureFlags?.latest_version);
  const storeUrl = () => (Platform.OS === 'ios'
    ? (featureFlags?.update_url_ios || 'https://apps.apple.com/')
    : (featureFlags?.update_url_android || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`));
  /* L'échec d'ouverture était avalé : on appuyait sur « Nouvelle version disponible » et il ne
     se passait RIEN — ni store, ni message. Un lien de store mal saisi en administration suffit
     à produire ce cas. */
  const openStore = () => {
    Linking.openURL(storeUrl()).catch(() => {
      Alert.alert('Ouverture impossible', "Le store n'a pas pu être ouvert. Cherche « Relyka » dans ton magasin d'applications pour installer la mise à jour.");
    });
  };
  const checkUpdate = () => {
    if (updateAvailable) { openStore(); return; }
    if (!canCompareVersions) { openStore(); return; }
    if (!flagsLoaded) {
      Alert.alert('Vérification impossible', `Impossible de vérifier les mises à jour pour l'instant. Ta version installée est la v${APP_VERSION}.`);
    } else {
      Alert.alert('À jour', `Tu es bien sur la dernière version (v${APP_VERSION}).`);
    }
  };

  /* ⚠️ LE RÉGLAGE DE L'APPARENCE N'EST PLUS ICI — il a son propre écran (app/(tabs)/(secondary)/
     apparence.tsx). Une copie complète de sa logique (liste des couleurs, changement de mode et de
     couleur) survivait pourtant dans ce fichier, plus rendue par personne : du code que rien
     n'exécutait, mais que les recherches trouvaient — et qui résolvait déjà les couleurs
     DIFFÉREMMENT de l'écran Apparence. Deux vérités pour un même réglage, dont une invisible : on
     supprime celle qui ne sert plus. */

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
  const marginRowRef = useRef<any>(null);

  // ── Safety margin (montant en €) ──
  const handleSafetyAmountSave = useCallback(() => {
    const val = Math.max(0, parseFloat(safetyAmountInput.replace(',', '.')) || 0);
    setSafetyAmountInput(String(val));
    saveProfile({ safety_margin_amount: val });
  }, [safetyAmountInput, saveProfile]);

  const currentSafetyAmount = profile?.safety_margin_amount ?? 0;
  useEffect(() => {
    setSafetyAmountInput(String(currentSafetyAmount));
  }, [currentSafetyAmount]);

  /** Relancer les recommandations — on ne coche que si l'effacement est RÉELLEMENT parti. */
  const handleResetRecos = useCallback(async () => {
    if (readOnly) return;
    const ok = await resetDismissals();
    setRecosReset(ok ? 'done' : 'error');
    if (ok) setTimeout(() => setRecosReset('idle'), 3000);
  }, [readOnly, resetDismissals]);

  if (!user) {
    /* Repli défensif (session expirée, ouverture directe de l'adresse sur le web). Il s'affichait
       sur un fond nu, sans en-tête ni moyen de repartir ailleurs que par « Se connecter » : on lui
       donne la même mise en page que le reste de la page. */
    return (
      <View style={styles.root}>
        <StatusBar style={currentMode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'settings')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Paramètres" onBack={goBack} />
          <Text style={styles.text}>Connecte-toi pour accéder aux paramètres.</Text>
          <View style={{ marginTop: 16, gap: 12 }}>
            <TouchableOpacity style={styles.saveBtn} onPress={() => router.push('/login')} accessibilityRole="button">
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
        {/* En-tête PARTAGÉ (ScreenHeader), et HORS du défilement : cette page recopiait son propre
            « ← Retour » avec ses propres tailles, à l'intérieur du ScrollView — il disparaissait dès
            qu'on descendait dans la liste des réglages, alors qu'il reste fixe partout ailleurs. */}
        <ScreenHeader title="Paramètres" onBack={goBack} />

        <KeyboardAwareScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Consultation d'un autre compte : on le dit AVANT que quiconque touche à un
              interrupteur — sinon un simple clic changerait vraiment le réglage de la personne
              visitée (même règle que Mon profil et Apparence). */}
          {readOnly && (
            <View style={styles.notice}>
              <Ionicons name="eye-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.noticeText}>
                Consultation seule : tu es connecté en tant qu'un autre utilisateur. Aucun réglage de
                cette page ne sera modifié sur son compte.
              </Text>
            </View>
          )}

          {/* Un réglage qui n'est pas parti doit se voir : sans ça, l'interrupteur revient tout seul
              à sa position précédente et on croit que l'application « ne marche pas ». */}
          {saveError && (
            <View style={[styles.notice, { borderColor: COLORS.danger }]}>
              <Ionicons name="cloud-offline-outline" size={16} color={COLORS.danger} />
              <Text style={[styles.noticeText, { color: COLORS.danger }]}>
                Ton réglage n'a pas pu être enregistré. Vérifie ta connexion, puis réessaie.
              </Text>
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

            {/* Clôture mensuelle (si activée) — elle occupait une carte isolée tout en haut de la
                page, avant même le titre « Gestion », alors que c'est exactement de la gestion :
                elle fige un mois passé pour fiabiliser les moyennes du profil juste au-dessus. */}
            {closureEnabled && (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/cloture')}>
                <Ionicons name="lock-closed-outline" size={20} color="#60a5fa" />
                <Text style={styles.rowLabel}>Clôture mensuelle</Text>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}

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
                  onChangeText={(t) => setSafetyAmountInput(sanitizeAmountInput(t))}
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
                    accessibilityRole="button"
                    accessibilityLabel="Valider la marge de sécurité"
                    onPress={handleSafetyAmountSave}
                    style={{ backgroundColor: COLORS.emerald, borderRadius: 8, padding: 6 }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="checkmark" size={16} color={COLORS.onAccent} />
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
                      onPress={() => saveProfile({ prudence_level: opt.value })}
                      disabled={readOnly}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active, disabled: readOnly }}
                      style={[{ borderWidth: 1, borderColor: active ? COLORS.emerald : COLORS.cardBorder, backgroundColor: active ? COLORS.emerald + '1A' : 'transparent', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }, readOnly && styles.disabled]}
                      activeOpacity={0.85}
                    >
                      <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? COLORS.emerald : COLORS.textSecondary }}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingLeft: 30 }}>
                Détermine si tes revenus à venir (ex. salaire pas encore reçu) sont pris en compte dans le calcul de ton Relyka — le montant que tu peux allouer aux recommandations.{'\n'}Plus tu es prudent, plus on se base sur l'argent déjà encaissé.
              </Text>
              {/* Ordre de déduction : dans quel ordre les recos sont grignotées en cas de dépassement des dépenses variables. */}
              {deductionOrderKnown && (
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
              )}
            </View>
          </View>

          {/* ── Paramétrage (catégories + devise de référence) ── */}
          <Text style={styles.sectionTitle}>Paramétrage</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/(tabs)/(secondary)/categories')}>
              <Ionicons name="pie-chart-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Gérer les catégories</Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10, borderBottomWidth: 0 }]}>
              <Text style={styles.rowLabel}>Devise de référence</Text>
              <View style={readOnly ? styles.disabled : undefined} pointerEvents={readOnly ? 'none' : 'auto'}>
                <CurrencyPicker
                  value={profile?.currency_code ?? 'EUR'}
                  onChange={(code) => saveProfile({ currency_code: code })}
                />
              </View>
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
                accessibilityLabel="Afficher les conseils"
                value={tipsEnabled}
                onValueChange={setTipsEnabled}
                disabled={readOnly}
                trackColor={{ false: COLORS.cardBorder, true: COLORS.emerald }}
                thumbColor="#ffffff"
              />
            </View>
            <Text style={{ color: COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              Affiche le bandeau de conseils en haut de la page Pilotage. Désactive-le pour un écran plus épuré.
            </Text>
            <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
            {/* La coche ne s'allume QUE si l'effacement est réellement parti, et elle s'éteint au
                bout de quelques secondes : affichée en dur et pour toujours, elle confirmait une
                remise à zéro même quand l'écriture avait échoué — et elle restait ensuite à
                l'écran, laissant croire que le bouton n'était plus actionnable. */}
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: 0 }, readOnly && styles.disabled]}
              onPress={handleResetRecos}
              disabled={readOnly}
              accessibilityRole="button"
              accessibilityState={{ disabled: readOnly }}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={20} color={COLORS.emerald} />
              <Text style={[styles.rowLabel, { color: COLORS.emerald }]}>Relancer les recommandations</Text>
              {recosReset === 'done' && <Ionicons name="checkmark-circle" size={20} color={COLORS.emerald} />}
              {recosReset === 'error' && <Ionicons name="alert-circle" size={20} color={COLORS.danger} />}
            </TouchableOpacity>
            <Text style={{ color: recosReset === 'error' ? COLORS.danger : COLORS.textSecondary, fontSize: 11, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4, lineHeight: 15 }}>
              {recosReset === 'error'
                ? "Les recommandations n'ont pas pu être relancées. Vérifie ta connexion, puis réessaie."
                : 'Réaffiche dans le Pilotage toutes les recommandations ignorées ce mois-ci (selon ta situation actuelle).'}
            </Text>
            <View style={{ height: 1, backgroundColor: COLORS.cardBorder }} />
            <View style={[styles.row, { borderBottomWidth: 0 }]}>
              <Ionicons name="calculator-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.rowLabel}>Afficher la calculatrice</Text>
              <Switch
                accessibilityLabel="Afficher la calculatrice"
                value={calculatorEnabled}
                onValueChange={setCalculatorEnabled}
                disabled={readOnly}
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
                          readOnly && styles.disabled,
                        ]}
                        onPress={() => setCalculatorPages(on ? calculatorPages.filter((id) => id !== p.id) : [...calculatorPages, p.id])}
                        disabled={readOnly}
                        activeOpacity={0.8}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on, disabled: readOnly }}
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
                accessibilityLabel="E-mails d’information"
                value={(profile as any)?.email_opt_in ?? true}
                onValueChange={(v) => saveProfile({ email_opt_in: v })}
                disabled={readOnly}
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
                    accessibilityLabel="Notifications sur le téléphone"
                    value={wantsNotifs && pushPerm.granted}
                    disabled={readOnly}
                    onValueChange={async (v) => {
                      if (readOnly) return;
                      if (!v) { saveProfile({ notifications_enabled: false }); return; }
                      // Activer = obtenir l'autorisation système AVANT d'enregistrer le souhait.
                      if (pushPerm.granted) { saveProfile({ notifications_enabled: true }); return; }
                      const res = await pushPerm.request();
                      if (res === 'granted') { saveProfile({ notifications_enabled: true }); return; }
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
                    accessibilityLabel="Verrouiller l’app"
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
            {/* Trois états, pas deux : « à jour » est une AFFIRMATION, elle demande d'avoir lu la
                dernière version publiée. Tant que la lecture n'est pas revenue (ou qu'elle a
                échoué), on affiche la version installée sans rien promettre.
                Tutoiement : « appuyez pour l'installer » était le dernier vouvoiement de l'écran. */}
            <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} onPress={checkUpdate} activeOpacity={0.7} accessibilityRole="button">
              <Ionicons name={updateAvailable ? 'arrow-up-circle' : (canCompareVersions && flagsLoaded) ? 'checkmark-circle-outline' : 'help-circle-outline'} size={20} color={updateAvailable ? COLORS.emerald : COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Mise à jour</Text>
                <Text style={{ color: updateAvailable ? COLORS.emerald : COLORS.textSecondary, fontSize: 12, marginTop: 1 }}>
                  {updateAvailable
                    ? 'Nouvelle version disponible · touche pour l\'installer'
                    : !canCompareVersions
                      /* On ne peut pas savoir : on le dit, et on emmène au store plutôt que de
                         promettre « à jour » sur la foi d'un numéro qui n'est pas le bon. */
                      ? `Version v${APP_VERSION} · touche pour vérifier sur le store`
                      : flagsLoaded
                        ? `À jour · version installée v${APP_VERSION}`
                        : `Version installée v${APP_VERSION}`}
                </Text>
                {/* Le correctif reçu SANS passer par le store : l'app tourne sur un bundle plus
                    récent que son binaire. On le dit, plutôt que d'afficher l'un à la place de
                    l'autre — c'est exactement ce qui faisait annoncer « v1.0.8 » à quelqu'un resté
                    en 1.0.7 (cf. lib/platform/appVersion). */}
                {RUNNING_NEWER_BUNDLE && (
                  <Text style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
                    Correctifs appliqués : v{BUNDLE_VERSION}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          </>)}

          {/* ── LA SECTION « INFORMATIONS » A ÉTÉ RETIRÉE D'ICI ─────────────────────────────────
              Elle reprenait Confidentialité et Mentions légales, qui vivent déjà — et depuis
              toujours — sur la page Support. Un même lien à deux endroits, c'est une page de
              réglages qui s'allonge sans rien apprendre, et deux endroits à corriger le jour où
              l'un des deux textes bouge.
              ⚠️ L'EXIGENCE DES MAGASINS RESTE TENUE : la politique de confidentialité doit être
              atteignable DEPUIS l'app, et elle l'est — page Support (compte connecté), écran
              d'accueil et formulaire d'inscription (sans connexion), pied de page du site. */}
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

    // Bandeau d'information / d'erreur, en tête de page (mêmes valeurs que l'écran Apparence).
    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 14 },
    noticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: c.textSecondary },
    /** Réglage inopérant en consultation : il doit se VOIR inerte, pas seulement l'être. */
    disabled: { opacity: 0.45 },
    input: {
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 12,
    },
    saveBtn: { backgroundColor: c.emerald, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 28 },
    saveBtnLabel: { fontSize: 15, fontWeight: '700', color: c.onAccent },

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

    currencyHint: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },
  });
}
