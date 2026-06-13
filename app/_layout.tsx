import { useEffect, useRef } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TourProvider } from './contexts/TourContext';
import { useConfigSync } from './hooks/useConfigSync';
import { useMaterializeRecurring } from './hooks/useMaterializeRecurring';
import { supabase } from './lib/supabase';
import HeaderWithProfile from './components/HeaderWithProfile';
import { LEGAL_DESKTOP_MIN_WIDTH } from './components/LegalLayout';
import ImpersonationBanner from './components/ImpersonationBanner';
import { setAnalyticsUser, logEvent, trackScreen } from './lib/analytics';
import { recordRoute } from './lib/navHistory';
import ProfileChangeModal from './components/ProfileChangeModal';
import StreakRecoveryModal from './components/StreakRecoveryModal';
import FontApplier from './components/FontApplier';
import GamificationSync from './components/GamificationSync';
import { useAppColors } from './hooks/useAppColors';
import { useCurrency } from './hooks/useCurrency';
import { useProfile } from './hooks/useProfile';
import { useSetPremium } from './hooks/usePlan';
import { PURCHASES_SUPPORTED, configurePurchases, logInPurchases, isProActive, addProListener } from './lib/purchases';
import { PUSH_SUPPORTED, getDevicePushTokenAsync } from './lib/pushNotifications';
import './global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 s
      refetchOnWindowFocus: true,
      refetchOnMount: true,
    },
  },
});

function ConfigSync() {
  useConfigSync(supabase);
  return null;
}

/** Synchronise l'abonnement RevenueCat (natif) avec le droit Premium (profiles.is_premium).
 *  Sur mobile, RevenueCat fait foi : achat confirmé → Premium ; expiration/annulation effective → retrait.
 *  Aucun effet sur le web (PURCHASES_SUPPORTED = false). */
