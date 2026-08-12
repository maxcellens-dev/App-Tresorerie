/**
 * useAppColors — couleurs de l'app selon les préférences utilisateur + config de style globale.
 * - theme_mode + theme_preset : par utilisateur (profil)
 * - card_alpha, custom_accents, extra_presets : globaux (app_config via useStyleConfig)
 * Fallback : sombre / émeraude.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useStyleConfig } from './useStyleConfig';
import { getCachedUserTheme, getCachedAdminTheme, setCachedUserTheme, subscribeThemeCache, themeCacheVersion } from '../lib/themeBoot';
import {
  buildColors, DEFAULT_MODE, DEFAULT_PRESET,
  type AppColors, type ThemeMode,
} from '../theme/palette';

/**
 * PERF — palette partagée GLOBALEMENT (mémo au niveau module, pas par composant).
 *
 * `useAppColors()` est appelé ~142 fois dans l'app : avec un simple useMemo par composant,
 * `buildColors()` (84 lignes de calcul de couleurs) s'exécutait UNE FOIS PAR INSTANCE de composant
 * → des dizaines de reconstructions de palette à CHAQUE montage d'écran (coût fixe qui frappait
 * même les écrans sans graphe ni liste : Apparence/Paramètres aussi lents que Pilotage).
 *
 * Ici : les entrées sont GLOBALES (mode, preset, config de style) → une seule palette pour toute
 * l'app, recalculée uniquement quand ces entrées changent réellement. Bonus : la référence
 * retournée devient IDENTIQUE partout, donc les `useMemo(() => makeStyles(COLORS), [COLORS])`
 * des composants ne se recalculent plus non plus.
 */
type ColorInputs = {
  mode: ThemeMode; preset: string;
  cardAlpha: unknown; bgColor: unknown; headerAlpha: unknown; inkColor: unknown; cardColor: unknown;
  customAccents: unknown; extraPresets: unknown; semanticColors: unknown; lightSemanticColors: unknown;
};
let paletteCache: { inputs: ColorInputs; value: AppColors } | null = null;

function sharedColors(i: ColorInputs): AppColors {
  const p = paletteCache;
  if (
    p && p.inputs.mode === i.mode && p.inputs.preset === i.preset
    && p.inputs.cardAlpha === i.cardAlpha && p.inputs.bgColor === i.bgColor
    && p.inputs.headerAlpha === i.headerAlpha && p.inputs.inkColor === i.inkColor && p.inputs.cardColor === i.cardColor
    // Objets issus de react-query : comparaison par RÉFÉRENCE (stables tant que la config ne change pas).
    && p.inputs.customAccents === i.customAccents && p.inputs.extraPresets === i.extraPresets
    && p.inputs.semanticColors === i.semanticColors && p.inputs.lightSemanticColors === i.lightSemanticColors
  ) return p.value;

  const value = buildColors(i.mode, i.preset, {
    cardAlpha: i.cardAlpha as any,
    bgColor: i.bgColor as any,
    headerAlpha: i.headerAlpha as any,
    inkColor: i.inkColor as any,
    cardColor: i.cardColor as any,
    customAccents: i.customAccents as any,
    extraPresets: i.extraPresets as any,
    semanticColors: i.semanticColors as any,
    lightSemanticColors: i.lightSemanticColors as any,
  });
  paletteCache = { inputs: i, value };
  return value;
}

export function useAppColors(): AppColors {
  const { user } = useAuth();
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
  const mode = (profile?.theme_mode ?? cachedUser?.mode ?? getCachedAdminTheme() ?? DEFAULT_MODE) as ThemeMode;
  const preset = (profile?.theme_preset ?? cachedUser?.preset ?? DEFAULT_PRESET) as string;

  // Mémorise le thème dès qu'il est réellement connu (profil chargé) pour le prochain démarrage.
  useEffect(() => {
    if (profile?.theme_mode) setCachedUserTheme(profile.theme_mode, profile.theme_preset ?? DEFAULT_PRESET);
  }, [profile?.theme_mode, profile?.theme_preset]);

  const cardAlpha = mode === 'light'
    ? styleConfig?.light.card_alpha
    : styleConfig?.dark.card_alpha;
  const bgColor = mode === 'light'
    ? styleConfig?.light.bg_color
    : styleConfig?.dark.bg_color;
  const headerAlpha = mode === 'light'
    ? styleConfig?.light.header_alpha
    : styleConfig?.dark.header_alpha;
  const inkColor = mode === 'light'
    ? styleConfig?.light.ink_color
    : styleConfig?.dark.ink_color;
  const cardColor = mode === 'light'
    ? styleConfig?.light.card_color
    : styleConfig?.dark.card_color;

  // Palette PARTAGÉE (cache module) : buildColors ne tourne qu'au vrai changement de thème/config,
  // et la référence est la même pour les ~142 appelants → styles des composants stables aussi.
  return sharedColors({
    mode, preset, cardAlpha, bgColor, headerAlpha, inkColor, cardColor,
    customAccents: styleConfig?.custom_accents,
    extraPresets: styleConfig?.extra_presets,
    semanticColors: styleConfig?.semantic_colors,
    lightSemanticColors: styleConfig?.light_semantic_colors,
  });
}
