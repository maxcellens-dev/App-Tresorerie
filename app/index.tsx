import { Redirect } from 'expo-router';
import { useAuth } from './contexts/AuthContext';
import { useProfile } from './hooks/useProfile';
import WelcomeScreen from './welcome';

export default function Index() {
  const { user, loading } = useAuth();
  const profileQuery = useProfile(user?.id);

  if (loading || (user && profileQuery.isLoading)) return null;

  if (user) {
    const profile = profileQuery.data;
    if (!profile || !profile.initial_onboarding_completed) {
      return <Redirect href="/setup" />;
    }
    if (!profile.financial_profile_questionnaire_completed) {
      return <Redirect href="/questionnaire" />;
    }
    return <Redirect href="/(tabs)/home" />;
  }

  return <WelcomeScreen />;
}
