/**
 * Ce que la boutique ajoute au dessin du jardin, d'après les cosmétiques ÉQUIPÉS (useCosmetics) :
 * le décor posé autour de l'arbre, la garde-robe de Pépin et la saison choisie (sinon la vraie).
 */
import { useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useCosmetics } from '../theme/useCosmetics';
import { COSMETIC_DEFS } from '../../lib/engagement/gamification';
import type { Season } from '../../lib/garden/season';
import type { SceneExtras } from '../../lib/garden/sceneCinematic';

export function useGardenCosmetics(): SceneExtras & { season?: Season } {
  const { user } = useAuth();
  const { equipped } = useCosmetics(user?.id);
  return useMemo(() => {
    const val = (slot: string) => { const k = (equipped as any)[slot]; return k ? COSMETIC_DEFS[k]?.value : undefined; };
    const decor = ['decor_lantern', 'decor_birdhouse', 'decor_bench', 'decor_mushrooms', 'decor_fence', 'decor_pond'].map(val).filter(Boolean) as string[];
    const season = val('garden_season') as Season | undefined;
    return { decor, outfit: { neck: val('pico_neck'), head: val('pico_head'), eyes: val('pico_eyes'), feet: val('pico_feet') }, season };
  }, [equipped]);
}
