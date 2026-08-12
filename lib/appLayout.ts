// Contraintes de largeur partagées pour l'app.
// Sur web/desktop, le contenu principal est limité à une colonne « mobile » centrée (app/_layout).
// Les Modaux React Native s'affichent, eux, dans un portail plein écran → sans contrainte, une
// feuille (bottom sheet) prend toute la largeur du navigateur. `sheetWidth` la recentre et la
// plafonne à la largeur de l'app (sur mobile, l'écran < APP_MAX_WIDTH → pleine largeur, inchangé).
import { Platform } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Largeur maximale de la colonne d'app (doit rester alignée sur webColumn dans app/_layout.tsx). */
export const APP_MAX_WIDTH = 840;

/**
 * À étaler dans le style de la FEUILLE d'un bottom sheet (le conteneur enfant de l'overlay
 * plein écran). `alignSelf: 'center'` la recentre malgré l'overlay `alignItems: stretch` par défaut.
 *
 * WEB : plafonnée à 640 px (et non plus à la largeur de l'app). Une feuille de 840 px collée en bas
 * d'un écran d'ordinateur se lit comme un artefact mobile ; à 640 px centrée, elle se lit comme une
 * boîte de dialogue. Sur mobile, l'écran est toujours plus étroit → aucun changement visible.
 */
export const SHEET_MAX_WIDTH_WEB = 640;
export const sheetWidth: ViewStyle = {
  width: '100%',
  maxWidth: Platform.OS === 'web' ? SHEET_MAX_WIDTH_WEB : APP_MAX_WIDTH,
  alignSelf: 'center',
  /* WEB : la feuille est aussi centrée VERTICALEMENT. Le plafond de largeur ci-dessus la faisait
     déjà ressembler à une boîte de dialogue, mais elle restait collée au bas de la fenêtre — tous
     les voiles de feuille sont en `justifyContent: 'flex-end'`, ce qui a un sens sur un téléphone
     (le pouce est en bas) et aucun sur un écran d'ordinateur, où le regard est au centre.
     On centre par MARGES AUTOMATIQUES : en flexbox elles priment sur le `justifyContent` du
     parent, donc les 22 feuilles de l'app se recentrent sans toucher à leur voile.
     Les coins BAS sont arrondis ici seulement : détachée du bord, une feuille à fond plat se lit
     comme une boîte coupée. Les feuilles ne définissent que leurs coins HAUTS, ces deux règles ne
     leur sont donc jamais retirées. */
  ...(Platform.OS === 'web'
    ? { marginTop: 'auto', marginBottom: 'auto', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }
    : null),
};

/**
 * Marge basse d'une FEUILLE (bottom sheet), barre de navigation système COMPRISE.
 *
 * Une feuille collée en bas est rendue dans un `<Modal>` : ce calque couvre TOUT l'écran, y compris
 * la zone des boutons Android (retour / accueil / récents). Un `paddingBottom` figé (20-28 dp) passe
 * donc SOUS ces boutons : les actions de la feuille (« Fermer », « Modifier », « Enregistrer ») sont
 * partiellement masquées, et d'autant plus que le téléphone utilise la navigation à 3 boutons
 * (~48 dp) plutôt que le geste (~16 dp) — d'où un rendu correct sur certains appareils seulement.
 *
 * On ajoute donc l'inset système à la marge de dessin, comme le fait déjà la barre d'onglets
 * (components/CustomTabBar). Le fond de la feuille continue de descendre jusqu'au bas de l'écran ;
 * c'est le CONTENU qui remonte au-dessus des boutons.
 *
 * @param base marge basse voulue quand il n'y a aucune barre système (valeur historique de la feuille).
 */
export function useSheetBottomPadding(base = 20): number {
  return base + useSafeAreaInsets().bottom;
}
