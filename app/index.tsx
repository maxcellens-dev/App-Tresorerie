import { Redirect } from 'expo-router';
import { useAuth } from './contexts/AuthContext';
import WelcomeScreen from './welcome';

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect href="/(tabs)/home" />;
  return <WelcomeScreen />;
}
