/**
 * Rectangles cibles (calculés) pour le tour de présentation, afin de mettre en avant
 * le bouton de navigation utilisé pour atteindre chaque page (barre d'onglets en bas,
 * ou bouton profil en haut à droite pour les écrans secondaires).
 */
import { Dimensions } from 'react-native';

export type GuideRect = { x: number; y: number; w: number; h: number };

/** Rectangle d'un onglet de la barre du bas (5 onglets : comptes=0, transactions=1, pilotage=2, projection=3, projets=4). */
export function tabRect(index: number, count = 5): GuideRect {
  const { width, height } = Dimensions.get('window');
  const tabW = width / count;
  return { x: index * tabW + 8, y: height - 76, w: tabW - 16, h: 66 };
}

/** Rectangle approximatif du bouton profil (avatar) en haut à droite du header. */
export function headerProfileRect(): GuideRect {
  const { width } = Dimensions.get('window');
  return { x: width - 66, y: 12, w: 50, h: 48 };
}
