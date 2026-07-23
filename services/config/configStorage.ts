/**
 * Stockage local d'app_config (offline-first) — AsyncStorage + cache MÉMOIRE lu de façon SYNCHRONE.
 *
 * Pourquoi ce montage : `ConfigService.hydrate()` est appelé depuis un initialiseur `useState`
 * (donc PENDANT le rendu) et doit rester synchrone. AsyncStorage ne l'est pas → on garde un cache
 * en mémoire, rempli une seule fois au démarrage par `hydrateConfigCache()`, puis lu instantanément.
 * C'est exactement le motif déjà en place dans lib/themeBoot pour le thème.
 *
 * ⚠️ POURQUOI PLUS DE MMKV : `react-native-mmkv` v2 était le stockage synchrone d'origine, mais sa
 * bibliothèque native `libreactnativemmkv.so` est alignée sur des pages de 4 Ko. Google Play REFUSE
 * l'App Bundle depuis le 01/11/2025 (exigence des tailles de page de 16 Ko) — c'était la SEULE lib
 * non conforme de l'app (vérifié sur l'AAB via scripts/check-16kb.js). Sa v3+ corrige l'alignement
 * mais impose la New Architecture (donc Reanimated v4). AsyncStorage est du Java pur : aucune
 * bibliothèque native, donc aucun problème d'alignement, ni maintenant ni plus tard.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppConfigPayload } from '../../theme/defaultTheme';

const CONFIG_KEY = 'app_config';
const CONFIG_UPDATED_AT_KEY = 'app_config_updated_at';

// Cache mémoire : source de vérité pour les lectures synchrones.
let memConfig: AppConfigPayload | null = null;
let memUpdatedAt: number | null = null;

/**
 * Charge le cache disque en mémoire. À appeler UNE fois au démarrage.
 * Ne rejette jamais : un cache illisible doit dégrader vers les valeurs par défaut, pas planter.
 */
export async function hydrateConfigCache(): Promise<void> {
  try {
    const [raw, rawAt] = await Promise.all([
      AsyncStorage.getItem(CONFIG_KEY),
      AsyncStorage.getItem(CONFIG_UPDATED_AT_KEY),
    ]);
    if (raw) memConfig = JSON.parse(raw) as AppConfigPayload;
    memUpdatedAt = rawAt ? parseInt(rawAt, 10) : null;
  } catch {
    // Cache absent/corrompu → on reste sur les défauts (comportement identique à un MMKV vide).
  }
}

export function getStoredConfig(): AppConfigPayload | null {
  return memConfig;
}

export function setStoredConfig(config: AppConfigPayload): void {
  // Le cache mémoire est mis à jour TOUT DE SUITE (les lectures synchrones restent correctes dès
  // cet instant) ; l'écriture disque part en arrière-plan et ne doit jamais bloquer le rendu.
  memConfig = config;
  memUpdatedAt = Date.now();
  AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(config)).catch(() => {});
  AsyncStorage.setItem(CONFIG_UPDATED_AT_KEY, String(memUpdatedAt)).catch(() => {});
}

export function getStoredConfigUpdatedAt(): number | null {
  return memUpdatedAt;
}

export function clearStoredConfig(): void {
  memConfig = null;
  memUpdatedAt = null;
  AsyncStorage.removeItem(CONFIG_KEY).catch(() => {});
  AsyncStorage.removeItem(CONFIG_UPDATED_AT_KEY).catch(() => {});
}
