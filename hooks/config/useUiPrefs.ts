/**
 * useUiPrefs — préférences d'interface stockées CÔTÉ COMPTE (profiles.ui_prefs) plutôt qu'en local
 * par appareil : ces réglages suivent l'utilisateur partout et ne divergent pas d'un appareil à
 * l'autre.
 */
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useProfile } from '../data/useProfile';
import type { Profile, UiPrefs } from '../../types/database';
import { resolveCalculatorPages, type CalculatorPageId } from '../../lib/ui/calculatorPages';
export { CALCULATOR_PAGES, CALCULATOR_GROUPS, DEFAULT_CALCULATOR_PAGES, type CalculatorPageId } from '../../lib/ui/calculatorPages';

export function useUiPrefs(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: profile } = useProfile(userId);
  const prefs = (profile?.ui_prefs ?? {}) as UiPrefs;

  /**
   * Fusionne `next` dans ui_prefs (lecture du cache le plus frais → pas d'écrasement croisé).
   *
   * Renvoie `true` si le réglage est bien parti, `false` sinon. Le résultat était jeté : l'écran
   * affichait sa coche de confirmation même quand l'écriture avait échoué, et le cache revenait à
   * l'ancienne valeur une seconde plus tard, sans un mot. Les appelants qui n'en font rien ne
   * changent pas de comportement ; ceux qui confirment quelque chose à l'utilisateur peuvent
   * désormais dire la vérité.
   */
  const patch = async (next: Partial<UiPrefs>): Promise<boolean> => {
    if (!supabase || !userId) return false;
    const cached = qc.getQueryData<Profile>(['profile', userId]);
    const current = (cached?.ui_prefs ?? {}) as UiPrefs;
    const merged: UiPrefs = { ...current, ...next };
    // Optimiste : met à jour le cache tout de suite (UI réactive + lectures suivantes cohérentes).
    qc.setQueryData<Profile>(['profile', userId], (old) => (old ? { ...old, ui_prefs: merged } : old));
    const { error } = await supabase.from('profiles').update({ ui_prefs: merged, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) {
      qc.invalidateQueries({ queryKey: ['profile', userId] }); // rollback via refetch
      return false;
    }
    return true;
  };

  return { prefs, patch };
}

/** Conseils en haut du Pilotage (défaut : activé). */
export function usePilotageTips(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    enabled: prefs.pilotage_tips_enabled !== false,
    setEnabled: (v: boolean): void => { void patch({ pilotage_tips_enabled: v }); },
  };
}

/** Accès rapide à la calculatrice flottante (défaut : activé). */
export function useCalculatorEnabledPref(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    enabled: prefs.calculator_enabled !== false,
    setEnabled: (v: boolean): void => { void patch({ calculator_enabled: v }); },
  };
}

/** Pages où le bouton calculatrice est affiché (liste et lecture : lib/ui/calculatorPages). */
export function useCalculatorPagesPref(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    pages: resolveCalculatorPages(prefs.calculator_pages),
    setPages: (v: CalculatorPageId[]): void => { void patch({ calculator_pages: v }); },
  };
}

/** Horizon de la page Projection : 6 (défaut) ou 12 mois, persisté par compte. */
export function useProjectionHorizon(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    horizon: (prefs.projection_horizon === 12 ? 12 : 6) as 6 | 12,
    setHorizon: (v: 6 | 12): void => { void patch({ projection_horizon: v }); },
  };
}
