/**
 * OnboardingGate — déclenche le tour de présentation OBLIGATOIRE après le questionnaire.
 * Monté une fois dans le layout des onglets. S'affiche tant que `app_tour_done` est faux.
 */
import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import AppTourModal from './AppTourModal';

export default function OnboardingGate() {
  const { user } = useAuth();
  const ob = useOnboarding(user?.id);
  // Le gate vit dans le layout des onglets (donc après l'onboarding) : on affiche
  // le tour de présentation tant qu'il n'a pas été terminé. On attend le profil chargé.
  const show = !!user && !!ob.profile && !ob.appTourDone;
  return <AppTourModal visible={show} onFinish={ob.markTourDone} />;
}
