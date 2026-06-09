import { useEffect } from 'react';
import { Stack, useSegments, useRouter } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TourProvider } from './contexts/TourContext';
import { useConfigSync } from './hooks/useConfigSync';
import { useMaterializeRecurring } from './hooks/useMaterializeRecurring';
import { supabase } from './lib/supabase';
import HeaderWithProfile from './components/HeaderWithProfile';
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

function AppChrome() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  useCurrency(); // synchronise le symbole de devise global avec le profil
  const segments = useSegments();
  const router = useRouter();
  const { user, loading } = useAuth();
  const root = segments[0] ?? 'index';
  const isAuthPage = root === 'index' || root === 'welcome' || root === 'login' || root === 'register';
  // Pendant le questionnaire, on masque l'en-tête (profil) : l'utilisateur doit le terminer.
  const hideChrome = isAuthPage || root === 'questionnaire' || root === 'confidentialite' || root === 'legal';
  const isTabs = root === '(tabs)';

  // Auth guard: redirect via useEffect so the Stack always mounts first
  useEffect(() => {
    if (loading) return;
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
        </Stack>
      </View>
      {/* Modale de changement de profil — affichée au-dessus de tout */}
      {isTabs && user && <ProfileChangeModal userId={user.id} />}
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
