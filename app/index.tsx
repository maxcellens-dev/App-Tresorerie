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
 * `app/onboarding.tsx` (socle en 5 écrans) et `app/questionnaire.tsx` restent dans le projet et
 * restent atteignables, mais ne sont plus la porte d'entrée de personne.
 */
export default function Index() {
  const { user, loading } = useAuth();
  const profileQuery = useProfile(user?.id);

  // FILET GLOBAL : quoi qu'il arrive (hors-ligne, requêtes en pause, lenteur), on OUVRE l'app au bout
  // de 5 s max au lieu de rester bloqué sur le logo. Indispensable : sans ça, une requête « en pause »
  // (onlineManager, hors-ligne) laisse l'app figée sur AppLoading indéfiniment.
  const [forceOpen, setForceOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setForceOpen(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // Hors-ligne, onlineManager met les requêtes EN PAUSE (`fetchStatus === 'paused'`) : elles restent
  // « pending » sans jamais aboutir. On ne doit donc PAS attendre `isPending` dans ce cas.
  const paused = profileQuery.fetchStatus === 'paused';
  const dataPending = !!user && (profileQuery.isPending || profileQuery.isFetching);

  // On n'attend (écran de chargement) que si l'auth ou les données sont réellement EN COURS — pas si
  // elles sont en pause (hors-ligne) et pas au-delà du filet de 5 s.
  if ((loading || dataPending) && !paused && !forceOpen) {
    return <AppLoading />;
  }

  if (user) return <Redirect href="/(tabs)/pilotage" />;

  return <WelcomeScreen />;
}
