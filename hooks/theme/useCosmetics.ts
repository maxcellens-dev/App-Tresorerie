/**
 * useCosmetics — cosmétiques débloqués (inventaire) et équipés (profiles.equipped_cosmetics).
 *
 * Un cosmétique acheté en boutique atterrit dans l'inventaire ; il faut ensuite l'« équiper »
 * dans Apparence pour qu'il s'affiche (cadre d'avatar, titre de profil, flamme de série).
 * Un seul cosmétique par emplacement peut être équipé à la fois.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile, useUpdateProfile } from '../data/useProfile';
import { useGamification } from '../engagement/useGamification';
import { COSMETIC_DEFS, keepOwnedCosmetics, type CosmeticSlot, type EquippedCosmetics } from '../../lib/engagement/gamification';

/** Référence stable pour « aucun cosmétique équipé » (cf. equippedRaw). */
const EMPTY: EquippedCosmetics = {};

export function useCosmetics(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: profile } = useProfile(userId);
  const updateProfile = useUpdateProfile(userId);
  const { inventory, inventoryReady, inventoryError } = useGamification(userId);

  // `EMPTY` plutôt qu'un `{}` littéral : celui-ci serait un objet NEUF à chaque rendu, ce qui
  // invaliderait les mémos ci-dessous en permanence pour tout compte sans cosmétique équipé.
  const equippedRaw = ((profile as any)?.equipped_cosmetics ?? EMPTY) as EquippedCosmetics;

  /** Applique immédiatement la nouvelle config au cache profil (effet visuel temps réel),
   *  puis persiste en base. Le cache écrasé évite tout délai réseau à l'affichage. */
  const applyEquipped = (next: EquippedCosmetics) => {
    qc.setQueryData(['profile', userId], (prev: any) => (prev ? { ...prev, equipped_cosmetics: next } : prev));
    updateProfile.mutate({ equipped_cosmetics: next });
  };

  /* Mémoïsés, et pas par confort : ce hook est appelé par l'entête, le menu de profil, la puce de
     série et la page Apparence. Une liste (ou un objet) reconstruit à chaque rendu casse tous les
     `useMemo` qui en dépendent en aval — la page Apparence recalculait sa grille de cosmétiques à
     chaque frappe dans le champ de couleur. */
  // Cosmétiques réellement possédés (inventaire qty > 0 ET reconnus comme cosmétiques).
  const ownedKeys = useMemo(
    () => inventory.filter((i) => i.qty > 0 && COSMETIC_DEFS[i.item_key]).map((i) => i.item_key),
    [inventory],
  );

  // Un cosmétique équipé mais plus possédé ne doit plus s'afficher (cf. keepOwnedCosmetics).
  const equipped: EquippedCosmetics = useMemo(
    () => keepOwnedCosmetics(equippedRaw, ownedKeys, inventoryReady),
    [equippedRaw, ownedKeys, inventoryReady],
  );

  const isEquipped = (itemKey: string) => {
    const def = COSMETIC_DEFS[itemKey];
    return !!def && equipped[def.slot] === itemKey;
  };

  const equip = (itemKey: string) => {
    const def = COSMETIC_DEFS[itemKey];
    if (!def) return;
    applyEquipped({ ...equipped, [def.slot]: itemKey });
  };

  const unequipSlot = (slot: CosmeticSlot) => {
    const next = { ...equipped };
    delete next[slot];
    applyEquipped(next);
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
    /** L'inventaire est-il réellement lu ? `ownedKeys` vide ne veut rien dire tant que c'est faux. */
    inventoryReady,
    /** La lecture de l'inventaire a échoué : ne pas annoncer « aucun article ». */
    inventoryError,
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
