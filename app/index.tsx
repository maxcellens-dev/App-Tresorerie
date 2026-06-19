import { Redirect } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useFinancialProfile } from '../hooks/useFinancialProfile';
import WelcomeScreen from './welcome';
import AppLoading from '../components/AppLoading';

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
    return <AppLoading />;
  }

  if (user) {
    const profile = profileQuery.data;
    // Le profil financier (user_financial_profile) est la source de vérité :
    // s'il existe, le questionnaire ET l'onboarding sont considérés terminés,
    // même si les flags dans `profiles` n'ont pas pu être écrits.
    const hasFinancialProfile = !!fpQuery.data;

    // Garde-fou : si la requête « profil financier » a échoué (réseau), on NE renvoie PAS un
    // utilisateur existant vers le questionnaire (faux positif). On le considère comme fait.
    const fpUncertain = fpQuery.isError;
    const onboardingDone =
      hasFinancialProfile || fpUncertain || Boolean(profile?.initial_onboarding_completed);
    const questionnaireDone =
      hasFinancialProfile || fpUncertain || Boolean(profile?.financial_profile_questionnaire_completed);

    if (!profile) {
      // Échec transitoire de lecture du profil (token pas encore propagé après reconnexion) :
      // surtout NE PAS réinitialiser l'onboarding. On envoie sur l'accueil ; le profil se
      // rechargera. Seul un vrai « profil absent » (data null, sans erreur) mène au questionnaire.
      if (profileQuery.isError) return <Redirect href="/(tabs)/home" />;
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
