/**
 * Images 3D des articles de la boutique (même style que le Jardin), à la place des pictogrammes :
 *   - les flammes de série → la flamme en feutrine, recolorée comme l'article (argentée, bleue…) ;
 *   - les titres → le trophée.
 * Choix par CLÉ d'article (stable), avec repli sur l'icône : un article ajouté par l'administration
 * avec l'icône « flame » reçoit la flamme d'origine. `null` = pas d'image, on garde l'icône.
 */
import type { ImageSourcePropType } from 'react-native';
import { SCENE3D_IMG } from '../garden/scene3dAssets';
import { COSMETIC_DEFS } from './gamification';

const FLAME_BY_KEY: Record<string, keyof typeof SCENE3D_IMG> = {
  cosmetic_flame_silver: 'shop_flame_silver',
  cosmetic_gold_flame: 'shop_flame_gold',
  cosmetic_flame_blue: 'shop_flame_blue',
  cosmetic_flame_emerald: 'shop_flame_emerald',
  cosmetic_flame_neon: 'shop_flame_neon',
  cosmetic_flame_prestige: 'shop_flame_red', // libellé « Flamme rouge »
  cosmetic_flame_violet: 'shop_flame_violet', // libellé « Flamme prestige »
};

/** Flamme de série équipée, retrouvée par sa COULEUR (useCosmetics ne donne que la couleur) ; sinon la flamme d'origine. */
export function flameArt(color?: string | null): ImageSourcePropType {
  const key = color ? Object.keys(FLAME_BY_KEY).find((k) => COSMETIC_DEFS[k]?.value?.toLowerCase() === color.toLowerCase()) : undefined;
  return SCENE3D_IMG[key ? FLAME_BY_KEY[key] : 'shop_flame_orange'];
}

export function shopArt(key?: string | null, icon?: string | null): ImageSourcePropType | null {
  if (key && FLAME_BY_KEY[key]) return SCENE3D_IMG[FLAME_BY_KEY[key]];
  if (icon === 'flame' || icon === 'flame-outline') return SCENE3D_IMG.shop_flame_orange;
  if ((key && key.startsWith('cosmetic_title')) || icon === 'ribbon' || icon === 'ribbon-outline' || icon === 'trophy' || icon === 'trophy-outline') return SCENE3D_IMG.shop_trophy;
  return null;
}
