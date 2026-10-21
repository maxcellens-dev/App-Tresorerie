/**
 * Paramètres — habillés comme le reste du Jardin : une carte par sujet, une pastille de couleur par
 * réglage, les vrais mots.
 *
 * ⚠️ « CONNECTÉ EN TANT QUE » : on regarde, on ne touche pas. Tous les réglages s'écrivent dans
 * `profiles` (ou `profiles.ui_prefs`), et la politique d'accès laisse un administrateur écrire sur
 * n'importe quel profil : effleurer un interrupteur en consultation changeait POUR DE BON le réglage
 * de la personne. Même règle que Mon profil et Apparence.
 *
 * Une écriture qui échoue fait revenir l'interrupteur tout seul (mise à jour optimiste) : on le DIT.
 */
import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { View, Pressable, Switch, Linking, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/layout/ScreenHeader';
import GardenPage from '../../../components/garden/GardenPage';
import GardenText from '../../../components/garden/GardenText';
import GardenIcon from '../../../components/garden/GardenIcon';
import GardenButton from '../../../components/garden/GardenButton';
import CurrencyPicker from '../../../components/account/CurrencyPicker';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile, useUpdateProfile } from '../../../hooks/data/useProfile';
import { useNavBack } from '../../../hooks/platform/useNavBack';
import { useFeatureFlags } from '../../../hooks/config/useFeatureFlags';
import { useCalculator } from '../../../contexts/CalculatorContext';
import { usePilotageTips, CALCULATOR_PAGES } from '../../../hooks/config/useUiPrefs';
import { useRecoThresholds } from '../../../hooks/pilotage/useRecoThresholds';
import { useFinancialProfile } from '../../../hooks/pilotage/useFinancialProfile';
import { usePushPermission } from '../../../hooks/platform/usePushPermission';
import { resolveConsumptionMode, getConsumptionOrder } from '../../../lib/finance/recommendationEngine';
import { CHOICE_LOOKS } from '../../../lib/garden/choiceLooks';
import type { FinancialProfileId } from '../../../types/database';
import { APP_VERSION, BUNDLE_VERSION, RUNNING_NEWER_BUNDLE, NATIVE_VERSION_KNOWN, shouldOfferStoreUpdate } from '../../../lib/platform/appVersion';
import { APP_LOCK_SUPPORTED, getAppLockEnabled, setAppLockEnabled, isDeviceAuthAvailable, runDeviceAuth } from '../../../lib/auth/appLock';
import { diagnosePushRegistration } from '../../../lib/platform/pushNotifications';
import { GARDEN_COLORS as G, GARDEN_RADII, GARDEN_SPACE } from '../../../lib/garden/theme';
import { MAX_W, IS_WEB, pointer, transition } from '../../../lib/ui/webLayout';

const ANDROID_PACKAGE = 'com.relyka.myapp';

const PRUDENCE: { label: string; value: number | null; hint: string }[] = [
  { label: 'Auto', value: null, hint: 'selon ton profil' },
  { label: 'Dynamique', value: 25, hint: 'compte tes rentrées prévues' },
  { label: 'Équilibré', value: 50, hint: 'un peu des deux' },
  { label: 'Prudent', value: 75, hint: "l'argent déjà arrivé" },
];

