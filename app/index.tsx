import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useFinancialProfile, useQuestionnaireAnswers } from '../hooks/useFinancialProfile';
import WelcomeScreen from './welcome';
import AppLoading from '../components/AppLoading';

export default function Index() {
  const { user, loading } = useAuth();
  const profileQuery = useProfile(user?.id);
  const fpQuery = useFinancialProfile(user?.id);
  // Réponses au questionnaire : signal DÉTERMINISTE pour rattraper les comptes qui l'ont sauté
  // (un ancien démarrage lent/hors-ligne pouvait passer outre — cf. `fpUncertain` ci-dessous).
  const qaQuery = useQuestionnaireAnswers(user?.id);

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
  const paused = profileQuery.fetchStatus === 'paused' || fpQuery.fetchStatus === 'paused';
  const dataPending = !!user && (profileQuery.isPending || fpQuery.isPending || profileQuery.isFetching || fpQuery.isFetching);

  // On n'attend (écran de chargement) que si l'auth ou les données sont réellement EN COURS — pas si
  // elles sont en pause (hors-ligne) et pas au-delà du filet de 5 s.
  if ((loading || dataPending) && !paused && !forceOpen) {
    return <AppLoading />;
  }

  if (user) {
    const profile = profileQuery.data;
    // Réseau indisponible (pause), forçage 5 s, ou lecture en erreur : on NE bloque pas et on NE
    // renvoie JAMAIS un utilisateur existant vers le questionnaire faute de profil chargé.
    const noNetwork = paused || forceOpen || profileQuery.isError;

    // Le profil financier (user_financial_profile) est la source de vérité :
    // s'il existe, le questionnaire ET l'onboarding sont considérés terminés,
    // même si les flags dans `profiles` n'ont pas pu être écrits.
    const hasFinancialProfile = !!fpQuery.data;

    // Garde-fou : si la requête « profil financier » a échoué / est indisponible, on NE renvoie PAS
    // un utilisateur existant vers le questionnaire (faux positif). On le considère comme fait.
    const fpUncertain = fpQuery.isError || noNetwork;

    // Les 3 PREMIÈRES réponses sont-elles présentes ? Signal fiable pour distinguer un compte neuf
    // (questionnaire jamais commencé) d'un compte existant dont la lecture a juste échoué.
    // `qaReadable` = la lecture a abouti (data éventuellement null) → verdict fiable.
    const qa = qaQuery.data;
    const first3Filled = !!(qa && qa.q1 && qa.q2 && qa.q3);
    const qaReadable = qaQuery.isSuccess;

    // RATTRAPAGE (prioritaire, override le flag legacy) : réponses LISIBLES, 3 premières vides et
    // aucun profil financier → le questionnaire a été sauté (démarrage lent/hors-ligne d'une
    // ancienne version) → on le rouvre au début. On attend que la lecture ait abouti (qaReadable)
    // pour ne jamais renvoyer un compte existant par erreur.
    if (qaReadable && !first3Filled && !hasFinancialProfile && profile) {
      return <Redirect href="/questionnaire" />;
    }

    const onboardingDone =
      hasFinancialProfile || fpUncertain || Boolean(profile?.initial_onboarding_completed);
    const questionnaireDone =
      hasFinancialProfile
      || first3Filled
      || Boolean(profile?.financial_profile_questionnaire_completed)
      || fpUncertain;

    if (!profile) {
      // Pas de profil chargé : si le réseau est indisponible / on force l'ouverture, on va sur
      // l'accueil (qui gère l'affichage hors-ligne) — JAMAIS le questionnaire (qui renverrait un
      // utilisateur existant vers l'onboarding). Seul un vrai « profil absent » (en ligne, data null,
      // sans erreur) mène au questionnaire.
      if (noNetwork || profileQuery.isError) return <Redirect href="/(tabs)/pilotage" />;
      return <Redirect href="/setup" />;
    }
    if (!questionnaireDone) {
      return <Redirect href="/questionnaire" />;
    }
    if (!onboardingDone) {
      return <Redirect href="/setup" />;
    }
    return <Redirect href="/(tabs)/pilotage" />;
  }

  return <WelcomeScreen />;
}
