/**
 * Web fallback: localStorage for app_config (no MMKV on web).
 */

import type { AppConfigPayload } from '../../theme/defaultTheme';

const CONFIG_KEY = 'app_config';
const CONFIG_UPDATED_AT_KEY = 'app_config_updated_at';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredConfig(): AppConfigPayload | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppConfigPayload;
  } catch {
    return null;
  }
}

export function setStoredConfig(config: AppConfigPayload): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(CONFIG_KEY, JSON.stringify(config));
    storage.setItem(CONFIG_UPDATED_AT_KEY, Date.now().toString());
  } catch {
    // ignore
  }
}

export function getStoredConfigUpdatedAt(): number | null {
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(CONFIG_UPDATED_AT_KEY);
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

export function clearStoredConfig(): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.removeItem(CONFIG_KEY);
    storage.removeItem(CONFIG_UPDATED_AT_KEY);
  } catch {
    // ignore
  }
}
