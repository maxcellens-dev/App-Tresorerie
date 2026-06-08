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
  /** Couleur de fond de l'app (derrière le dégradé). Hex. */
  bg_color?: string;
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

/** Police personnalisée téléversée : nom de famille + URL du fichier (Supabase Storage). */
export interface CustomFont {
  family: string;
  url: string;
}

export interface StyleConfig {
  dark: ModeStyleConfig;
  light: ModeStyleConfig;
  /** Famille de police (CSS font-family). Ex: 'Inter', 'Georgia' */
  font_family: string;
  /** URL CSS d'import d'une police personnalisée (ex. lien Google Fonts). Chargée sur le web. */
  font_import_url: string;
  /** Famille de police appliquée au NOM de l'app (titre/logo). Ex: 'Pacifico'. Vide = défaut. */
  app_name_font: string;
  /** Polices téléversées (fichiers sur Supabase Storage), proposées dans les listes de polices. */
  custom_fonts: CustomFont[];
  /** Couleurs personnalisées par preset { emerald: '#00B67A', ocean: '#0075FF', ... } */
  custom_accents: Record<string, string>;
  /** Presets personnalisés créés dans le style editor */
  extra_presets: CustomPreset[];
  /** Identifiants des presets (natifs ou custom) masqués dans Paramètres */
  hidden_presets: string[];
  /** Ordre d'affichage des presets (ids natifs + custom). Les ids absents sont ajoutés à la fin. */
  preset_order: string[];
  /** Surcharges des couleurs sémantiques globales { danger, blue, violet, green, orange, teal, yellow } */
  semantic_colors: Record<string, string>;
}

/** Ordonne une liste d'ids de presets selon l'ordre sauvegardé (ids absents ajoutés à la fin). */
export function orderPresetIds(allIds: string[], order: string[] | undefined): string[] {
  const ord = (order ?? []).filter((id) => allIds.includes(id));
  const missing = allIds.filter((id) => !ord.includes(id));
  return [...ord, ...missing];
}

export const MODE_DEFAULTS: ModeStyleConfig = {
  gradient_enabled: true,
  gradient_opacity: 30,
  gradient_stops: [30, 18, 10, 5],
  card_alpha: 8,
  bg_color: '#000000',
};

export const STYLE_DEFAULTS: StyleConfig = {
  dark:  { ...MODE_DEFAULTS },
  light: { gradient_enabled: true, gradient_opacity: 20, gradient_stops: [20, 12, 7, 3], card_alpha: 4, bg_color: '#FFFFFF' },
  font_family: 'System',
  font_import_url: '',
  app_name_font: 'Arial Rounded MT Bold',
  custom_fonts: [],
  custom_accents: {},
  extra_presets: [],
  hidden_presets: [],
  preset_order: [],
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
        font_import_url: style?.font_import_url ?? STYLE_DEFAULTS.font_import_url,
        app_name_font:  style?.app_name_font  ?? STYLE_DEFAULTS.app_name_font,
        custom_fonts:   style?.custom_fonts   ?? STYLE_DEFAULTS.custom_fonts,
        custom_accents: style?.custom_accents ?? STYLE_DEFAULTS.custom_accents,
        extra_presets:  style?.extra_presets  ?? STYLE_DEFAULTS.extra_presets,
        hidden_presets: style?.hidden_presets ?? STYLE_DEFAULTS.hidden_presets,
        preset_order: style?.preset_order ?? STYLE_DEFAULTS.preset_order,
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
        font_import_url: existing.style?.font_import_url ?? STYLE_DEFAULTS.font_import_url,
        app_name_font:  existing.style?.app_name_font  ?? STYLE_DEFAULTS.app_name_font,
        custom_fonts:   existing.style?.custom_fonts   ?? STYLE_DEFAULTS.custom_fonts,
        custom_accents: existing.style?.custom_accents ?? STYLE_DEFAULTS.custom_accents,
        extra_presets:  existing.style?.extra_presets  ?? STYLE_DEFAULTS.extra_presets,
        hidden_presets: existing.style?.hidden_presets ?? STYLE_DEFAULTS.hidden_presets,
        preset_order: existing.style?.preset_order ?? STYLE_DEFAULTS.preset_order,
        semantic_colors: existing.style?.semantic_colors ?? STYLE_DEFAULTS.semantic_colors,
      };
      const merged: StyleConfig = {
        dark:  { ...prev.dark,  ...(config.dark  ?? {}) },
        light: { ...prev.light, ...(config.light ?? {}) },
        font_family:    config.font_family    ?? prev.font_family,
        font_import_url: config.font_import_url ?? prev.font_import_url,
        app_name_font:  config.app_name_font  ?? prev.app_name_font,
        custom_fonts:   config.custom_fonts   ?? prev.custom_fonts,
        custom_accents: config.custom_accents ?? prev.custom_accents,
        extra_presets:  config.extra_presets  ?? prev.extra_presets,
        hidden_presets: config.hidden_presets ?? prev.hidden_presets,
        preset_order: config.preset_order ?? prev.preset_order,
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
