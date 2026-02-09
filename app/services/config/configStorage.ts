/**
 * MMKV storage for app_config (Offline-First)
 * Key: app_config
 */

import { MMKV } from 'react-native-mmkv';
import type { AppConfigPayload } from '../../theme/defaultTheme';

const CONFIG_KEY = 'app_config';
const CONFIG_UPDATED_AT_KEY = 'app_config_updated_at';

export const configStorage = new MMKV({ id: 'mytreasury-config' });

export function getStoredConfig(): AppConfigPayload | null {
  try {
    const raw = configStorage.getString(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppConfigPayload;
  } catch {
    return null;
  }
}

export function setStoredConfig(config: AppConfigPayload): void {
  configStorage.set(CONFIG_KEY, JSON.stringify(config));
  configStorage.set(CONFIG_UPDATED_AT_KEY, Date.now().toString());
}

export function getStoredConfigUpdatedAt(): number | null {
  const raw = configStorage.getString(CONFIG_UPDATED_AT_KEY);
  return raw ? parseInt(raw, 10) : null;
}

export function clearStoredConfig(): void {
  configStorage.delete(CONFIG_KEY);
  configStorage.delete(CONFIG_UPDATED_AT_KEY);
}
