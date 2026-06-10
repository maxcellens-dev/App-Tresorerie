import { Stack } from 'expo-router';

export default function SecondaryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
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
      <Stack.Screen name="admin" />
    </Stack>
  );
}
