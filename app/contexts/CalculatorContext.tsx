/**
 * CalculatorContext — pilote l'affichage de la calculatrice flottante globale.
 * Un seul overlay <Calculator /> est monté à la racine ; n'importe quel écran peut
 * l'ouvrir/fermer via le hook useCalculator() (cf. <CalculatorButton />).
 *
 * `enabled` : préférence utilisateur (Paramètres) pour afficher ou non l'icône d'accès.
 * Persistée localement (AsyncStorage). Activée par défaut.
 */
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'relyka.calculator_enabled';

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
  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabledState] = useState(true);

  // Charge la préférence persistée (défaut : activée).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => { if (v === '0') setEnabledState(false); })
      .catch(() => {});
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    if (!v) setIsOpen(false); // désactivée → on referme aussi la fenêtre
    AsyncStorage.setItem(STORAGE_KEY, v ? '1' : '0').catch(() => {});
  }, []);

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
