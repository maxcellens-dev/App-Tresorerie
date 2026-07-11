/**
 * guideHighlight — quel élément le guide met en avant, en ce moment.
 *
 * Méthode voulue : ce ne sont PAS des cadres dessinés par-dessus à une position mesurée (toujours
 * fragile selon l'appareil), mais chaque bouton concerné qui trace SA PROPRE bordure quand il est
 * ciblé. Le composant lit ici s'il est la cible active (`useGuideHighlight`), et rend un
 * `<GuideRing>` enfant : même boîte de layout que le bouton → alignement parfait, sans mesure.
 *
 * GuideOverlay écrit la clé active (`setGuideHighlight`) au fil des étapes.
 */
import { useSyncExternalStore } from 'react';

export type GuideHighlightKey = 'accountActions' | 'tabbar' | 'headerProfile';

let active: GuideHighlightKey | null = null;
const listeners = new Set<() => void>();

export function setGuideHighlight(key: GuideHighlightKey | null): void {
  if (active === key) return;
  active = key;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** true si `key` est l'élément mis en avant par le guide en ce moment. */
export function useGuideHighlight(key: GuideHighlightKey): boolean {
  return useSyncExternalStore(subscribe, () => active === key, () => false);
}
