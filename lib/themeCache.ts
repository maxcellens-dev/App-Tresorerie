/**
 * Cache persistant du theme_mode (light/dark).
 * Écrit dans AsyncStorage à chaque changement de profil → disponible dès le prochain lancement.
 * Expose aussi une valeur en mémoire pour un accès synchrone dans AppLoading.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@relyka_theme_mode';
let _cached: string | null = null;

/** Valeur en mémoire — null avant le premier chargement (même session). */
export function getCachedThemeMode(): string | null {
  return _cached;
}

/** Lit depuis AsyncStorage et met à jour le cache mémoire. */
export async function loadThemeMode(): Promise<string | null> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY);
    if (val) _cached = val;
    return _cached;
  } catch {
    return _cached;
  }
}

/** Persiste le mode et met à jour le cache mémoire. */
export async function saveThemeMode(mode: string): Promise<void> {
  if (_cached === mode) return;
  _cached = mode;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  } catch {}
}
