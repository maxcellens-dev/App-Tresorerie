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

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
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
