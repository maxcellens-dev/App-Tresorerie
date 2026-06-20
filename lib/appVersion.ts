import Constants from 'expo-constants';

/**
 * Version de l'application, lue dynamiquement depuis app.json (champ `expo.version`) via
 * expo-constants. Source UNIQUE pour tous les écrans qui affichent « Version X.Y.Z ».
 *
 * Il suffit donc de mettre à jour `version` dans app.json : plus aucune valeur à modifier
 * en dur dans le code. (Le fallback ne sert que si expoConfig est indisponible, ex. tests.)
 */
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.1';
