/**
 * useCurrency — devise d'affichage de l'utilisateur.
 * Lit currency_code du profil, maintient le symbole global à jour (pour les
 * fonctions de formatage hors composant) et renvoie le symbole réactif.
 */
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { CURRENCY_SYMBOL, currencySymbolFor, setCurrencySymbol, DEFAULT_CURRENCY } from '../lib/currency';

export function useCurrency() {
  const { user } = useAuth();
  // `user` = utilisateur EFFECTIF → en mode admin (visite de profil), c'est le profil VISITÉ.
  const { data: profile } = useProfile(user?.id);
  const code = profile?.currency_code ?? DEFAULT_CURRENCY;
  const symbol = currencySymbolFor(code);

  // Mise à jour SYNCHRONE (pendant le rendu) du symbole global, et non en useEffect : `useCurrency`
  // vit dans AppChrome, ANCÊTRE des écrans. La variable est donc à jour AVANT que les écrans
  // descendants ne se (re)rendent dans la même passe (ils se re-rendent via useProfile/useAppColors
  // quand le profil visité se charge) → les montants prennent bien la devise de l'utilisateur visité,
  // sans frame en retard sur l'ancienne devise (celle de l'admin).
  if (CURRENCY_SYMBOL !== symbol) setCurrencySymbol(code);

  return { code, symbol };
}

/** Raccourci : juste le symbole. */
export function useCurrencySymbol(): string {
  return useCurrency().symbol;
}
