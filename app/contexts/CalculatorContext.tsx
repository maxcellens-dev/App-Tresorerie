/**
 * CalculatorContext — pilote l'affichage de la calculatrice flottante globale.
 * Un seul overlay <Calculator /> est monté à la racine ; n'importe quel écran peut
 * l'ouvrir/fermer via le hook useCalculator() (cf. <CalculatorButton />).
 *
 * `enabled` : préférence utilisateur (Paramètres) pour afficher ou non l'icône d'accès.
 * Persistée CÔTÉ COMPTE (profiles.ui_prefs). Activée par défaut.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useCalculatorEnabledPref } from '../hooks/useUiPrefs';

interface CalculatorContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** L'utilisateur a-t-il activé l'accès rapide à la calculatrice ? */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

const CalculatorContext = createContext<CalculatorContextValue | undefined>(undefined);

export function CalculatorProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { enabled, setEnabled: setEnabledPref } = useCalculatorEnabledPref(user?.id);
  const [isOpen, setIsOpen] = useState(false);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledPref(v);
    if (!v) setIsOpen(false); // désactivée → on referme aussi la fenêtre
  }, [setEnabledPref]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo(
    () => ({ isOpen, open, close, toggle, enabled, setEnabled }),
    [isOpen, open, close, toggle, enabled, setEnabled],
  );
  return <CalculatorContext.Provider value={value}>{children}</CalculatorContext.Provider>;
}

export function useCalculator(): CalculatorContextValue {
  const ctx = useContext(CalculatorContext);
  if (!ctx) throw new Error('useCalculator doit être utilisé dans un CalculatorProvider');
  return ctx;
}
