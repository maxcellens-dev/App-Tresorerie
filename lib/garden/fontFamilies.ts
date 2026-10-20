/**
 * Noms des familles de police du Jardin, tels qu'enregistrés par expo-font (une famille par
 * graisse). Séparés de `fonts.ts` (qui référence les fichiers .ttf) pour que la charte et les
 * moteurs purs restent importables sans charger de fichier de police (tests en node).
 */
export const GARDEN_FONTS = {
  display: 'Fredoka_600SemiBold',
  body: 'Nunito_400Regular',
  bodyBold: 'Nunito_700Bold',
  bodyHeavy: 'Nunito_800ExtraBold',
} as const;
