/**
 * L'APP EST-ELLE VERROUILLÉE ? — état global, hors React.
 *
 * `AppLockGate` peint un voile plein écran par-dessus l'app quand le verrouillage (biométrie / code
 * appareil) est actif. Mais un voile n'empêche pas ce qui se passe DERRIÈRE : les sollicitations
 * montées à la racine (clôture, état des lieux mensuel, changement de profil, succès) continuaient
 * de s'ouvrir, et pire, de se CONSOMMER — l'état des lieux se marque « vu » et archive son bilan à
 * la fermeture. On pouvait donc voir apparaître, ou perdre, le bilan du mois sans avoir déverrouillé
 * l'app.
 *
 * Deux subtilités qui expliquent pourquoi ce n'était pas visible à la lecture du code :
 *  • le réglage est lu de façon ASYNCHRONE (AsyncStorage). Entre le montage et sa réponse, le voile
 *    n'existe pas encore : on est verrouillé sans le savoir. On démarre donc à `true` sur les
 *    plateformes concernées, et on ne relâche qu'une fois la réponse connue ;
 *  • le voile vit dans la même fenêtre que le reste ; ce qui s'affiche dans un `Modal` (fenêtre
 *    séparée, empilée par le système) passe donc AU-DESSUS de lui.
 *
 * Volontairement hors React, comme lib/interruptQueue : ces composants sont montés à la racine, sans
 * parent commun où poser un état partagé.
 */
import { useSyncExternalStore } from 'react';

let locked = false;
const listeners = new Set<() => void>();

/** Position du verrou. `true` = rien ne doit s'ouvrir par-dessus. */
export function isAppLocked(): boolean {
  return locked;
}

export function setAppLocked(next: boolean): void {
  if (locked === next) return;
  locked = next;
  listeners.forEach((l) => l());
}

export function subscribeAppLock(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Version React : re-rend le composant quand le verrou bouge. */
export function useAppLocked(): boolean {
  return useSyncExternalStore(subscribeAppLock, isAppLocked, () => false);
}
