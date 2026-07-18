import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/useAppColors';

export default function ProjectsLayout() {
  const COLORS = useAppColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // animation 'fade' : aligné sur la pile racine (pas de glissement latéral).
        animation: 'fade',
        contentStyle: { backgroundColor: COLORS.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ title: 'Projet' }} />
    </Stack>
  );
}
