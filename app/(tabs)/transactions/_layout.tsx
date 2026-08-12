import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/theme/useAppColors';

export default function TransactionsLayout() {
  const COLORS = useAppColors();
  return (
    // animation 'fade' : aligné sur la pile racine (pas de glissement latéral).
    <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ title: 'Nouvelle transaction' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier la transaction' }} />
    </Stack>
  );
}
