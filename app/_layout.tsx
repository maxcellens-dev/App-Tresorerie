import { useEffect, useRef } from 'react';
import { Stack, useSegments, useRouter, usePathname } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TourProvider } from './contexts/TourContext';
import { useConfigSync } from './hooks/useConfigSync';
import { useMaterializeRecurring } from './hooks/useMaterializeRecurring';
import { supabase } from './lib/supabase';
import HeaderWithProfile from './components/HeaderWithProfile';
import { setAnalyticsUser, logEvent, trackScreen } from './lib/analytics';
import ProfileChangeModal from './components/ProfileChangeModal';
import FontApplier from './components/FontApplier';
import GamificationSync from './components/GamificationSync';
import { useAppColors } from './hooks/useAppColors';
import { useCurrency } from './hooks/useCurrency';
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

function RecurringMaterializer() {
  const { user } = useAuth();
  useMaterializeRecurring(user?.id);
  return null;
}

/** Suivi d'usage : app_open (1×/session) + screen_view à chaque changement de page. */
function AnalyticsTracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const openedFor = useRef<string | null>(null);

  useEffect(() => { setAnalyticsUser(user?.id ?? null); }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (openedFor.current !== user.id) {
      openedFor.current = user.id;
      logEvent('app_open');
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !pathname) return;
    trackScreen(pathname);
  }, [pathname, user?.id]);

  return null;
}

function AppChrome() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  useCurrency(); // synchronise le symbole de devise global avec le profil
  const segments = useSegments();
  const router = useRouter();
  const { user, loading, passwordRecovery } = useAuth();
  const root = segments[0] ?? 'index';
  const isAuthPage = root === 'index' || root === 'welcome' || root === 'login' || root === 'register' || root === 'reset-password';
  // Pendant le questionnaire, on masque l'en-tête (profil) : l'utilisateur doit le terminer.
  const hideChrome = isAuthPage || root === 'questionnaire' || root === 'confidentialite' || root === 'legal';
  const isTabs = root === '(tabs)';
  // Sur web bureau : on limite la largeur de l'app (colonne centrée ~840 px), comme une app mobile.
  // Exception : la page d'accueil marketing (welcome/index) reste pleine largeur.
  const limitWidth = Platform.OS === 'web' && root !== 'welcome' && root !== 'index';

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
      {!hideChrome && user && !isTabs && (
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
      <AnalyticsTracker />
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
