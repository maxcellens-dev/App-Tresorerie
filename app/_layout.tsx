import { Redirect, Stack, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useConfigSync } from './hooks/useConfigSync';
import { supabase } from './lib/supabase';
import HeaderWithProfile from './components/HeaderWithProfile';
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

function AppChrome() {
  const segments = useSegments();
  const { user, loading } = useAuth();
  const root = segments[0] ?? 'index';
  const hideChrome = root === 'index' || root === 'welcome' || root === 'login' || root === 'register';
  const isTabs = root === '(tabs)';

  if (!loading && root === '(tabs)' && !user) {
    return <Redirect href="/welcome" />;
  }

  return (
    <View style={styles.root}>
      {!hideChrome && user && !isTabs && (
        <SafeAreaView edges={['top']} style={styles.headerSafe}>
          <HeaderWithProfile height={80} />
        </SafeAreaView>
      )}
      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'Trésorerie' }} />
          <Stack.Screen name="welcome" options={{ title: 'Trésorerie' }} />
          <Stack.Screen name="login" options={{ title: 'Connexion' }} />
          <Stack.Screen name="register" options={{ title: 'Inscription' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        </Stack>
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ConfigSync />
          <AppChrome />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617' },
  headerSafe: {
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(30, 41, 59, 0.9)',
    backgroundColor: 'rgba(2, 6, 23, 0.98)',
  },
  content: { flex: 1 },
});
