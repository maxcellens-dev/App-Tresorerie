/**
 * Verrouillage de l'app (biométrie / code de l'appareil) — OPTIONNEL, activé par l'utilisateur.
 *
 * Quand c'est activé ET que l'utilisateur est DÉJÀ connecté, l'app demande à déverrouiller (Face ID /
 * Touch ID / empreinte selon le téléphone, repli sur le code de l'appareil) au LANCEMENT de l'app
 * (démarrage à froid) — pas au simple retour en avant-plan : rester en arrière-plan ne redemande rien.
 * Aucun mot de passe propre à Relyka : on s'appuie sur la sécurité de l'OS. Réglage LOCAL à
 * l'appareil (AsyncStorage).
 *
 * ⚠️ OTA vers d'anciennes builds : `expo-local-authentication` est chargé en REQUIRE PARESSEUX protégé.
 * Sur une build sans le module natif, l'import direct crasherait l'app ; ici on retombe simplement sur
 * « indisponible » (l'option n'apparaît pas / ne s'active pas), sans jamais planter.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let LocalAuthentication: any = null;
try { LocalAuthentication = require('expo-local-authentication'); } catch { LocalAuthentication = null; }

const KEY = 'relyka.appLock.enabled';
/** Proposition d'activation (bandeau Pilotage) déjà faite sur CET appareil → ne plus la reproposer. */
const PROMPT_KEY = 'relyka.appLock.promptDone';
export const APP_LOCK_SUPPORTED = (Platform.OS === 'ios' || Platform.OS === 'android') && !!LocalAuthentication;

/** L'appareil a-t-il une biométrie OU un code configuré et utilisable ? */
export async function isDeviceAuthAvailable(): Promise<boolean> {
  if (!APP_LOCK_SUPPORTED) return false;
  try {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHw && enrolled;
  } catch {
    return false;
  }
}

/** Lance l'invite de déverrouillage. `true` si l'utilisateur s'est authentifié. */
export async function runDeviceAuth(reason = 'Déverrouille Relyka'): Promise<boolean> {
  if (!APP_LOCK_SUPPORTED) return true;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Annuler',
      disableDeviceFallback: false,
    });
    return !!res?.success;
  } catch {
    return false;
  }
}

export async function getAppLockEnabled(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === '1'; } catch { return false; }
}

export async function setAppLockEnabled(on: boolean): Promise<void> {
  try { await AsyncStorage.setItem(KEY, on ? '1' : '0'); } catch { /* noop */ }
}

/**
 * Proposition d'activation : le bandeau du Pilotage n'est montré QU'UNE FOIS par appareil. Le drapeau
 * est LOCAL (comme le réglage lui-même) : sur un nouveau téléphone, la proposition revient — c'est
 * voulu, le verrouillage protège l'appareil, pas le compte.
 */
export async function getAppLockPromptDone(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PROMPT_KEY)) === '1'; } catch { return true; }
}

export async function setAppLockPromptDone(): Promise<void> {
  try { await AsyncStorage.setItem(PROMPT_KEY, '1'); } catch { /* noop */ }
}