/* ── Briques de la page ─────────────────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: GARDEN_SPACE.sm }}>
      <GardenText variant="label" style={{ paddingHorizontal: 4 }}>{title}</GardenText>
      <View style={{ backgroundColor: G.card, borderRadius: GARDEN_RADII.lg, borderWidth: 1, borderColor: G.line, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

/** Une ligne de réglage : pastille, libellé et précision, puis l'interrupteur ou le chevron. */
function Row({ icon, fg, bg, label, sub, first, right, onPress, children, disabled }: {
  icon: string; fg: string; bg: string; label: string; sub?: string; first?: boolean;
  right?: ReactNode; onPress?: () => void; children?: ReactNode; disabled?: boolean;
}) {
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GARDEN_SPACE.md }}>
      <GardenIcon icon={icon} fg={fg} bg={bg} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <GardenText variant="bodyStrong">{label}</GardenText>
        {sub ? <GardenText variant="small" color={G.muted}>{sub}</GardenText> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={G.muted} /> : null)}
    </View>
  );
  const box = [{ paddingHorizontal: GARDEN_SPACE.lg, paddingVertical: 12, gap: GARDEN_SPACE.md, opacity: disabled ? 0.45 : 1 }, first ? null : { borderTopWidth: 1, borderTopColor: G.line }];
  if (!onPress) return <View style={box}>{head}{children}</View>;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed, hovered }: any) => [...box, (pressed || hovered) ? { backgroundColor: G.field } : null, pointer, transition]}>
      {head}{children}
    </Pressable>
  );
}

function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ false: G.track, true: G.primary }} thumbColor="#FFFFFF" />;
}

