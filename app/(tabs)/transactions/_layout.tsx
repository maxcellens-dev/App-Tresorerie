import { Stack } from 'expo-router';

export default function TransactionsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ title: 'Nouvelle transaction' }} />
      <Stack.Screen name="edit/[id]" options={{ title: 'Modifier la transaction' }} />
    </Stack>
  );
}
