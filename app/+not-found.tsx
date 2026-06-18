/**
 * Écran « route introuvable » : redirige automatiquement vers la racine
 * plutôt que de laisser l'utilisateur bloqué sur une page 404.
 * L'index décide ensuite de la destination (onboarding / accueil / login).
 */
import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppColors } from '../hooks/useAppColors';

export default function NotFoundScreen() {
  const router = useRouter();
  const COLORS = useAppColors();

  useEffect(() => {
    const t = setTimeout(() => {
      router.replace('/');
    }, 50);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: COLORS.bg }]}>
      <ActivityIndicator size="large" color={COLORS.emerald} />
      <Text style={[styles.text, { color: COLORS.textSecondary }]}>Redirection…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  text: { fontSize: 14 },
});
