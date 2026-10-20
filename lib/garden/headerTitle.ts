/**
 * Titre de la barre du haut du Jardin, fourni par la page affichée.
 *
 * Dans le Jardin, le nom de la page vit dans la barre du haut (comme l'entête de l'app actuelle),
 * plus en grand titre sous elle : ça fait gagner de la place. Les pages déclarent leur titre via
 * ScreenHeader ; la barre le lit. Le titre est rangé PAR CHEMIN : une page qui n'en déclare pas ne
 * peut pas hériter du titre de la précédente.
 */
import { useSyncExternalStore } from 'react';

const titles = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

export function setHeaderTitle(path: string, title: string) {
  if (titles.get(path) === title) return;
  titles.set(path, title);
  version++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Titre déclaré par la page du chemin donné (ou undefined). */
export function useHeaderTitle(path: string): string | undefined {
  useSyncExternalStore(subscribe, () => version, () => version);
  return titles.get(path);
}
