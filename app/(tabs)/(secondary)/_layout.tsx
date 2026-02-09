import { Stack } from 'expo-router';

export default function SecondaryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="profile" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="categories" />
      <Stack.Screen name="theme" />
      <Stack.Screen name="about" />
      <Stack.Screen name="admin" />
    </Stack>
  );
}
