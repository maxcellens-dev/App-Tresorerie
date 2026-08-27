import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/theme/useAppColors';

export default function AccountsLayout() {
  const COLORS = useAppColors();
  return (
    // animation 'fade' : aligné sur la pile racine (pas de glissement latéral).
    <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ title: 'Compte' }} />
      <Stack.Screen name="add" options={{ title: 'Nouveau compte' }} />
      {/* Le virement n'a plus d'écran ici : toute saisie passe par app/(tabs)/transactions/add. */}
      <Stack.Screen name="solde" options={{ title: 'Mettre à jour mon solde' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier le compte' }} />
    </Stack>
  );
}
