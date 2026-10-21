/**
 * useBrandColors — couleurs des écrans d'avant connexion (vitrine, connexion, inscription, mot de
 * passe oublié, pages légales, splash) : la palette du JARDIN, accent par défaut, indépendante des
 * préférences de l'utilisateur (qui n'est pas encore connu).
 * Le MODE clair/sombre suit le réglage de la vitrine (app_config.landing.theme), piloté en admin →
 * tout le site bascule ensemble.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { useLandingConfig } from '../config/useLandingConfig';
import { getCachedAdminTheme, subscribeThemeCache, themeCacheVersion } from '../../lib/platform/themeBoot';
import { gardenAppColors } from '../../lib/garden/gardenPalette';
import type { AppColors, ThemeMode } from '../../theme/palette';

export function useBrandColors(previewMode?: ThemeMode): AppColors {
  const { data: landing } = useLandingConfig();
  // Avant la réponse réseau : dernier thème admin connu (localStorage web / AsyncStorage natif après
  // hydratation). L'abonnement re-rend à l'hydratation du cache natif.
  useSyncExternalStore(subscribeThemeCache, themeCacheVersion, themeCacheVersion);
  // Repli CLAIR (le Jardin, le splash crème et la vitrine le sont) tant que la config n'a pas répondu.
  const mode = (previewMode ?? landing?.theme ?? getCachedAdminTheme() ?? 'light') as ThemeMode;
  return useMemo(() => gardenAppColors(null, mode === 'dark' ? 'dark' : 'light'), [mode]);
}
