/**
 * Image 3D d'un succès, dans l'ambiance du Jardin : UNE image par famille (catégorie) de succès —
 * tous les paliers d'une famille partagent la même, les succès verrouillés sont grisés par l'écran.
 *
 *   Fidélité → souche et ses anneaux · Assiduité → flamme · Régularité → arrosoir rempli
 *   Économie → pot et sa pousse · Rigueur → cadran solaire · Action → pomme
 *   Collection → tas de noisettes · Profil, Bienvenue → Pépin · Découverte → panneau indicateur
 *
 * Un succès créé en admin dans une autre famille retombe sur le trophée. Une image téléversée en
 * admin reste prioritaire (gérée par l'écran, avant cet appel).
 */
import type { ImageSourcePropType } from 'react-native';
import { SCENE3D_IMG } from '../garden/scene3dAssets';
import { WELCOME_BADGE_KEY } from './gamification';

const BY_CATEGORY: Record<string, keyof typeof SCENE3D_IMG> = {
  'Fidélité': 'succ_rings',
  'Assiduité': 'shop_flame_orange',
  'Régularité': 'succ_can',
  'Économie': 'succ_pot',
  'Rigueur': 'succ_sundial',
  'Action': 'apple_ripe',
  'Collection': 'iap_nuts_500',
  'Profil': 'pepin_happy',
  'Découverte': 'succ_sign',
};

export function successArt(def: { key?: string; category?: string }): ImageSourcePropType {
  if (def.key === WELCOME_BADGE_KEY) return SCENE3D_IMG.pepin_joy;
  const k = def.category ? BY_CATEGORY[def.category] : undefined;
  return SCENE3D_IMG[k ?? 'shop_trophy'];
}
