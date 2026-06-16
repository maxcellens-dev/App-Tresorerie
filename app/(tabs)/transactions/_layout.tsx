import { Stack } from 'expo-router';
import { useAppColors } from '../../hooks/useAppColors';

export default function TransactionsLayout() {
  const COLORS = useAppColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ title: 'Nouvelle transaction' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier la transaction' }} />
    </Stack>
  );
}