function PurchasesSync() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const setPremium = useSetPremium(user?.id);
  const isPremiumDb = !!(profile as any)?.is_premium;
  const isPremiumRef = useRef(isPremiumDb);
  useEffect(() => { isPremiumRef.current = isPremiumDb; }, [isPremiumDb]);

  useEffect(() => {
    if (!PURCHASES_SUPPORTED || !user?.id) return;
    let unsub = () => {};
    let cancelled = false;
    const apply = (active: boolean) => {
      if (active && !isPremiumRef.current) setPremium.mutate(true);
      else if (!active && isPremiumRef.current) setPremium.mutate(false);
    };
    (async () => {
      await configurePurchases(user.id);
      await logInPurchases(user.id);
      if (cancelled) return;
      apply(await isProActive());
      unsub = addProListener(apply);
    })();
    return () => { cancelled = true; unsub(); };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Enregistre le jeton push Expo de l'appareil (natif uniquement) quand l'utilisateur
 *  est connecté et que les notifications sont activées dans ses Paramètres. */
function PushRegistrar() {
  const { user, isImpersonating } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const notifEnabled = (profile as any)?.notifications_enabled ?? true;

  useEffect(() => {
    if (!PUSH_SUPPORTED || !user?.id || !profile || isImpersonating) return;
    if (!notifEnabled) return;
    let cancelled = false;
    (async () => {
      const device = await getDevicePushTokenAsync();
      if (cancelled || !device || !supabase) return;
      await supabase.from('push_tokens').upsert(
        { profile_id: user.id, token: device.token, platform: device.platform, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id,token' },
      );
    })();
    return () => { cancelled = true; };
  }, [user?.id, !!profile, notifEnabled, isImpersonating]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Suit le chemin courant pour permettre un « Retour » fiable vers la vraie page précédente
 *  (cf. useNavBack), indépendamment de la pile de navigation imbriquée. Toujours monté. */
function RouteHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => { recordRoute(pathname); }, [pathname]);
  return null;
}

function RecurringMaterializer() {
  const { user, isImpersonating } = useAuth();
  // En mode « connecté en tant que », on NE matérialise/reconcilie PAS : consulter un compte
  // ne doit pas écrire dans les données de l'utilisateur (avancer ses récurrences, etc.).
  useMaterializeRecurring(isImpersonating ? undefined : user?.id);
  return null;
}

/** Suivi d'usage : app_open (1×/session) + screen_view à chaque changement de page.
 *  Désactivé en mode « connecté en tant que » pour ne pas polluer les stats du compte cible. */
function AnalyticsTracker() {
  const { user, isImpersonating } = useAuth();
  const pathname = usePathname();
  const openedFor = useRef<string | null>(null);

  useEffect(() => { setAnalyticsUser(isImpersonating ? null : (user?.id ?? null)); }, [user?.id, isImpersonating]);

  useEffect(() => {
    if (!user?.id || isImpersonating) return;
    if (openedFor.current !== user.id) {
      openedFor.current = user.id;
      logEvent('app_open');
    }
  }, [user?.id, isImpersonating]);

  useEffect(() => {
    if (!user?.id || !pathname || isImpersonating) return;
    trackScreen(pathname);
  }, [pathname, user?.id, isImpersonating]);

  return null;
}

function AppChrome() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  useCurrency(); // synchronise le symbole de devise global avec le profil
  const segments = useSegments();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { user, loading, passwordRecovery } = useAuth();
  const root = segments[0] ?? 'index';
  const isAuthPage = root === 'index' || root === 'welcome' || root === 'login' || root === 'register' || root === 'reset-password';
  // Pendant le questionnaire, on masque l'en-tête (profil) : l'utilisateur doit le terminer.
  // Les pages légales gardent l'en-tête de l'app quand l'utilisateur est connecté (sinon : en-tête « site »).
  const hideChrome = isAuthPage || root === 'questionnaire';
  const isTabs = root === '(tabs)';
  // Sur web bureau : on limite la largeur de l'app (colonne centrée ~840 px), comme une app mobile.
  // Exceptions pleine largeur : page d'accueil marketing (welcome/index).
  // Pages légales : pleine largeur (habillage « site web ») UNIQUEMENT en bureau (web large).
  // En mobile/app (largeur < 900 px), elles s'affichent dans la colonne d'app comme les autres pages.
  const isLegalRoot = root === 'confidentialite' || root === 'legal';
  const isDesktopLegal = Platform.OS === 'web' && isLegalRoot && windowWidth >= LEGAL_DESKTOP_MIN_WIDTH;
  const limitWidth = Platform.OS === 'web'
    && root !== 'welcome' && root !== 'index'
    && !isDesktopLegal;

  // Lien de réinitialisation de mot de passe → écran dédié (prioritaire sur le reste).
  useEffect(() => {
    if (passwordRecovery && root !== 'reset-password') router.replace('/reset-password');
  }, [passwordRecovery, root]);

  // Auth guard: redirect via useEffect so the Stack always mounts first
  useEffect(() => {
    if (loading) return;
    if (passwordRecovery) return; // ne pas court-circuiter la réinitialisation
    if (isTabs && !user) {
      router.replace('/welcome');
    } else if (user && (root === 'welcome' || root === 'login' || root === 'register')) {
      // Rediriger vers l'index : il décide setup / questionnaire / home
      // selon l'avancement de l'onboarding (ne pas court-circuiter le questionnaire).
      router.replace('/');
    }
  }, [loading, user, isTabs, root]);

  return (
    <TourProvider>
    <View style={styles.root}>
      <View style={limitWidth ? styles.webColumn : styles.fullColumn}>
      <ImpersonationBanner />
      {!hideChrome && user && !isTabs && root !== 'legal' && root !== 'confidentialite' && (
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <HeaderWithProfile height={80} />
        </SafeAreaView>
      )}
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'Relyka' }} />
          <Stack.Screen name="welcome" options={{ title: 'Relyka' }} />
          <Stack.Screen name="login" options={{ title: 'Connexion' }} />
          <Stack.Screen name="register" options={{ title: 'Inscription' }} />
          <Stack.Screen name="questionnaire" options={{ title: 'Profil financier' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="confidentialite" options={{ title: 'Confidentialité' }} />
          <Stack.Screen name="legal" options={{ title: 'Mentions légales' }} />
          <Stack.Screen name="reset-password" options={{ title: 'Réinitialiser le mot de passe' }} />
        </Stack>
      </View>
      </View>
      {/* Modale de changement de profil — affichée au-dessus de tout */}
      {isTabs && user && <ProfileChangeModal userId={user.id} />}
      {/* Récupération de série perdue — proposée à l'arrivée sur l'app */}
      {isTabs && user && <StreakRecoveryModal />}
      <AnalyticsTracker />
      <RouteHistoryTracker />
    </View>
    </TourProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ConfigSync />
          <FontApplier />
          <RecurringMaterializer />
          <GamificationSync />
          <PurchasesSync />
          <PushRegistrar />
          <AppChrome />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    fullColumn: { flex: 1, width: '100%' },
    // Colonne centrée pour le web bureau (largeur d'app « mobile » classique).
    webColumn: { flex: 1, width: '100%', maxWidth: 840, alignSelf: 'center', borderLeftWidth: 1, borderRightWidth: 1, borderColor: c.cardBorder },
    headerSafe: {
      paddingHorizontal: 24,
      paddingTop: 6,
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.cardBorder,
      backgroundColor: c.bg,
    },
    content: { flex: 1 },
  });
}
