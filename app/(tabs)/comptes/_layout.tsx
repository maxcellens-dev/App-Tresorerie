import { Stack } from 'expo-router';
import { useAppColors } from '../../hooks/useAppColors';

export default function AccountsLayout() {
  const COLORS = useAppColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ title: 'Compte' }} />
      <Stack.Screen name="add" options={{ title: 'Nouveau compte' }} />
      <Stack.Screen name="transfer" options={{ title: 'Virement' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier le compte' }} />
    </Stack>
  );
}
