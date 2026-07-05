/**
 * Registre d'ancres pour le guide de présentation (GuideOverlay).
 *
 * Certaines cibles du guide (avatar du header, barre d'onglets) vivent dans des composants
 * partagés, pas dans l'écran qui lance le guide. Plutôt que des rectangles calculés « en dur »
 * (fragiles selon l'appareil, l'encoche, la safe-area → bulles mal positionnées), ces composants
 * ENREGISTRENT ici la ref de leur View réelle. Le guide la MESURE (measureInWindow) → position exacte.
 */
import React from 'react';

export type GuideAnchorName = 'headerProfile' | 'tabbar';

const anchors: Partial<Record<GuideAnchorName, React.RefObject<any>>> = {};

/** Un composant partagé enregistre la ref de sa View cible (à monter/démonter). */
export function registerGuideAnchor(name: GuideAnchorName, ref: React.RefObject<any>): void {
  anchors[name] = ref;
}

export function unregisterGuideAnchor(name: GuideAnchorName): void {
  delete anchors[name];
}

/** Récupère la ref enregistrée (ou une ref vide → le guide retombera sur une bulle centrée). */
export function getGuideAnchor(name: GuideAnchorName): React.RefObject<any> {
  return anchors[name] ?? { current: null };
}
