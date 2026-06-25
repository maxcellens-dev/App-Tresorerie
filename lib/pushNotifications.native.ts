/**
 * Notifications push — version NATIVE (iOS / Android) via expo-notifications.
 * Demande la permission, récupère le jeton Expo Push de l'appareil et configure
 * l'affichage des notifications quand l'app est au premier plan.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export const PUSH_SUPPORTED = true;

export interface DevicePushToken {
  token: string;
  platform: string;
}

// Afficher la notification même si l'app est ouverte (bannière + son).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Demande la permission et renvoie le jeton Expo Push de l'appareil (null si refusé/simulateur). */
export async function getDevicePushTokenAsync(): Promise<DevicePushToken | null> {
  try {
    if (!Device.isDevice) return null; // pas de push sur simulateur

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications Relyka',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const perm = await Notifications.getPermissionsAsync();
    let status = perm.status;
    // On ne présente la permission système qu'UNE seule fois : à la première
    // installation (statut « undetermined »). Si l'utilisateur l'a déjà refusée,
    // on ne le redemande JAMAIS — il réactivera depuis les réglages de l'OS s'il
    // change d'avis. (Le toggle in-app « notifications_enabled », lui, reste
    // libre d'être recoché : l'envoi reprendra dès que la permission OS existe.)
    if (status === 'undetermined' && perm.canAskAgain) {
      const res = await Notifications.requestPermissionsAsync();
      status = res.status;
    }
    if (status !== 'granted') return null;

    // projectId requis en build EAS ; en Expo Go il est inféré.
    const projectId = (Constants?.expoConfig as any)?.extra?.eas?.projectId
      ?? (Constants as any)?.easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined as any);
    return { token: tokenRes.data, platform: Platform.OS };
  } catch (e) {
    console.warn('[pushNotifications] enregistrement échoué:', e);
    return null;
  }
}

/** Diagnostic lisible (admin) : explique étape par étape pourquoi le jeton ne se crée pas. */
export async function diagnosePushRegistration(): Promise<string> {
  const lines: string[] = [`Plateforme : ${Platform.OS}`];
  try {
    lines.push(`Appareil réel : ${Device.isDevice ? 'oui' : 'NON (simulateur → pas de push)'}`);
    if (!Device.isDevice) return lines.join('\n');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Notifications Relyka', importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const perm = await Notifications.getPermissionsAsync();
    lines.push(`Permission OS : ${perm.status} (peut redemander : ${perm.canAskAgain})`);
    let status = perm.status;
    if (status === 'undetermined' && perm.canAskAgain) {
      const res = await Notifications.requestPermissionsAsync();
      status = res.status;
      lines.push(`Après demande : ${status}`);
    }
    if (status !== 'granted') {
      lines.push('→ Permission NON accordée. Réglages → Relyka → Notifications → Autoriser.');
      return lines.join('\n');
    }

    const projectId = (Constants?.expoConfig as any)?.extra?.eas?.projectId
      ?? (Constants as any)?.easConfig?.projectId;
    lines.push(`projectId : ${projectId ?? 'MANQUANT'}`);
    try {
      const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined as any);
      lines.push(`Jeton : ${String(tokenRes.data).slice(0, 28)}…`);
      lines.push('OK — le jeton devrait s\'enregistrer au prochain lancement.');
    } catch (e: any) {
      lines.push(`getExpoPushTokenAsync a ECHOUE : ${e?.message ?? String(e)}`);
      lines.push('→ Souvent : credentials FCM (Android) / APNs (iOS) non configurés dans EAS, ou build sans push.');
    }
  } catch (e: any) {
    lines.push(`Erreur : ${e?.message ?? String(e)}`);
  }
  return lines.join('\n');
}
