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
      <Stack.Screen name="suggestions" options={{ title: 'Suggestions' }} />
      <Stack.Screen name="conseils" options={{ title: 'Conseils' }} />
      <Stack.Screen name="gamification" options={{ title: 'Gamification' }} />
      <Stack.Screen name="ads" options={{ title: 'Publicités' }} />
      <Stack.Screen name="landing" options={{ title: "Page d'accueil" }} />
      <Stack.Screen name="users" options={{ title: 'Utilisateurs' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    </Stack>
  );
}
