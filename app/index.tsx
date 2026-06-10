import { Redirect } from 'expo-router';
import { useAuth } from './contexts/AuthContext';
import { useProfile } from './hooks/useProfile';
import { useFinancialProfile } from './hooks/useFinancialProfile';
import WelcomeScreen from './welcome';

export default function Index() {
  const { user, loading } = useAuth();
  const profileQuery = useProfile(user?.id);
  const fpQuery = useFinancialProfile(user?.id);

  // On attend que les DEUX requêtes soient réellement résolues avant de décider de la redirection.
  // `isPending` (≥ isLoading) couvre la fenêtre où une requête fraîchement activée n'a pas encore
  // renvoyé de données → évite d'envoyer vers le questionnaire alors que le profil financier existe.
  if (
    loading ||
    (user && (profileQuery.isPending || fpQuery.isPending || profileQuery.isFetching || fpQuery.isFetching))
  ) {
    return null;
  }

  if (user) {
    const profile = profileQuery.data;
    // Le profil financier (user_financial_profile) est la source de vérité :
    // s'il existe, le questionnaire ET l'onboarding sont considérés terminés,
    // même si les flags dans `profiles` n'ont pas pu être écrits.
    const hasFinancialProfile = !!fpQuery.data;

    const onboardingDone =
      hasFinancialProfile || Boolean(profile?.initial_onboarding_completed);
    const questionnaireDone =
      hasFinancialProfile || Boolean(profile?.financial_profile_questionnaire_completed);

    if (!profile) {
      return <Redirect href="/setup" />;
    }
    if (!questionnaireDone) {
      return <Redirect href="/questionnaire" />;
    }
    if (!onboardingDone) {
      return <Redirect href="/setup" />;
    }
    return <Redirect href="/(tabs)/home" />;
  }

  return <WelcomeScreen />;
}
