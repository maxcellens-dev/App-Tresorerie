/**
 * Configuration de style globale stockée dans app_config.theme.style.
 * Gradient et transparence cartes peuvent être différents par mode.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ModeStyleConfig {
  gradient_enabled: boolean;
  /** Opacité stop 1 du gradient (0-100). Conservé pour compat / 1er palier. */
  gradient_opacity: number;
  /** Les 4 paliers d'opacité du dégradé (0-100), du haut vers le bas. */
  gradient_stops?: number[];
  /** Alpha des cartes (0-100). Ex: 8 = 8 % */
  card_alpha: number;
}

/** Retourne les 4 paliers d'opacité du dégradé (en 0-1) pour un mode. */
export function getGradientStops(cfg: ModeStyleConfig | undefined, fallbackOpacity = 30): number[] {
  if (cfg?.gradient_stops && cfg.gradient_stops.length === 4) {
    return cfg.gradient_stops.map((v) => Math.min(100, Math.max(0, v)) / 100);
  }
  const base = (cfg?.gradient_opacity ?? fallbackOpacity) / 100;
  return [base, base * 0.6, base * 0.33, base * 0.16];
}

export interface CustomPreset {
  id: string;
  label: string;
  dark: string;
  light: string;
}

export interface StyleConfig {
  dark: ModeStyleConfig;
  light: ModeStyleConfig;
  /** Famille de police (CSS font-family). Ex: 'Inter', 'Georgia' */
  font_family: string;
  /** Couleurs personnalisées par preset { emerald: '#00B67A', ocean: '#0075FF', ... } */
  custom_accents: Record<string, string>;
  /** Presets personnalisés créés dans le style editor */
  extra_presets: CustomPreset[];
  /** Identifiants des presets (natifs ou custom) masqués dans Paramètres */
  hidden_presets: string[];
  /** Surcharges des couleurs sémantiques globales { danger, blue, violet, green, orange, teal, yellow } */
  semantic_colors: Record<string, string>;
}

export const MODE_DEFAULTS: ModeStyleConfig = {
  gradient_enabled: true,
  gradient_opacity: 30,
  gradient_stops: [30, 18, 10, 5],
  card_alpha: 8,
};

export const STYLE_DEFAULTS: StyleConfig = {
  dark:  { ...MODE_DEFAULTS },
  light: { gradient_enabled: true, gradient_opacity: 20, gradient_stops: [20, 12, 7, 3], card_alpha: 4 },
  font_family: 'System',
  custom_accents: {},
  extra_presets: [],
  hidden_presets: [],
  semantic_colors: {},
};

const KEY = 'style_config';

export function useStyleConfig() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async (): Promise<StyleConfig> => {
      if (!supabase) return STYLE_DEFAULTS;
      const { data } = await supabase.from('app_config').select('theme').eq('id', 'default').single();
      const style = (data as any)?.theme?.style as Partial<StyleConfig> | undefined;
      return {
        dark:  { ...STYLE_DEFAULTS.dark,  ...(style?.dark  ?? {}) },
        light: { ...STYLE_DEFAULTS.light, ...(style?.light ?? {}) },
        font_family:    style?.font_family    ?? STYLE_DEFAULTS.font_family,
        custom_accents: style?.custom_accents ?? STYLE_DEFAULTS.custom_accents,
        extra_presets:  style?.extra_presets  ?? STYLE_DEFAULTS.extra_presets,
        hidden_presets: style?.hidden_presets ?? STYLE_DEFAULTS.hidden_presets,
        semantic_colors: style?.semantic_colors ?? STYLE_DEFAULTS.semantic_colors,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveStyleConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<StyleConfig>) => {
      if (!supabase) throw new Error('Supabase non configuré');
      const { data } = await supabase.from('app_config').select('theme').eq('id', 'default').single();
      const existing = (data as any)?.theme ?? {};
      const prev: StyleConfig = {
        dark:  { ...STYLE_DEFAULTS.dark,  ...(existing.style?.dark  ?? {}) },
        light: { ...STYLE_DEFAULTS.light, ...(existing.style?.light ?? {}) },
        font_family:    existing.style?.font_family    ?? STYLE_DEFAULTS.font_family,
        custom_accents: existing.style?.custom_accents ?? STYLE_DEFAULTS.custom_accents,
        extra_presets:  existing.style?.extra_presets  ?? STYLE_DEFAULTS.extra_presets,
        hidden_presets: existing.style?.hidden_presets ?? STYLE_DEFAULTS.hidden_presets,
        semantic_colors: existing.style?.semantic_colors ?? STYLE_DEFAULTS.semantic_colors,
      };
      const merged: StyleConfig = {
        dark:  { ...prev.dark,  ...(config.dark  ?? {}) },
        light: { ...prev.light, ...(config.light ?? {}) },
        font_family:    config.font_family    ?? prev.font_family,
        custom_accents: config.custom_accents ?? prev.custom_accents,
        extra_presets:  config.extra_presets  ?? prev.extra_presets,
        hidden_presets: config.hidden_presets ?? prev.hidden_presets,
        semantic_colors: config.semantic_colors ?? prev.semantic_colors,
      };
      const { error } = await supabase.from('app_config').update({
        theme: { ...existing, style: merged },
        updated_at: new Date().toISOString(),
      }).eq('id', 'default');
      if (error) throw error;
      return merged;
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: [KEY] }); },
  });
}
