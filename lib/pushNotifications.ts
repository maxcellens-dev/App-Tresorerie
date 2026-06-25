/**
 * Notifications push — version WEB / fallback.
 *
 * Metro charge automatiquement `pushNotifications.native.ts` sur iOS/Android
 * (expo-notifications), et CE fichier sur le web (pas de push web pour l'instant).
 * Le badge in-app (réponses assistance, idées) fonctionne sur toutes les plateformes ;
 * seule la notification système est réservée au natif.
 */

export const PUSH_SUPPORTED = false;

export interface DevicePushToken {
  token: string;
  platform: string;
}

/** Demande la permission et renvoie le jeton Expo de l'appareil. No-op sur web. */
export async function getDevicePushTokenAsync(): Promise<DevicePushToken | null> {
  return null;
}

/** Diagnostic (web) — pas de push web. */
export async function diagnosePushRegistration(): Promise<string> {
  return 'Web : notifications push non supportées (uniquement sur l\'app mobile).';
}
