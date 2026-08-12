/**
 * Stockage de la session Supabase sur natif.
 *  • Build RÉCENTE (module natif expo-secure-store présent) → session CHIFFRÉE (Keychain/Keystore),
 *    découpée en morceaux (<2048 o) pour dépasser la limite de taille.
 *  • Build ANCIENNE reçue par OTA (module natif ABSENT) → REPLI sur AsyncStorage (comme avant),
 *    pour NE PAS déconnecter l'utilisateur ni crasher l'app.
 *
 * ⚠️ IMPORTANT (OTA vers d'anciennes builds) : on charge `expo-secure-store` en REQUIRE PARESSEUX
 * protégé par try/catch. Un import direct en tête de fichier LÈVE « Cannot find native module » sur
 * une build qui n'a pas le module natif → l'app ne démarrerait pas. Ici, si le module manque, on
 * bascule silencieusement sur AsyncStorage. Un même bundle JS marche donc sur TOUTES les builds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// Chargement paresseux + protégé : `null` si le module natif n'est pas dans la build.
let SecureStore: any = null;
try { SecureStore = require('expo-secure-store'); } catch { SecureStore = null; }

const CHUNK = 1800; // marge sous la limite ~2048
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

// Disponibilité RÉELLE du module natif, résolue une seule fois.
let securePromise: Promise<boolean> | null = null;
function secureAvailable(): Promise<boolean> {
  if (!securePromise) {
    securePromise = (async () => {
      if (!SecureStore || typeof SecureStore.setItemAsync !== 'function') return false;
      try {
        if (typeof SecureStore.isAvailableAsync === 'function') return await SecureStore.isAvailableAsync();
        // Sonde : une écriture/lecture témoin. Si le natif manque, ça lève → indisponible.
        await SecureStore.setItemAsync('relyka.__probe', '1');
        await SecureStore.deleteItemAsync('relyka.__probe');
        return true;
      } catch {
        return false;
      }
    })();
  }
  return securePromise;
}

async function readChunked(key: string): Promise<string | null> {
  const nRaw = await SecureStore.getItemAsync(`${safe(key)}.__n`);
  if (nRaw == null) return SecureStore.getItemAsync(safe(key));
  const n = parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(`${safe(key)}.${i}`);
    if (part == null) return null;
    out += part;
  }
  return out;
}

async function clearChunked(key: string): Promise<void> {
  const nRaw = await SecureStore.getItemAsync(`${safe(key)}.__n`).catch(() => null);
  await SecureStore.deleteItemAsync(safe(key)).catch(() => {});
  if (nRaw != null) {
    const n = parseInt(nRaw, 10) || 0;
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${safe(key)}.${i}`).catch(() => {});
    await SecureStore.deleteItemAsync(`${safe(key)}.__n`).catch(() => {});
  }
}

export const SecureSessionStore = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (!(await secureAvailable())) return AsyncStorage.getItem(key); // ancienne build → AsyncStorage
      const v = await readChunked(key);
      if (v != null) return v;
      // Migration depuis l'ancien AsyncStorage en clair (une seule fois).
      const legacy = await AsyncStorage.getItem(key);
      if (legacy != null) {
        await this.setItem(key, legacy);
        await AsyncStorage.removeItem(key).catch(() => {});
        return legacy;
      }
      return null;
    } catch {
      return AsyncStorage.getItem(key).catch(() => null);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (!(await secureAvailable())) { await AsyncStorage.setItem(key, value); return; }
      await clearChunked(key);
      if (value.length <= CHUNK) { await SecureStore.setItemAsync(safe(key), value); return; }
      const n = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < n; i++) await SecureStore.setItemAsync(`${safe(key)}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      await SecureStore.setItemAsync(`${safe(key)}.__n`, String(n));
    } catch {
      await AsyncStorage.setItem(key, value).catch(() => {});
    }
  },

  async removeItem(key: string): Promise<void> {
    try { if (await secureAvailable()) await clearChunked(key); } catch { /* noop */ }
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
