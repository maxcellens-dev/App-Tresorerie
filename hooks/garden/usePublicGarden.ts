/**
 * Couleurs des écrans publics (connexion, inscription, mot de passe oublié) : la palette du Jardin,
 * en mode clair et accent par défaut (l'utilisateur n'est pas encore connu).
 */
import { gardenAppColors } from '../../lib/garden/gardenPalette';
import { useGardenFonts } from './useGardenFonts';

export function usePublicColors(): { colors: any; garden: boolean } {
  useGardenFonts(); // polices du Jardin chargées dès l'écran de connexion
  return { colors: gardenAppColors(null, 'light'), garden: true };
}
