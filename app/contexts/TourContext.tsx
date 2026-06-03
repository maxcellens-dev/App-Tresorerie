/**
 * TourContext — orchestre le tour de présentation OBLIGATOIRE page par page.
 * Chaque écran participant affiche son GuideOverlay (bulles ancrées sur les zones)
 * quand `currentKey` correspond. À la fin des bulles d'un écran, on passe au suivant
 * (navigation automatique). Au terme du dernier écran → app_tour_done = true.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from './AuthContext';
import { useUpdateOnboarding } from '../hooks/useOnboarding';

export type TourKey = 'comptes' | 'transactions' | 'pilotage' | 'tresorerie' | 'projection' | 'profile' | 'parametres';

const ORDER: { key: TourKey; route: string }[] = [
  { key: 'comptes',      route: '/(tabs)/comptes' },
  { key: 'transactions', route: '/(tabs)/transactions' },
  { key: 'pilotage',     route: '/(tabs)/pilotage' },
  { key: 'tresorerie',   route: '/(tabs)/tresorerie' },
  { key: 'projection',   route: '/(tabs)/projection' },
  { key: 'profile',      route: '/(tabs)/(secondary)/profile' },
  { key: 'parametres',   route: '/(tabs)/(secondary)/parametres' },
];

interface TourCtx {
  active: boolean;
  currentKey: TourKey | null;
  start: () => void;
  completeScreen: (key: TourKey) => void;
}

const Ctx = createContext<TourCtx>({ active: false, currentKey: null, start: () => {}, completeScreen: () => {} });

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const updateOnboarding = useUpdateOnboarding(user?.id);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const navTimer = useRef<any>(null);

  const goTo = (route: string) => {
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => router.push(route as any), 60);
  };

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
    goTo(ORDER[0].route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeScreen = useCallback((key: TourKey) => {
    setIndex((i) => {
      if (ORDER[i]?.key !== key) return i;
      const next = i + 1;
      if (next >= ORDER.length) {
        setActive(false);
        updateOnboarding.mutate({ app_tour_done: true });
        return i;
      }
      goTo(ORDER[next].route);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateOnboarding]);

  const currentKey = active ? (ORDER[index]?.key ?? null) : null;

  return <Ctx.Provider value={{ active, currentKey, start, completeScreen }}>{children}</Ctx.Provider>;
}

export const useTour = () => useContext(Ctx);