function Chip({ label, on, onPress, disabled, role = 'radio' }: { label: string; on: boolean; onPress: () => void; disabled?: boolean; role?: 'radio' | 'checkbox' }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole={role} accessibilityState={role === 'radio' ? { selected: on, disabled } : { checked: on, disabled }}
      style={[{ paddingVertical: 8, paddingHorizontal: 13, borderRadius: GARDEN_RADII.pill, borderWidth: 1.5, borderColor: on ? G.primary : G.line, backgroundColor: on ? G.branchesBg : G.card }, pointer]}>
      <GardenText variant="smallStrong" color={on ? G.primary : G.inkSoft}>{label}</GardenText>
    </Pressable>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────────────────────── */

export default withDeferredMount(SettingsScreen);
function SettingsScreen() {
  const router = useRouter();
  const goBack = useNavBack();
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const updateProfile = useUpdateProfile(user?.id);
  const readOnly = isImpersonating;

  const [saveError, setSaveError] = useState(false);
  const saveProfile = useCallback((patch: Parameters<typeof updateProfile.mutate>[0]) => {
    if (readOnly) return;
    setSaveError(false);
    updateProfile.mutate(patch, { onError: () => setSaveError(true) });
  }, [readOnly, updateProfile]);

  const { enabled: calculatorEnabled, setEnabled: setCalculatorEnabled, pages: calculatorPages, setPages: setCalculatorPages } = useCalculator();
  const { enabled: tipsEnabled, setEnabled: setTipsEnabled } = usePilotageTips(user?.id);
  const [pushDiag, setPushDiag] = useState<string | null>(null);
  const pushPerm = usePushPermission();
  const { data: recoThresholds } = useRecoThresholds();
  const { data: financialProfile, isSuccess: fpLoaded } = useFinancialProfile(user?.id);

  /* Ordre dans lequel les choix de Pépin rétrécissent si tu dépasses ton budget du quotidien.
     En « Auto », il dépend du profil financier : on ne l'affiche qu'une fois celui-ci connu (sinon
     on montrait l'ordre « prudent » par défaut, qui changeait une seconde plus tard). */
  const prudenceLevel = ((profile as any)?.prudence_level ?? null) as number | null;
  const deductionOrderKnown = prudenceLevel != null || fpLoaded;
  const deductionOrder = useMemo(() => getConsumptionOrder(
    resolveConsumptionMode(prudenceLevel, financialProfile?.profile_id as FinancialProfileId | undefined, recoThresholds?.auto_profile_map),
    recoThresholds?.consumption_orders,
  ), [prudenceLevel, financialProfile, recoThresholds]);

  // Verrouillage (biométrie / code de l'appareil) — réglage LOCAL à cet appareil.
  const [appLockOn, setAppLockOn] = useState(false);
  useEffect(() => { getAppLockEnabled().then(setAppLockOn); }, []);
  const toggleAppLock = useCallback(async (next: boolean) => {
    if (next) {
      if (!(await isDeviceAuthAvailable())) {
        Alert.alert('Indisponible', "Configure d'abord une empreinte, Face ID ou un code de verrouillage dans les réglages de ton téléphone.");
        return;
      }
      // On vérifie que tu sais déverrouiller AVANT d'activer (sinon tu t'enfermes dehors).
      if (!(await runDeviceAuth('Confirme pour activer le verrouillage'))) return;
      await setAppLockEnabled(true); setAppLockOn(true);
    } else {
      if (!(await runDeviceAuth('Confirme pour désactiver le verrouillage'))) return;
      await setAppLockEnabled(false); setAppLockOn(false);
    }
  }, []);

  const isAdmin = profile?.is_admin ?? false;
  const wantsNotifs = (profile as any)?.notifications_enabled ?? true;
  const { data: featureFlags, isSuccess: flagsLoaded } = useFeatureFlags();
  const closureEnabled = Boolean(featureFlags?.monthly_closure_enabled);

  /* « Suis-je à jour ? » : trois réponses, dont un « je ne sais pas » assumé. Sans la version
     réellement installée (vieux binaire), on n'affirme rien et on propose le store. Même décision
     que le bandeau de mise à jour (lib/platform/appVersion). */
  const updateAvailable = shouldOfferStoreUpdate(featureFlags?.latest_version);
  const openStore = () => {
    const url = Platform.OS === 'ios'
      ? (featureFlags?.update_url_ios || 'https://apps.apple.com/')
      : (featureFlags?.update_url_android || `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`);
    Linking.openURL(url).catch(() => Alert.alert('Ouverture impossible', "Le store n'a pas pu être ouvert. Cherche « Relyka » dans ton magasin d'applications pour installer la mise à jour."));
  };
  const checkUpdate = () => {
    if (updateAvailable || !NATIVE_VERSION_KNOWN) { openStore(); return; }
    if (!flagsLoaded) Alert.alert('Vérification impossible', `Impossible de vérifier les mises à jour pour l'instant. Ta version installée est la v${APP_VERSION}.`);
    else Alert.alert('À jour', `Tu es bien sur la dernière version (v${APP_VERSION}).`);
  };
  const updateSub = updateAvailable ? "Nouvelle version disponible · touche pour l'installer"
    : !NATIVE_VERSION_KNOWN ? `Version v${APP_VERSION} · touche pour vérifier sur le store`
    : flagsLoaded ? `À jour · version installée v${APP_VERSION}` : `Version installée v${APP_VERSION}`;

  /* L'interrupteur des notifications reflète le TÉLÉPHONE, pas seulement le souhait enregistré :
     « activé » alors que l'OS refuse, c'est mentir. L'allumer déclenche ce qui manque réellement. */
  const togglePush = async (v: boolean) => {
    if (readOnly) return;
    if (!v) { saveProfile({ notifications_enabled: false }); return; }
    if (pushPerm.granted) { saveProfile({ notifications_enabled: true }); return; }
    const res = await pushPerm.request();
    if (res === 'granted') { saveProfile({ notifications_enabled: true }); return; }
    Alert.alert('Autorisation refusée', 'Les notifications de Relyka sont bloquées dans les réglages de ton téléphone. Ouvre-les pour les autoriser.', [
      { text: 'Plus tard', style: 'cancel' },
      { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings().catch(() => {}) },
    ]);
  };

  if (!user) {
    return (
      <GardenPage secondary header={<ScreenHeader title="Paramètres" onBack={goBack} />}>
        <GardenText variant="body">Connecte-toi pour accéder aux paramètres.</GardenText>
        <GardenButton label="Se connecter" onPress={() => router.push('/login')} />
      </GardenPage>
    );
  }

  return (
    <GardenPage secondary header={<ScreenHeader title="Paramètres" onBack={goBack} />}>
      <View style={{ width: '100%', maxWidth: MAX_W.dialog, alignSelf: 'center', gap: GARDEN_SPACE.lg }}>
        {readOnly ? (
          <View style={{ flexDirection: 'row', gap: 8, backgroundColor: G.notice, borderRadius: GARDEN_RADII.md, padding: 14 }}>
            <Ionicons name="eye-outline" size={16} color={G.noticeText} />
            <GardenText variant="small" color={G.noticeText} style={{ flex: 1 }}>Consultation seule : tu es connecté en tant qu'un autre utilisateur. Aucun réglage de cette page ne sera modifié sur son compte.</GardenText>
          </View>
        ) : null}
        {saveError ? (
          <View style={{ flexDirection: 'row', gap: 8, backgroundColor: G.flowersBg, borderRadius: GARDEN_RADII.md, padding: 14 }}>
            <Ionicons name="cloud-offline-outline" size={16} color={G.flowersText} />
            <GardenText variant="small" color={G.flowersText} style={{ flex: 1 }}>Ton réglage n'a pas pu être enregistré. Vérifie ta connexion, puis réessaie.</GardenText>
          </View>
        ) : null}

        {/* ── Ton Relyka ── */}
        <Section title="Ton Relyka">
          <Row first icon="speedometer-outline" fg={G.rootsText} bg={G.rootsBg} label="Prudence"
            sub="Tes rentrées pas encore arrivées (ton salaire du mois, par exemple) comptent-elles déjà dans l'eau de ton arrosoir ? Plus tu es prudent, plus on se base sur l'argent déjà arrivé.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {PRUDENCE.map((o) => <Chip key={o.label} label={o.label} on={prudenceLevel === o.value} onPress={() => saveProfile({ prudence_level: o.value })} disabled={readOnly} />)}
            </View>
            {deductionOrderKnown ? (
              <View style={{ gap: 6 }}>
                <GardenText variant="small" color={G.inkSoft}>Si tu dépenses plus que d'habitude, les choix de Pépin rétrécissent dans cet ordre :</GardenText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {deductionOrder.map((type, i) => (
                    <View key={type} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: GARDEN_RADII.pill, backgroundColor: CHOICE_LOOKS[type].bg }}>
                        <GardenText variant="smallStrong" color={CHOICE_LOOKS[type].fg} style={{ fontSize: 12 }}>{CHOICE_LOOKS[type].meaning}</GardenText>
                      </View>
                      {i < deductionOrder.length - 1 ? <Ionicons name="chevron-forward" size={12} color={G.muted} /> : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </Row>
          {closureEnabled ? (
            <Row icon="lock-closed-outline" fg={G.waterText} bg={G.waterBg} label="Mes bilans de mois" sub="clôturer un mois passé" onPress={() => router.push('/(tabs)/(secondary)/cloture' as any)} />
          ) : null}
        </Section>

        {/* ── Ton argent ── */}
        <Section title="Ton argent">
          <Row first icon="pricetags-outline" fg={G.fruitsText} bg={G.fruitsBg} label="Catégories" sub="ranger tes dépenses et tes rentrées" onPress={() => router.push('/(tabs)/(secondary)/categories' as any)} />
          <Row icon="cash-outline" fg={G.branchesText} bg={G.branchesBg} label="Devise de référence"
            sub="La devise de tes totaux. Chaque compte garde la sienne ; les totaux y sont convertis au taux du jour.">
            <View style={readOnly ? { opacity: 0.45 } : undefined} pointerEvents={readOnly ? 'none' : 'auto'}>
              <CurrencyPicker value={profile?.currency_code ?? 'EUR'} onChange={(code) => saveProfile({ currency_code: code })} />
            </View>
          </Row>
        </Section>

        {/* ── Aides ── */}
        <Section title="Aides">
          <Row first icon="bulb-outline" fg={G.picoText} bg={G.pico} label="Le conseil du jour" sub="une astuce en bas de la page Jardin"
            right={<Toggle label="Le conseil du jour" value={tipsEnabled} onChange={setTipsEnabled} disabled={readOnly} />} />
          <Row icon="calculator-outline" fg={G.waterText} bg={G.waterBg} label="Calculatrice" sub="un bouton flottant, à déplacer où tu veux"
            right={<Toggle label="Calculatrice" value={calculatorEnabled} onChange={setCalculatorEnabled} disabled={readOnly} />}>
            {calculatorEnabled ? (
              <View style={{ gap: 6 }}>
                <GardenText variant="small" color={G.inkSoft}>Sur ces pages :</GardenText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {CALCULATOR_PAGES.map((p) => {
                    const on = calculatorPages.includes(p.id);
                    return <Chip key={p.id} role="checkbox" label={p.label} on={on} disabled={readOnly}
                      onPress={() => setCalculatorPages(on ? calculatorPages.filter((id) => id !== p.id) : [...calculatorPages, p.id])} />;
                  })}
                </View>
                {calculatorPages.length === 0 ? <GardenText variant="small" color={G.muted}>Aucune page choisie : le bouton n'apparaîtra nulle part.</GardenText> : null}
              </View>
            ) : null}
          </Row>
        </Section>

        {/* ── Notifications : e-mail et téléphone au même endroit (« comment Relyka me joint ? »).
            Le push n'existe pas sur le web. ── */}
        <Section title="Notifications">
          <Row first icon="mail-outline" fg={G.flowersText} bg={G.flowersBg} label="E-mails d'information"
            sub="Nouveautés et conseils. Les e-mails de sécurité (mot de passe, adresse) partent toujours."
            right={<Toggle label="E-mails d'information" value={(profile as any)?.email_opt_in ?? true} onChange={(v) => saveProfile({ email_opt_in: v })} disabled={readOnly} />} />
          {!IS_WEB ? (
            <Row icon="notifications-outline" fg={G.picoText} bg={G.pico} label="Notifications sur le téléphone" sub="réponses de l'assistance, rappels, annonces"
              right={<Toggle label="Notifications sur le téléphone" value={wantsNotifs && pushPerm.granted} onChange={togglePush} disabled={readOnly} />}>
              {pushPerm.blocked && wantsNotifs ? (
                <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={{ flexDirection: 'row', gap: 8, padding: 11, borderRadius: GARDEN_RADII.sm, backgroundColor: G.notice }}>
                  <Ionicons name="warning-outline" size={16} color={G.noticeText} />
                  <GardenText variant="small" color={G.noticeText} style={{ flex: 1 }}>Ton téléphone bloque les notifications de Relyka. Touche ici pour les autoriser.</GardenText>
                </Pressable>
              ) : null}
            </Row>
          ) : null}
          {!IS_WEB && isAdmin ? (
            <Row icon="pulse-outline" fg={G.inkSoft} bg={G.field} label="Diagnostic push (admin)"
              onPress={async () => {
                setPushDiag('Analyse en cours…');
                try { setPushDiag(await diagnosePushRegistration()); } catch (e: any) { setPushDiag(`Diagnostic impossible : ${e?.message ?? String(e)}`); }
              }}>
              {pushDiag ? <GardenText variant="small" selectable>{pushDiag}</GardenText> : null}
            </Row>
          ) : null}
        </Section>

        {/* ── Application : verrouillage et mise à jour n'existent que sur le téléphone ── */}
        {!IS_WEB ? (
          <Section title="Application">
            {APP_LOCK_SUPPORTED ? (
              <Row first icon="finger-print-outline" fg={G.waterText} bg={G.waterBg} label="Verrouiller l'app" sub="Face ID, empreinte ou code du téléphone à l'ouverture"
                right={<Toggle label="Verrouiller l'app" value={appLockOn} onChange={toggleAppLock} />} />
            ) : null}
            <Row first={!APP_LOCK_SUPPORTED} icon={updateAvailable ? 'arrow-up-circle-outline' : 'checkmark-circle-outline'} fg={updateAvailable ? G.primary : G.inkSoft} bg={updateAvailable ? G.branchesBg : G.field}
              label="Mise à jour" sub={RUNNING_NEWER_BUNDLE ? `${updateSub}\nCorrectifs appliqués : v${BUNDLE_VERSION}` : updateSub} onPress={checkUpdate} />
          </Section>
        ) : null}
      </View>
    </GardenPage>
  );
}
