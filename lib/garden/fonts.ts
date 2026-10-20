/**
 * Fichiers des polices du Jardin : Fredoka (titres, grands montants) et Nunito (texte).
 *
 * Elles viennent des paquets `@expo-google-fonts/*` : de simples fichiers .ttf embarqués dans le
 * bundle JS, chargés par expo-font (déjà présent). Aucun code natif nouveau → compatible OTA.
 *
 * On importe chaque graisse par son sous-chemin (`/600SemiBold`) et non depuis la racine du
 * paquet : la racine référence TOUTES les graisses, qui finiraient toutes dans le bundle.
 */
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka/600SemiBold';
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { GARDEN_FONTS } from './fontFamilies';

export { GARDEN_FONTS };

/** Table à passer à `useFonts` / `Font.loadAsync`. */
export const GARDEN_FONT_ASSETS = {
  [GARDEN_FONTS.display]: Fredoka_600SemiBold,
  [GARDEN_FONTS.body]: Nunito_400Regular,
  [GARDEN_FONTS.bodyBold]: Nunito_700Bold,
  [GARDEN_FONTS.bodyHeavy]: Nunito_800ExtraBold,
};
