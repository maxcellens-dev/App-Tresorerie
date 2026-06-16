import { Stack } from 'expo-router';
import { useAppColors } from '../../hooks/useAppColors';

export default function SecondaryLayout() {
  const COLORS = useAppColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="profile" />
      <Stack.Screen name="parametres" />
      <Stack.Screen name="apparence" />
      <Stack.Screen name="support" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="mes-donnees" />
      <Stack.Screen name="cloture" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="about" />
      <Stack.Screen name="assistance" />
      <Stack.Screen name="ideas" />
      <Stack.Screen name="succes" />
      <Stack.Screen name="boutique" />
      <Stack.Screen name="premium" />
      <Stack.Screen name="relyka-world" />
      <Stack.Screen name="admin" />
    </Stack>
  );
}
