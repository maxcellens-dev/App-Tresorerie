/**
 * Stockage CHIFFRÉ de la session Supabase sur natif (iOS Keychain / Android Keystore via
 * expo-secure-store), au lieu d'AsyncStorage en clair. Durcissement : sur un appareil rooté /
 * jailbreaké, la session n'est plus lisible en clair.
 *
 * SecureStore limite chaque valeur à ~2048 octets → une session Supabase (access + refresh + user)
 * peut dépasser. On DÉCOUPE donc la valeur en morceaux (`<key>.0`, `<key>.1`, …), avec un index
 * `<key>.__n` = nombre de morceaux. Chaque morceau est chiffré par le Keychain/Keystore.
 *
 * Migration douce : à la première lecture, si rien n'est dans SecureStore mais qu'une session existe
 * dans AsyncStorage (ancien stockage en clair), on la reprend et on l'y efface → AUCUNE déconnexion
 * de masse à la mise à jour.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800; // marge sous la limite ~2048
// SecureStore n'accepte que [A-Za-z0-9._-] dans les clés → on assainit (les clés Supabase ont des « - », OK).
const safe = (k: string) => k.replace(/[^A-Za-z0-9._-]/g, '_');

async function readChunked(key: string): Promise<string | null> {
  const nRaw = await SecureStore.getItemAsync(`${safe(key)}.__n`);
  if (nRaw == null) {
    // Valeur simple (non découpée) éventuelle.
    return SecureStore.getItemAsync(safe(key));
  }
  const n = parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await SecureStore.getItemAsync(`${safe(key)}.${i}`);
    if (part == null) return null; // morceau manquant → session corrompue, on repart de zéro
    out += part;
  }
  return out;
}

async function clearChunked(key: string): Promise<void> {
  const nRaw = await SecureStore.getItemAsync(`${safe(key)}.__n`);
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
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await clearChunked(key); // repart propre (évite les morceaux orphelins d'une valeur plus longue)
      if (value.length <= CHUNK) {
        await SecureStore.setItemAsync(safe(key), value);
        return;
      }
      const n = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < n; i++) {
        await SecureStore.setItemAsync(`${safe(key)}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await SecureStore.setItemAsync(`${safe(key)}.__n`, String(n));
    } catch {
      /* best-effort : ne jamais faire planter l'auth à cause du stockage */
    }
  },

  async removeItem(key: string): Promise<void> {
    try { await clearChunked(key); } catch { /* noop */ }
    await AsyncStorage.removeItem(key).catch(() => {}); // au cas où un reliquat legacy traîne
  },
};
