import { Stack } from 'expo-router';
import { useAppColors } from '../../../../hooks/theme/useAppColors';

export default function RelykaWorldLayout() {
  const COLORS = useAppColors();
  return (
    // animation 'fade' : aligné sur la pile racine (pas de glissement latéral).
    <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="add-expense" />
    </Stack>
  );
}
