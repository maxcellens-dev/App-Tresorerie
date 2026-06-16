import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/useAppColors';

export default function RelykaWorldLayout() {
  const COLORS = useAppColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="add-expense" />
    </Stack>
  );
}
