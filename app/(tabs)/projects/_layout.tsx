import { Stack } from 'expo-router';

export default function ProjectsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="add" options={{ title: 'Projet' }} />
    </Stack>
  );
}
