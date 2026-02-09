import { Stack } from 'expo-router';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // Parent (tabs) layout handles headers
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Panneau Admin' }} />
      <Stack.Screen name="style-editor" options={{ title: 'Style Editor' }} />
      <Stack.Screen name="seo-center" options={{ title: 'SEO Center' }} />
      <Stack.Screen name="stats-hub" options={{ title: 'Stats Hub' }} />
    </Stack>
  );
}
