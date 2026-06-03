/**
 * OnboardingGate — déclenche le tour de présentation OBLIGATOIRE après le questionnaire.
 * Monté une fois dans le layout des onglets. Démarre le tour ancré (page par page)
 * tant que `app_tour_done` est faux. Le tour lui-même est géré par TourContext + les
 * GuideOverlay de chaque écran.
 */
import React, { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import { useTour } from '../contexts/TourContext';

export default function OnboardingGate() {
  const { user } = useAuth();
  const ob = useOnboarding(user?.id);
  const tour = useTour();
  const started = useRef(false);

  useEffect(() => {
    if (!started.current && user && ob.profile && !ob.appTourDone && !tour.active) {
      started.current = true;
      tour.start();
    }
  }, [user, ob.profile, ob.appTourDone, tour.active, tour]);

  return null;
}
