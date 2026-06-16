/**
 * Préférences d'affichage locales (par appareil), partagées et réactives via useSyncExternalStore.
 * Persistées dans AsyncStorage. Aujourd'hui : affichage des conseils en haut du Pilotage.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_TIPS = 'pilotage_tips_enabled';

let tipsEnabled = true;
let loaded = false;
const listeners = new Set<() => void>();

// Chargement initial (asynchrone) — notifie les abonnés quand prêt.
AsyncStorage.getItem(KEY_TIPS)
  .then((v) => { if (v === '0') tipsEnabled = false; loaded = true; listeners.forEach((l) => l()); })
  .catch(() => { loaded = true; });

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPilotageTipsEnabled(): boolean { return tipsEnabled; }

export function setPilotageTipsEnabled(v: boolean): void {
  tipsEnabled = v;
  AsyncStorage.setItem(KEY_TIPS, v ? '1' : '0').catch(() => {});
  listeners.forEach((l) => l());
}

/** Hook réactif : true tant que la pref n'est pas chargée (défaut activé). */
export function usePilotageTipsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => tipsEnabled, () => true);
}
