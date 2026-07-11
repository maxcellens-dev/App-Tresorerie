/**
 * themeBoot — mémorisation locale du thème à appliquer AVANT toute réponse réseau, pour éliminer le
 * flash sombre au rechargement / à la déconnexion, et pour garder le thème de l'utilisateur MÊME
 * HORS-LIGNE (le profil ne se charge pas → on retombait sur le sombre par défaut).
 *
 * Deux plateformes :
 *  - WEB    : localStorage, lu de façon SYNCHRONE dès la 1ʳᵉ frame (le boot-loader HTML l'exploite).
 *  - NATIF  : AsyncStorage (asynchrone) → on maintient un cache EN MÉMOIRE lu de façon synchrone par
 *             useAppColors/useBrandColors. Hydraté au démarrage (hydrateThemeCache), puis chaque
 *             changement notifie les abonnés (subscribeThemeCache) → re-render immédiat.
 *
 * Deux contextes :
 *  - ADMIN  : thème global pré-connexion (vitrine, login, écran de démarrage).
 *  - USER   : thème choisi par l'utilisateur connecté (pages de l'app dans les onglets).
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ADMIN_THEME_KEY = 'relyka.admin.theme';
export const USER_THEME_KEY = 'relyka.user.theme';

export type ThemeModeStr = 'dark' | 'light';
type UserTheme = { mode: ThemeModeStr; preset: string };

const IS_WEB = Platform.OS === 'web';

// ── Cache en mémoire (natif) + notification de changement ─────
let memUser: UserTheme | null = null;
let memAdmin: ThemeModeStr | null = null;
let version = 0;
const listeners = new Set<() => void>();

function bump() { version += 1; listeners.forEach((l) => l()); }

/** S'abonner aux changements du cache de thème (hydratation, écriture). Pour useSyncExternalStore. */
export function subscribeThemeCache(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Version courante du cache (snapshot pour useSyncExternalStore). */
export function themeCacheVersion(): number { return version; }

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** À appeler UNE fois au démarrage (natif) : charge le dernier thème connu depuis AsyncStorage. */
export async function hydrateThemeCache(): Promise<void> {
  if (IS_WEB) return; // web : lecture synchrone via localStorage, rien à hydrater
  try {
    const pairs = await AsyncStorage.multiGet([USER_THEME_KEY, ADMIN_THEME_KEY]);
    const map = Object.fromEntries(pairs);
    const rawU = map[USER_THEME_KEY];
    if (rawU) {
      const o = JSON.parse(rawU);
      if (o && (o.mode === 'light' || o.mode === 'dark')) {
        memUser = { mode: o.mode, preset: typeof o.preset === 'string' ? o.preset : 'emerald' };
      }
    }
    const rawA = map[ADMIN_THEME_KEY];
    if (rawA === 'light' || rawA === 'dark') memAdmin = rawA;
  } catch { /* stockage indispo : on garde le défaut */ }
  bump();
}

// ── Thème admin (pré-connexion) ───────────────────────────────
export function getCachedAdminTheme(): ThemeModeStr | null {
  if (IS_WEB) { const v = ls()?.getItem(ADMIN_THEME_KEY); return v === 'light' || v === 'dark' ? v : null; }
  return memAdmin;
}

export function setCachedAdminTheme(mode: ThemeModeStr): void {
  if (IS_WEB) { try { ls()?.setItem(ADMIN_THEME_KEY, mode); } catch { /* quota/privé */ } return; }
  memAdmin = mode; bump();
  AsyncStorage.setItem(ADMIN_THEME_KEY, mode).catch(() => {});
}

// ── Thème utilisateur (connecté) ──────────────────────────────
export function getCachedUserTheme(): UserTheme | null {
  if (!IS_WEB) return memUser;
  const raw = ls()?.getItem(USER_THEME_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && (o.mode === 'light' || o.mode === 'dark')) {
      return { mode: o.mode, preset: typeof o.preset === 'string' ? o.preset : 'emerald' };
    }
  } catch { /* JSON corrompu : ignore */ }
  return null;
}

export function setCachedUserTheme(mode: ThemeModeStr, preset: string): void {
  if (IS_WEB) { try { ls()?.setItem(USER_THEME_KEY, JSON.stringify({ mode, preset })); } catch { /* sans gravité */ } return; }
  // Évite un bump inutile si rien ne change (appelé à chaque chargement de profil).
  if (memUser && memUser.mode === mode && memUser.preset === preset) return;
  memUser = { mode, preset }; bump();
  AsyncStorage.setItem(USER_THEME_KEY, JSON.stringify({ mode, preset })).catch(() => {});
}

export function clearCachedUserTheme(): void {
  if (IS_WEB) { try { ls()?.removeItem(USER_THEME_KEY); } catch { /* sans gravité */ } return; }
  memUser = null; bump();
  AsyncStorage.removeItem(USER_THEME_KEY).catch(() => {});
}
