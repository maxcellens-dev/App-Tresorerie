/**
 * useAppLockPrompt — proposition UNIQUE d'activer le verrouillage biométrique (bandeau du Pilotage).
 *
 * Le verrouillage existe dans les Paramètres, mais personne ne le découvre en fouillant : on le
 * propose donc une fois, juste après la présentation du Pilotage, via le bandeau « prochain geste ».
 *
 * L'état vit dans react-query (et non dans un useState local) pour être PARTAGÉ entre le hook qui
 * décide de l'action (useAppState) et le composant qui la rend (NextActionBanner) : accepter ou
 * fermer le bandeau le fait disparaître immédiatement des deux côtés.
 *
 * Conditions pour proposer : plateforme compatible + biométrie/code réellement configuré sur
 * l'appareil + verrouillage pas déjà actif + proposition jamais faite sur cet appareil.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APP_LOCK_SUPPORTED, isDeviceAuthAvailable, getAppLockEnabled, setAppLockEnabled,
  getAppLockPromptDone, setAppLockPromptDone, runDeviceAuth,
} from '../lib/appLock';

const KEY = ['app_lock_prompt'];

export function useAppLockPrompt() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<{ offer: boolean }> => {
      if (!APP_LOCK_SUPPORTED) return { offer: false };
      const [available, enabled, promptDone] = await Promise.all([
        isDeviceAuthAvailable(), getAppLockEnabled(), getAppLockPromptDone(),
      ]);
      return { offer: available && !enabled && !promptDone };
    },
    // Lecture locale (AsyncStorage), jamais périmée : les changements passent par les callbacks
    // ci-dessous qui réécrivent le cache directement.
    staleTime: Infinity,
  });

  const close = useCallback(() => { qc.setQueryData(KEY, { offer: false }); }, [qc]);

  /** Fermeture manuelle du bandeau → ne plus jamais reproposer sur cet appareil. */
  const dismiss = useCallback(async () => {
    close();
    await setAppLockPromptDone();
  }, [close]);

  /**
   * Activation depuis le bandeau : invite OS de confirmation, puis activation.
   * Si l'utilisateur annule l'invite, on ne marque RIEN → le bandeau reste (il pourra le fermer).
   */
  const activate = useCallback(async (): Promise<boolean> => {
    const ok = await runDeviceAuth('Confirme pour activer le verrouillage');
    if (!ok) return false;
    await setAppLockEnabled(true);
    await setAppLockPromptDone();
    close();
    return true;
  }, [close]);

  return { offer: !!data?.offer, dismiss, activate };
}
