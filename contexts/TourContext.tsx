/**
 * TourContext — guide de présentation SIMPLIFIÉ.
 * À la 1ʳᵉ arrivée (ou relance depuis le support), on va sur Comptes et on encadre 3 zones
 * (création compte+virement, menu du bas, cercle profil). Il n'y a PLUS d'enchaînement
 * automatique entre les pages : la présentation des autres pages se fait via PageIntroModal
 * (modal centré à la 1ʳᵉ visite de chaque page). Terminer le guide Comptes → app_tour_done = true.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthContext';
import { useUpdateOnboarding, ALL_PAGE_INTRO_KEYS } from '../hooks/useOnboarding';

// Seul « comptes » porte encore des bulles ancrées. Les autres clés restent acceptées
// par useScreenGuide (dormantes) pour ne pas casser les écrans qui l'appellent.
export type TourKey = 'comptes' | 'transactions' | 'pilotage' | 'projection' | 'projets' | 'parametres';

interface TourCtx {
  active: boolean;
  finished: boolean;
  currentKey: TourKey | null;
  start: () => void;
  completeScreen: (key: TourKey) => void;
}

const Ctx = createContext<TourCtx>({ active: false, finished: false, currentKey: null, start: () => {}, completeScreen: () => {} });

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const [active, setActive] = useState(false);
  const navTimer = useRef<any>(null);

  const goTo = (route: string) => {
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => router.navigate(route as any), 80);
  };

  const start = useCallback(() => {
    // Relance : on remet à zéro les présentations de page (elles réapparaîtront à la 1ʳᵉ visite).
    const resetFlags = Object.fromEntries(ALL_PAGE_INTRO_KEYS.map((k) => ['intro_seen_' + k, false]));
    updateOnboarding.mutate({ flags: resetFlags as any });
    setActive(true);
    goTo('/(tabs)/comptes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateOnboarding]);

  const completeScreen = useCallback((key: TourKey) => {
    // Seul le guide Comptes clôt la présentation obligatoire.
    if (key !== 'comptes') return;
    setActive(false);
    updateOnboarding.mutate({ app_tour_done: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateOnboarding]);

  const currentKey = active ? 'comptes' : null;

  return (
    <Ctx.Provider value={{ active, finished: false, currentKey, start, completeScreen }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTour = () => useContext(Ctx);
