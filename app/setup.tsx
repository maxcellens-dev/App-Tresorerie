import { Redirect } from 'expo-router';

// Ancienne étape « setup » : elle renvoyait vers le questionnaire de démarrage. Le parcours d'accueil
// se fait désormais DANS l'app (Pilotage → guide utilisateur, cf. contexts/GuideContext), donc cette
// route ne fait plus qu'ouvrir l'app. Conservée : d'anciens liens et redirections pointent dessus.
export default function SetupScreen() {
  return <Redirect href="/(tabs)/pilotage" />;
}
