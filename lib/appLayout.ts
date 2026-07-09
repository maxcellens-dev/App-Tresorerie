// Contraintes de largeur partagées pour l'app.
// Sur web/desktop, le contenu principal est limité à une colonne « mobile » centrée (app/_layout).
// Les Modaux React Native s'affichent, eux, dans un portail plein écran → sans contrainte, une
// feuille (bottom sheet) prend toute la largeur du navigateur. `sheetWidth` la recentre et la
// plafonne à la largeur de l'app (sur mobile, l'écran < APP_MAX_WIDTH → pleine largeur, inchangé).
import type { ViewStyle } from 'react-native';

/** Largeur maximale de la colonne d'app (doit rester alignée sur webColumn dans app/_layout.tsx). */
export const APP_MAX_WIDTH = 840;

/**
 * À étaler dans le style de la FEUILLE d'un bottom sheet (le conteneur enfant de l'overlay
 * plein écran). `alignSelf: 'center'` la recentre malgré l'overlay `alignItems: stretch` par défaut.
 */
export const sheetWidth: ViewStyle = { width: '100%', maxWidth: APP_MAX_WIDTH, alignSelf: 'center' };
