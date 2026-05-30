import { Redirect } from 'expo-router';

// Le setup redirige directement vers le questionnaire d'onboarding.
// Le questionnaire gère à la fois les nouveaux utilisateurs et les existants sans profil.
export default function SetupScreen() {
  return <Redirect href="/questionnaire" />;
}
