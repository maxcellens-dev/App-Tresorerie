import { useMemo, useEffect, useRef, useState } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, StyleSheet, Platform, useWindowDimensions, LogBox, BackHandler } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import AnimatedSplash from '../components/AnimatedSplash';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { TourProvider } from '../contexts/TourContext';
import { CalculatorProvider } from '../contexts/CalculatorContext';
import Calculator from '../components/Calculator';
import UpdateBanner from '../components/UpdateBanner';
import AchievementCelebration from '../components/AchievementCelebration';
import { useConfigSync } from '../hooks/useConfigSync';
import { useMaterializeRecurring } from '../hooks/useMaterializeRecurring';
import { supabase } from '../lib/supabase';
import HeaderWithProfile from '../components/HeaderWithProfile';
import { LEGAL_DESKTOP_MIN_WIDTH } from '../components/LegalLayout';
import ImpersonationBanner from '../components/ImpersonationBanner';
import { setAnalyticsUser, logEvent, trackScreen } from '../lib/analytics';
import { recordRoute, consumePreviousRoute } from '../lib/navHistory';
import ProfileChangeModal from '../components/ProfileChangeModal';
import StreakRecoveryModal from '../components/StreakRecoveryModal';
import FontApplier from '../components/FontApplier';
import GamificationSync from '../components/GamificationSync';
import AppDialogHost from '../components/AppDialogHost';
import { useAppColors } from '../hooks/useAppColors';
import { useCurrency } from '../hooks/useCurrency';
import { useProfile } from '../hooks/useProfile';
import { useSetPremium } from '../hooks/usePlan';
import { PURCHASES_SUPPORTED, configurePurchases, logInPurchases, isProActive, addProListener } from '../lib/purchases';
import { PUSH_SUPPORTED, getDevicePushTokenAsync } from '../lib/pushNotifications';
import './global.css';

// expo-router v4 scanne TOUS les fichiers de app/ comme des routes : nos dossiers non-route
// (hooks/, lib/, contexts/, theme/, services/, types/, components/) déclenchent un console.error
// « missing the required default export » par fichier → mur de LogBox qui masque l'écran en dev.
// C'est inoffensif (expo-router les ignore ensuite). On masque ce bruit dev + les warnings de style
// dépréciés des libs. À terme : sortir ces dossiers de app/ (cf. docs/MIGRATION_SDK52.md).
if (__DEV__) {
  LogBox.ignoreLogs([
    /missing the required default export/,
    /"(textShadow|shadow)\*" style props are deprecated/,
  ]);
}

// Empêche le splash natif de se cacher tout seul : on le garde jusqu'à ce que notre splash animé
// soit à l'écran (transition invisible natif → animé). Natif uniquement (no-op / non requis sur web).
if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  // Filet de sécurité : ne jamais rester bloqué sur le splash natif si l'UI tarde / échoue.
  setTimeout(() => { SplashScreen.hideAsync().catch(() => {}); }, 4000);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Données considérées « fraîches » 2 min → moins de refetchs → moins de re-rendus.
      staleTime: 1000 * 60 * 2,
      // Plus de refetch automatique au retour en avant-plan / focus (source de churn).
      // Le refetch au montage reste (respecte staleTime : ne retape pas si données fraîches).
      refetchOnWindowFocus: false,
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
  // Premium « manuel » (offert par un admin) : on ne le retire JAMAIS via RevenueCat.
  const isManual = !!(profile as any)?.premium_manual;
  const isPremiumRef = useRef(isPremiumDb);
  const isManualRef = useRef(isManual);
  useEffect(() => { isPremiumRef.current = isPremiumDb; }, [isPremiumDb]);
  useEffect(() => { isManualRef.current = isManual; }, [isManual]);

  useEffect(() => {
    if (!PURCHASES_SUPPORTED || !user?.id) return;
    let unsub = () => {};
    let cancelled = false;
    const apply = (active: boolean) => {
      if (active && !isPremiumRef.current) setPremium.mutate(true);
      // Rétrogradation UNIQUEMENT si le Premium n'est pas un grant manuel admin.
      else if (!active && isPremiumRef.current && !isManualRef.current) setPremium.mutate(false);
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
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
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

  // Bouton retour PHYSIQUE Android : retour FIABLE vers la page réellement précédente (via
  // navHistory), au lieu du dépilage par défaut de la pile imbriquée qui atterrit sur une page
  // obsolète ou Comptes. Même logique que le bouton « Retour » in-app (useNavBack).
  const isAuthPageRef = useRef(isAuthPage);
  isAuthPageRef.current = isAuthPage;
  const backPathname = usePathname();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBack = () => {
      // Sur les pages d'auth (welcome/login…) : comportement par défaut (quitter l'app).
      if (isAuthPageRef.current) return false;
      const prev = consumePreviousRoute();
      if (prev) { router.navigate(prev as any); return true; }
      return false; // aucune page précédente (racine) → défaut (quitter l'app)
    };
    // Ré-abonnement à chaque navigation : notre handler reste le dernier enregistré (donc appelé
    // en premier), prioritaire sur le retour par défaut de la pile imbriquée.
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router, backPathname]);

  return (
    <TourProvider>
    <View style={styles.root}>
      <View style={limitWidth ? styles.webColumn : styles.fullColumn}>
      <AppDialogHost />
      <ImpersonationBanner />
      {!hideChrome && user && !isTabs && root !== 'legal' && root !== 'confidentialite' && (
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <HeaderWithProfile height={80} />
        </SafeAreaView>
      )}
      <View style={styles.content}>
        {/* Transitions en FONDU (pas de slide) : l'accueil apparaît EN PLACE sous le splash,
            plus d'effet « écran qui arrive de la gauche ». */}
        <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
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
      {/* Calculatrice flottante globale — visible quand ouverte, par-dessus tout */}
      <Calculator />
      {/* Bandeau « mise à jour disponible » (descend du haut) */}
      <UpdateBanner />
      {/* Célébration globale d'un succès débloqué (par-dessus tout) */}
      <AchievementCelebration />
    </View>
    </TourProvider>
  );
}

export default function RootLayout() {
  // Splash animé : natif uniquement (le web a déjà son boot-loader HTML dans app/+html.tsx).
  const [splashDone, setSplashDone] = useState(Platform.OS === 'web');
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <CalculatorProvider>
            <ConfigSync />
            <FontApplier />
            <RecurringMaterializer />
            <GamificationSync />
            <PurchasesSync />
            <PushRegistrar />
            <AppChrome />
            {!splashDone && (
              <AnimatedSplash
                onReady={() => { SplashScreen.hideAsync().catch(() => {}); }}
                onDone={() => setSplashDone(true)}
              />
            )}
          </CalculatorProvider>
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
