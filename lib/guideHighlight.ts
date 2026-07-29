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

/**
 * Chaque valeur NOMME un élément réel de l'interface. Il n'existe AUCUN ciblage par coordonnées :
 * c'est l'élément lui-même qui trace sa bordure, dans sa propre boîte de layout — donc parfaitement
 * aligné sur n'importe quel écran, quelle que soit la densité, l'encoche ou la barre système.
 */
export type GuideHighlightKey =
  /* Éléments partagés (barre du bas, en-tête, saisie rapide). */
  | 'tabbar' | 'headerProfile' | 'quickAdd'
  /* Onglets de la barre du bas, individuellement. */
  | 'tab:comptes' | 'tab:transactions' | 'tab:pilotage' | 'tab:projection' | 'tab:projects'
  /* Comptes */
  | 'accountActions' | 'accountsOverview' | 'accountsTabs'
  /* Transactions */
  | 'recurringToggle' | 'recurringList' | 'recurringSheet' | 'txFilter' | 'txActions'
  /* Tableau de bord */
  | 'relykaHero' | 'recoCard' | 'monthCard' | 'variableLine' | 'marginLine'
  /* Projection */
  | 'projectionTabs' | 'projectionHypo'
  /* Projets */
  | 'projectAdd'
  /* Plan de trésorerie */
  | 'tresoTable'
  /* Paramètres & profil */
  | 'settingsCategories' | 'settingsMargin'
  | 'profileAvatar' | 'profileInfo' | 'profilePassword';

/* PLUSIEURS cibles à la fois : une étape peut désigner un bouton ET ce qu'il ouvre (le bouton
   « récurrences » et la feuille qui remonte du bas). Une clé unique obligeait à découper ça en deux
   étapes, dont une qui ne faisait que commenter un panneau déjà affiché. */
let active: readonly GuideHighlightKey[] = [];
const listeners = new Set<() => void>();

export function setGuideHighlight(key: GuideHighlightKey | GuideHighlightKey[] | null): void {
  const next = key == null ? [] : Array.isArray(key) ? key : [key];
  if (next.length === active.length && next.every((k, i) => active[i] === k)) return;
  active = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** true si `key` fait partie des éléments mis en avant par le guide en ce moment. */
export function useGuideHighlight(key: GuideHighlightKey): boolean {
  return useSyncExternalStore(subscribe, () => active.includes(key), () => false);
}

/* ── Ouverture pilotée du bouton « + » ─────────────────────────────────────────────────────────
   Présenter le bouton « + » fermé ne montre rien : ce sont les QUATRE saisies qu'il déploie qui
   comptent. Le guide demande donc son ouverture, et le bouton (composant partagé, monté dans le
   layout des onglets) obéit — sans que le guide ait à connaître son état interne. */

let quickAddOpen = false;
const qaListeners = new Set<() => void>();

export function setGuideQuickAddOpen(open: boolean): void {
  if (quickAddOpen === open) return;
  quickAddOpen = open;
  qaListeners.forEach((l) => l());
}

function subscribeQuickAdd(l: () => void): () => void {
  qaListeners.add(l);
  return () => qaListeners.delete(l);
}

/** true quand le guide demande au bouton « + » de rester déployé. */
export function useGuideQuickAddOpen(): boolean {
  return useSyncExternalStore(subscribeQuickAdd, () => quickAddOpen, () => false);
}
