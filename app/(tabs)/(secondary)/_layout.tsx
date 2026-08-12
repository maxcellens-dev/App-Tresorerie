import { Stack } from 'expo-router';
import { useAppColors } from '../../../hooks/theme/useAppColors';

export default function SecondaryLayout() {
  const COLORS = useAppColors();
  return (
    // `animation: 'fade'` comme la pile RACINE (app/_layout) : sans ça, cette pile utilisait le
    // glissement latéral par défaut → effet de « swipe » vers la gauche entre deux pages secondaires
    // (Mon profil ↔ Apparence…), incohérent avec le reste de l'app. Toutes les piles sont alignées.
    <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: COLORS.bg } }}>
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
