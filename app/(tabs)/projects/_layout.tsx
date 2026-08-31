import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/theme/useAppColors';

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
      {/* Les budgets s'éditent sur une PAGE, comme les projets — pas dans une feuille qui monte du
          bas. On y renseigne plusieurs lignes à la suite : une demi-hauteur d'écran ne suffit pas,
          et le clavier en mangeait encore la moitié. */}
      <Stack.Screen name="budget-edit" options={{ title: 'Budgets' }} />
    </Stack>
  );
}
