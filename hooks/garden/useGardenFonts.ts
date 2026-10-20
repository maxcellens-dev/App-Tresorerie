/**
 * Charge les polices du Jardin (idempotent) et dit si elles sont prêtes.
 *
 * Un écran du Jardin attend `true` avant de peindre son texte : sur natif, un `fontFamily` encore
 * inconnu au moment du rendu ne s'applique pas, et le texte « sauterait » de la police système à
 * Fredoka sous les yeux (même règle que la police du nom de l'app). En cas d'échec de chargement,
 * on rend quand même la main (`true`) : la police système vaut mieux qu'un écran bloqué.
 */
import { useFonts } from 'expo-font';
import { GARDEN_FONT_ASSETS } from '../../lib/garden/fonts';

export function useGardenFonts(): boolean {
  const [loaded, error] = useFonts(GARDEN_FONT_ASSETS);
  return loaded || !!error;
}
