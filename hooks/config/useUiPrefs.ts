/**
 * useUiPrefs — préférences d'interface + masquages de recommandations, stockés CÔTÉ COMPTE
 * (profiles.ui_prefs) plutôt qu'en local par appareil. Ainsi ces réglages suivent l'utilisateur
 * partout et ne divergent pas d'un écran/appareil à l'autre.
 */
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useProfile } from '../data/useProfile';
import type { Profile, UiPrefs, RecoDismissals } from '../../types/database';
import type { RecoType } from '../../lib/finance/recommendationEngine';

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

/** Pages pouvant afficher le bouton calculatrice (id stable + libellé pour les Paramètres). */
export const CALCULATOR_PAGES = [
  { id: 'comptes', label: 'Comptes' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'pilotage', label: 'Pilotage' },
  { id: 'projets', label: 'Projets' },
  { id: 'projection', label: 'Projection' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'conseils-ia', label: 'Conseils IA' },
] as const;
export type CalculatorPageId = (typeof CALCULATOR_PAGES)[number]['id'];

/** Défaut : Transactions uniquement — les autres pages s'ajoutent dans les Paramètres. */
export const DEFAULT_CALCULATOR_PAGES: CalculatorPageId[] = ['transactions'];

/** Pages où le bouton calculatrice est affiché (multi-sélection, défaut = sélection historique). */
export function useCalculatorPagesPref(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  const valid = new Set<string>(CALCULATOR_PAGES.map((p) => p.id));
  const stored = Array.isArray(prefs.calculator_pages)
    ? (prefs.calculator_pages.filter((p) => valid.has(p)) as CalculatorPageId[])
    : null;
  return {
    pages: stored ?? DEFAULT_CALCULATOR_PAGES,
    setPages: (v: CalculatorPageId[]) => patch({ calculator_pages: v }),
  };
}

/** Horizon de la page Projection : 6 (défaut) ou 12 mois, persisté par compte. */
export function useProjectionHorizon(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    horizon: (prefs.projection_horizon === 12 ? 12 : 6) as 6 | 12,
    setHorizon: (v: 6 | 12) => patch({ projection_horizon: v }),
  };
}

/** Période de la page Reporting : 3, 6 (défaut) ou 12 mois, persistée par compte. */
export function useReportingPeriod(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  const p = prefs.reporting_period;
  return {
    period: (p === 3 || p === 12 ? p : 6) as 3 | 6 | 12,
    setPeriod: (v: 3 | 6 | 12) => patch({ reporting_period: v }),
  };
}

/** #2 — Filtre persistant des TOTAUX de la page Comptes : tout / comptes perso / comptes partagés. */
export function useAccountsTotalsFilter(userId: string | undefined) {
  const { prefs, patch } = useUiPrefs(userId);
  return {
    filter: (prefs.accounts_totals_filter ?? 'all') as 'all' | 'perso' | 'shared',
    setFilter: (v: 'all' | 'perso' | 'shared') => patch({ accounts_totals_filter: v }),
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
  /** Relancer les recommandations : efface masquages (ignorées + complétées) du mois courant. */
  const resetDismissals = () => {
    patch({ reco_dismissals: { month: monthKey(), ignored: {}, completed: [] } });
  };

  return { ignored: current.ignored, completed: current.completed, addIgnored, addCompleted, resetDismissals };
}
