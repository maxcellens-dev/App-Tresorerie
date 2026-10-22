/**
 * useAppColors — couleurs de l'app selon les préférences utilisateur + config de style globale.
 * - theme_mode + theme_preset : par utilisateur (profil)
 * - card_alpha, custom_accents, extra_presets : globaux (app_config via useStyleConfig)
 * Fallback : sombre / émeraude.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useProfile } from '../data/useProfile';
import { useStyleConfig } from './useStyleConfig';
import { gardenAppColors } from '../../lib/garden/gardenPalette';
import { getCachedUserTheme, getCachedAdminTheme, setCachedUserTheme, subscribeThemeCache, themeCacheVersion } from '../../lib/platform/themeBoot';
import {
  buildColors, DEFAULT_MODE, DEFAULT_PRESET,
  type AppColors, type ThemeMode,
} from '../../theme/palette';


const accentCache = new Map<string, string>();
/** Couleur d'accent (mode clair) d'un preset — ou le preset lui-même s'il est déjà une couleur. */
function accentFor(preset: string, styleConfig: any): string {
  if (/^#[0-9a-fA-F]{6}$/.test(preset)) return preset;
  const hit = accentCache.get(preset);
  if (hit) return hit;
  const c = buildColors('light', preset, { customAccents: styleConfig?.custom_accents, extraPresets: styleConfig?.extra_presets } as any).primary;
  accentCache.set(preset, c);
  return c;
}

export function useAppColors(): AppColors {
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: styleConfig } = useStyleConfig();

  // Tant que le profil n'est pas chargé (rechargement, ou HORS-LIGNE où il ne se chargera pas) :
  // on repart du dernier thème utilisateur mémorisé (localStorage web / AsyncStorage natif) au lieu
  // du défaut sombre. L'abonnement re-render quand le cache natif finit de s'hydrater au démarrage.
  useSyncExternalStore(subscribeThemeCache, themeCacheVersion, themeCacheVersion);
  const cachedUser = getCachedUserTheme();
  /* PREMIÈRE connexion sur un appareil : aucun thème utilisateur mémorisé et le profil n'est pas
     encore revenu → on tombait sur le sombre en dur, alors que l'écran de connexion qu'on vient de
     quitter affichait le thème de la VITRINE. D'où l'éclair sombre entre « Se connecter » et l'app.
     On enchaîne donc sur ce même thème admin : la bascule ne se voit plus, et dès que le profil
     arrive il est mémorisé (effet ci-dessous) pour toutes les ouvertures suivantes. */
  /* VISITEUR (pas connecté) : le thème de la VITRINE, jamais celui du dernier utilisateur de
     l'appareil — ce sont les couleurs actives que lisent la vitrine et les pages publiques. */
  /* VISITEUR (déconnecté, connexion restaurée) : le thème de la VITRINE, jamais celui du dernier
     utilisateur de l'appareil. PENDANT la restauration de session (`loading`), on garde le thème
     mémorisé : sinon les premiers rendus partaient en clair et une partie de l'écran ne se
     repeignait pas en sombre ensuite. */
  const visitor = !user && !authLoading;
  const mode = (visitor
    ? (getCachedAdminTheme() ?? DEFAULT_MODE)
    : (profile?.theme_mode ?? cachedUser?.mode ?? getCachedAdminTheme() ?? DEFAULT_MODE)) as ThemeMode;
  const preset = (visitor ? DEFAULT_PRESET : (profile?.theme_preset ?? cachedUser?.preset ?? DEFAULT_PRESET)) as string;

  // Mémorise le thème dès qu'il est réellement connu (profil chargé) pour le prochain démarrage.
  useEffect(() => {
    if (profile?.theme_mode) setCachedUserTheme(profile.theme_mode, profile.theme_preset ?? DEFAULT_PRESET);
  }, [profile?.theme_mode, profile?.theme_preset]);


  /* La palette de l'app est celle du Jardin, déclinée selon le MODE (clair/sombre) et la COULEUR
     D'ACCENT choisis dans Apparence. L'émeraude par défaut garde le vert du Jardin ; toute autre
     couleur prend la teinte de l'accent (calculée en mode clair). */
  const m = mode === 'dark' ? 'dark' : 'light';
  return gardenAppColors(preset === DEFAULT_PRESET ? null : accentFor(preset, styleConfig), m, styleConfig?.garden?.[m], styleConfig?.garden_glow?.[m]);
}
