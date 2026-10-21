/**
 * « Essayer avant d'acheter » : ce que la scène du Jardin montre quand on touche un article de la
 * boutique — ce qui est déjà équipé, PLUS l'article essayé (un décor de plus, un vêtement de Pépin
 * à la place du sien, une autre saison). Fonction PURE.
 *
 * Les articles du Jardin (décor, garde-robe, saison) changent la scène ; un cadre d'avatar s'essaie
 * aussi (`'frame'`), mais sur ton avatar posé devant la scène, pas sur l'arbre. Couleurs et packs
 * n'ont rien à montrer → `null`.
 */
import { COSMETIC_DEFS } from './gamification';
import type { SceneExtras } from '../garden/sceneCinematic';
import type { Season } from '../garden/season';

export type GardenLook = SceneExtras & { season?: Season };

const OUTFIT_SLOT: Record<string, keyof NonNullable<SceneExtras['outfit']>> = {
  pico_neck: 'neck', pico_head: 'head', pico_eyes: 'eyes', pico_feet: 'feet',
};

/** Ce que l'article change dans le Jardin, ou `null` s'il ne s'y voit pas. */
export function previewKind(key: string): 'decor' | 'outfit' | 'season' | 'frame' | null {
  const d = COSMETIC_DEFS[key];
  if (!d) return null;
  if (d.slot === 'avatar_frame') return 'frame';
  if (String(d.slot).startsWith('decor_')) return 'decor';
  if (OUTFIT_SLOT[d.slot]) return 'outfit';
  if (d.slot === 'garden_season') return 'season';
  return null;
}

export function applyTry(look: GardenLook, key: string | null): GardenLook {
  if (!key) return look;
  const d = COSMETIC_DEFS[key], kind = previewKind(key);
  if (!d || !kind || kind === 'frame') return look;
  if (kind === 'decor') return { ...look, decor: Array.from(new Set([...(look.decor ?? []), d.value])) };
  if (kind === 'outfit') return { ...look, outfit: { ...(look.outfit ?? {}), [OUTFIT_SLOT[d.slot]]: d.value } };
  return { ...look, season: d.value as Season };
}
