import { Stack } from 'expo-router';

export default function ObjectivesLayout() {
  return (
    <Stack screenOptions={{ headerShown: true }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
