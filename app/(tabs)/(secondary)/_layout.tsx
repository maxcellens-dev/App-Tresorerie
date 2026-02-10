import { Stack } from 'expo-router';

export default function SecondaryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="profile" />
      <Stack.Screen name="parametres" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="about" />
      <Stack.Screen name="assistance" />
      <Stack.Screen name="ideas" />
      <Stack.Screen name="confidentialite" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="admin" />
    </Stack>
  );
}
