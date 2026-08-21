import Constants from 'expo-constants';

/**
 * Version de l'application, lue dynamiquement depuis app.json (champ `expo.version`) via
 * expo-constants. Source UNIQUE pour tous les écrans qui affichent « Version X.Y.Z ».
 *
 * Il suffit donc de mettre à jour `version` dans app.json : plus aucune valeur à modifier
 * en dur dans le code. (Le fallback ne sert que si expoConfig est indisponible, ex. tests.)
 */
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.1';

/**
 * Mention de copyright — l'année vient de l'HORLOGE, jamais d'une constante.
 *
 * Elle était écrite en dur (« © 2026 ») dans la page « À propos » et le menu profil : chaque
 * 1ᵉʳ janvier, l'app affichait une année périmée jusqu'à ce que quelqu'un pense à la corriger.
 */
export function copyrightNotice(suffix = ''): string {
  return `© ${new Date().getFullYear()} Relyka${suffix}`;
}
