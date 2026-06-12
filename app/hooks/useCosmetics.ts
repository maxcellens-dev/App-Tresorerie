/**
 * useCosmetics — cosmétiques débloqués (inventaire) et équipés (profiles.equipped_cosmetics).
 *
 * Un cosmétique acheté en boutique atterrit dans l'inventaire ; il faut ensuite l'« équiper »
 * dans Apparence pour qu'il s'affiche (cadre d'avatar, titre de profil, flamme de série).
 * Un seul cosmétique par emplacement peut être équipé à la fois.
 */
import { useProfile, useUpdateProfile } from './useProfile';
import { useGamification } from './useGamification';
import { COSMETIC_DEFS, type CosmeticSlot, type EquippedCosmetics } from '../lib/gamification';

export function useCosmetics(userId: string | undefined) {
  const { data: profile } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const { inventory } = useGamification(userId);

  const equipped = ((profile as any)?.equipped_cosmetics ?? {}) as EquippedCosmetics;

  // Cosmétiques réellement possédés (inventaire qty > 0 ET reconnus comme cosmétiques).
  const ownedKeys = inventory
    .filter((i) => i.qty > 0 && COSMETIC_DEFS[i.item_key])
    .map((i) => i.item_key);

  const isEquipped = (itemKey: string) => {
    const def = COSMETIC_DEFS[itemKey];
    return !!def && equipped[def.slot] === itemKey;
  };

  const equip = (itemKey: string) => {
    const def = COSMETIC_DEFS[itemKey];
    if (!def) return;
    updateProfile.mutate({ equipped_cosmetics: { ...equipped, [def.slot]: itemKey } });
  };

  const unequipSlot = (slot: CosmeticSlot) => {
    const next = { ...equipped };
    delete next[slot];
    updateProfile.mutate({ equipped_cosmetics: next });
  };

  /** Coche/décoche : équipe l'article, ou le retire s'il est déjà équipé. */
  const toggle = (itemKey: string) => {
    const def = COSMETIC_DEFS[itemKey];
    if (!def) return;
    if (isEquipped(itemKey)) unequipSlot(def.slot);
    else equip(itemKey);
  };

  // Effets dérivés, utilisés par les composants d'affichage.
  const valueFor = (slot: CosmeticSlot): string | null => {
    const key = equipped[slot];
    return key ? COSMETIC_DEFS[key]?.value ?? null : null;
  };

  return {
    equipped,
    ownedKeys,
    isEquipped,
    equip,
    unequipSlot,
    toggle,
    /** Couleur du cadre d'avatar (null si aucun cadre équipé). */
    avatarFrameColor: valueFor('avatar_frame'),
    /** Titre affiché sur le profil (null si aucun). */
    profileTitle: valueFor('title'),
    /** Couleur de la flamme de série (null = couleur par défaut). */
    flameColor: valueFor('streak_flame'),
  };
}
