import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import WelcomeScreen from './welcome';
import AppLoading from '../components/AppLoading';

/**
 * Porte d'entrée de l'app.
 *
 * PLUS AUCUN QUESTIONNAIRE À L'ARRIVÉE : un compte neuf entre DIRECTEMENT dans l'app, sur le
 * Pilotage. C'est le guide utilisateur (contexts/GuideContext) qui l'emmène ensuite créer ses
 * comptes puis ses récurrences — dans l'app réelle, avec ses vrais gestes. Poser neuf questions
 * avant d'avoir montré quoi que ce soit produisait un profil déclaratif et zéro donnée, donc un
 * Relyka vide et des recommandations creuses.
 *
 * Le questionnaire d'accueil et le socle en 5 écrans ont été SUPPRIMÉS : ils recréaient un compte
 * courant et une récurrente, et le profil financier n'a plus besoin de réponses déclarées — il se
 * déduit des seules données réelles (cf. lib/financialProfileEngine.computeProfileFromData).
 */
export default function Index() {
  const { user, loading } = useAuth();
  // PERF (démarrage) : on MONTE la lecture du profil pour chauffer son cache (le Pilotage et
  // l'en-tête le liront sans nouvel aller-retour), mais on n'ATTEND PLUS son résultat pour
  // rediriger. Cette porte ne tranche plus qu'entre « connecté » et « pas connecté » : depuis la
  // suppression du questionnaire d'accueil, aucune donnée du profil n'entre dans la décision. On
  // attendait donc un aller-retour réseau complet, écran de chargement à l'appui, pour rien —
  // exactement sur le chemin critique de l'ouverture, avant même que le Pilotage ne soit monté.
  useProfile(user?.id);

  // FILET GLOBAL : quoi qu'il arrive (hors-ligne, lenteur), on OUVRE l'app au bout de 5 s max au
  // lieu de rester bloqué sur le logo, même si la session initiale ne se résout jamais.
  const [forceOpen, setForceOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceOpen(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Seule attente légitime : la session locale (lecture de stockage, pas de réseau).
  if (loading && !forceOpen) {
    return <AppLoading />;
  }

  if (user) return <Redirect href="/(tabs)/pilotage" />;

  return <WelcomeScreen />;
}
