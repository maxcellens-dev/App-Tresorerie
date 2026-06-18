/**
 * usePublicColors — couleurs des pages accessibles AUSSI hors connexion (page d'accueil,
 * Confidentialité, Mentions légales).
 *  • Visiteur CONNECTÉ → sa préférence de thème (useAppColors).
 *  • Visiteur PUBLIC   → thème de la vitrine (useBrandColors / app_config.landing.theme).
 *
 * À utiliser pour TOUT l'habillage ET le contenu de ces pages, afin que chrome et texte
 * soient toujours dans le même mode (évite le texte clair illisible sur fond clair).
 */
import { useAuth } from '../contexts/AuthContext';
import { useAppColors } from './useAppColors';
import { useBrandColors } from './useBrandColors';
import type { AppColors } from '../theme/palette';

export function usePublicColors(): AppColors {
  const { user } = useAuth();
  const appColors = useAppColors();
  const brandColors = useBrandColors();
  return user ? appColors : brandColors;
}
