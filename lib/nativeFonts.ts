/**
 * Chargement des polices IMPORTÉES sur NATIF (expo-font, depuis leur URL Supabase) + notification des
 * consommateurs. Problème résolu : `fontFamily` sur un <Text> ne s'applique QUE si la police est déjà
 * chargée AU MOMENT du rendu. On charge donc les polices tôt, puis on FORCE un re-render des composants
 * qui affichent le nom de l'app / le texte, via un compteur de version abonné.
 */
import { useEffect, useReducer } from 'react';
import { Platform } from 'react-native';
import * as Font from 'expo-font';

export interface CustomFontLike { family: string; url: string }

const loaded = new Set<string>();
let version = 0;
const subs = new Set<() => void>();

/** Vrai si la famille est disponible (chargée par nous OU déjà connue d'expo-font). */
export function isNativeFontReady(family: string | undefined): boolean {
  if (!family || Platform.OS === 'web') return true;
  return loaded.has(family) || Font.isLoaded(family);
}

/** Charge (idempotent) les polices importées manquantes puis notifie les abonnés. */
export async function ensureNativeFonts(customFonts: CustomFontLike[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const toLoad = customFonts.filter((f) => f?.family && f?.url && !loaded.has(f.family) && !Font.isLoaded(f.family));
  if (toLoad.length === 0) return;
  const map: Record<string, any> = {};
  toLoad.forEach((f) => { map[f.family] = { uri: f.url }; });
  try {
    await Font.loadAsync(map);
    toLoad.forEach((f) => loaded.add(f.family));
    version += 1;
    subs.forEach((cb) => cb());
  } catch (e) {
    console.warn('[nativeFonts] chargement échoué:', e);
  }
}

/** S'abonne aux changements → provoque un re-render du composant quand une police finit de charger. */
export function useNativeFontsVersion(): number {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subs.add(force);
    return () => { subs.delete(force); };
  }, []);
  return version;
}
