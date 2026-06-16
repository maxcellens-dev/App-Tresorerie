/**
 * Préférences d'affichage locales (par appareil), partagées et réactives via useSyncExternalStore.
 * Persistées dans AsyncStorage. Aujourd'hui : affichage des conseils en haut du Pilotage.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_TIPS = 'pilotage_tips_enabled';

// Par défaut ACTIVÉ. Passe à false uniquement si l'utilisateur l'a explicitement désactivé.
let tipsEnabled = true;
const listeners = new Set<(v: boolean) => void>();

// Chargement initial (asynchrone) — notifie les abonnés quand prêt.
AsyncStorage.getItem(KEY_TIPS)
  .then((v) => { tipsEnabled = v !== '0'; listeners.forEach((l) => l(tipsEnabled)); })
  .catch(() => {});

function subscribe(cb: (v: boolean) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getPilotageTipsEnabled(): boolean { return tipsEnabled; }

export function setPilotageTipsEnabled(v: boolean): void {
  tipsEnabled = v;
  AsyncStorage.setItem(KEY_TIPS, v ? '1' : '0').catch(() => {});
  listeners.forEach((l) => l(v));
}

/**
 * Hook réactif. Défaut : activé. Resynchronise la valeur au montage (au cas où le
 * chargement AsyncStorage a déjà eu lieu avant le montage du composant) → l'interrupteur
 * (Paramètres) et l'affichage (Pilotage) restent TOUJOURS cohérents.
 */
export function usePilotageTipsEnabled(): boolean {
  const [v, setV] = useState(tipsEnabled);
  useEffect(() => {
    setV(tipsEnabled);
    return subscribe(setV);
  }, []);
  return v;
}
