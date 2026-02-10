import { Stack } from 'expo-router';

export default function AccountsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" options={{ title: 'Compte' }} />
      <Stack.Screen name="add" options={{ title: 'Nouveau compte' }} />
      <Stack.Screen name="transfer" options={{ title: 'Virement' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier le compte' }} />
    </Stack>
  );
}
