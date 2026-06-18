/**
 * useUiPrefs — préférences d'interface + masquages de recommandations, stockés CÔTÉ COMPTE
 * (profiles.ui_prefs) plutôt qu'en local par appareil. Ainsi ces réglages suivent l'utilisateur
 * partout et ne divergent pas d'un écran/appareil à l'autre.
 */
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useProfile } from './useProfile';
import type { Profile, UiPrefs, RecoDismissals } from '../types/database';
import type { RecoType } from '../lib/recommendationEngine';

function monthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Masquages du mois courant (réinitialise automatiquement quand le mois change). */
function freshDismissals(prefs: UiPrefs): RecoDismissals {
  const m = monthKey();
  const stored = prefs.reco_dismissals;
  return stored && stored.month === m ? stored : { month: m, ignored: {}, completed: [] };
}

export function useUiPrefs(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: profile } = useProfile(userId);
  const prefs = (profile?.ui_prefs ?? {}) as UiPrefs;

  /** Fusionne `next` dans ui_prefs (lecture du cache le plus frais → pas d'écrasement croisé). */
  const patch = async (next: Partial<UiPrefs>) => {
    if (!supabase || !userId) return;
    const cached = qc.getQueryData<Profile>(['profile', userId]);
    const current = (cached?.ui_prefs ?? {}) as UiPrefs;
    const merged: UiPrefs = { ...current, ...next };
    // Optimiste : met à jour le cache tout de suite (UI réactive + lectures suivantes cohérentes).
    qc.setQueryData<Profile>(['profile', userId], (old) => (old ? { ...old, ui_prefs: merged } : old));
    const { error } = await supabase.from('profiles').update({ ui_prefs: merged, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) qc.invalidateQueries({ queryKey: ['profile', userId] }); // rollback via refetch
  };

  return { prefs, patch };
}

/** Conseils en haut du Pilotage (défaut : activé). */
export function usePilotageTips(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    enabled: prefs.pilotage_tips_enabled !== false,
    setEnabled: (v: boolean) => patch({ pilotage_tips_enabled: v }),
  };
}

/** Accès rapide à la calculatrice flottante (défaut : activé). */
export function useCalculatorEnabledPref(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    enabled: prefs.calculator_enabled !== false,
    setEnabled: (v: boolean) => patch({ calculator_enabled: v }),
  };
}

/** Masquages de recommandations du mois (ignorées / complétées), par compte. */
export function useRecoDismissals(userId: string | undefined) {
  const qc = useQueryClient();
  const { prefs, patch } = useUiPrefs(userId);
  const current = freshDismissals(prefs);

  // Lit l'état le plus frais depuis le cache au moment de l'ajout (évite d'écraser un ajout proche).
  const readFresh = () => freshDismissals((qc.getQueryData<Profile>(['profile', userId])?.ui_prefs ?? {}) as UiPrefs);

  const addIgnored = (type: RecoType, amount: number) => {
    const f = readFresh();
    patch({ reco_dismissals: { ...f, ignored: { ...f.ignored, [type]: Math.round(amount) } } });
  };
  const addCompleted = (type: RecoType) => {
    const f = readFresh();
    if (f.completed.includes(type)) return;
    patch({ reco_dismissals: { ...f, completed: [...f.completed, type] } });
  };

  return { ignored: current.ignored, completed: current.completed, addIgnored, addCompleted };
}
