import { Redirect } from 'expo-router';
import { useAuth } from './contexts/AuthContext';
import { useProfile } from './hooks/useProfile';
import { useFinancialProfile } from './hooks/useFinancialProfile';
import WelcomeScreen from './welcome';

export default function Index() {
  const { user, loading } = useAuth();
  const profileQuery = useProfile(user?.id);
  const fpQuery = useFinancialProfile(user?.id);

  if (loading || (user && (profileQuery.isLoading || fpQuery.isLoading))) return null;

  if (user) {
    const profile = profileQuery.data;
    if (!profile || !profile.initial_onboarding_completed) {
      return <Redirect href="/setup" />;
    }
    // Questionnaire fait si : flag en base OU une ligne user_financial_profile existe
    const questionnaireDone =
      profile.financial_profile_questionnaire_completed || !!fpQuery.data;
    if (!questionnaireDone) {
      return <Redirect href="/questionnaire" />;
    }
    return <Redirect href="/(tabs)/home" />;
  }

  return <WelcomeScreen />;
}
