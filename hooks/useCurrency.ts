/**
 * useCurrency — devise d'affichage de l'utilisateur.
 * Lit currency_code du profil, maintient le symbole global à jour (pour les
 * fonctions de formatage hors composant) et renvoie le symbole réactif.
 */
import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { currencySymbolFor, setCurrencySymbol, DEFAULT_CURRENCY } from '../lib/currency';

export function useCurrency() {
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const code = profile?.currency_code ?? DEFAULT_CURRENCY;
  const symbol = currencySymbolFor(code);

  // Tenir la variable globale à jour (utilisée par les formatteurs purs).
  useEffect(() => { setCurrencySymbol(code); }, [code]);

  return { code, symbol };
}

/** Raccourci : juste le symbole. */
export function useCurrencySymbol(): string {
  return useCurrency().symbol;
}
