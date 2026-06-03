/**
 * useScreenGuide — piloté par le tour de présentation (TourContext).
 * Un écran affiche ses bulles (GuideOverlay) quand le tour atteint sa clé.
 * À la fin des bulles de l'écran (ou « Passer »), on passe à l'écran suivant.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTour, type TourKey } from '../contexts/TourContext';

export type GuideScreen = TourKey;

export function useScreenGuide(screen: GuideScreen, _userId?: string) {
  const tour = useTour();
  const [step, setStep] = useState(0);
  const visible = tour.active && tour.currentKey === screen;

  // Recommence au début à chaque fois que le tour arrive sur cet écran.
  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  const goNext = useCallback((totalSteps: number) => {
    setStep((s) => {
      if (s < totalSteps - 1) return s + 1;
      tour.completeScreen(screen);
      return 0;
    });
  }, [tour, screen]);

  const skip = useCallback(() => {
    setStep(0);
    tour.completeScreen(screen);
  }, [tour, screen]);

  return { visible, step, goNext, skip };
}
