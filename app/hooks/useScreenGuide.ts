/**
 * Suivi des guides "première visite" — stockage en BDD (profiles.guide_*_seen).
 * Permet de réinitialiser un guide manuellement depuis Supabase (passer à FALSE).
 * Fallback localStorage si la colonne BDD n'est pas encore disponible.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type GuideScreen = 'comptes' | 'transactions' | 'pilotage' | 'tresorerie' | 'parametres';

const COLUMN: Record<GuideScreen, string> = {
  comptes: 'guide_comptes_seen',
  transactions: 'guide_transactions_seen',
  pilotage: 'guide_pilotage_seen',
  tresorerie: 'guide_tresorerie_seen',
  parametres: 'guide_parametres_seen',
};

const GUIDES_KEY = 'guides_seen';

// ── Fallback localStorage (si colonne BDD absente / hors-ligne) ──

const ls = {
  get: (k: string): string | null => {
    try { return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null; } catch { return null; }
  },
  set: (k: string, v: string) => {
    try { if (typeof window !== 'undefined') window.localStorage.setItem(k, v); } catch {}
  },
};

function lsKey(screen: GuideScreen, userId?: string) {
  return `guide_seen_${screen}_${userId ?? 'anon'}`;
}

// ── Lecture des flags depuis profiles ───────────────────────────

export function useGuidesSeen(userId: string | undefined) {
  return useQuery({
    queryKey: [GUIDES_KEY, userId],
    queryFn: async (): Promise<Record<GuideScreen, boolean>> => {
      const fallback: Record<GuideScreen, boolean> = {
        comptes: ls.get(lsKey('comptes', userId)) === '1',
        transactions: ls.get(lsKey('transactions', userId)) === '1',
        pilotage: ls.get(lsKey('pilotage', userId)) === '1',
        tresorerie: ls.get(lsKey('tresorerie', userId)) === '1',
        parametres: ls.get(lsKey('parametres', userId)) === '1',
      };
      if (!supabase || !userId) return fallback;

      const { data, error } = await supabase
        .from('profiles')
        .select('guide_comptes_seen, guide_transactions_seen, guide_pilotage_seen, guide_tresorerie_seen, guide_parametres_seen')
        .eq('id', userId)
        .maybeSingle();

      // Colonnes absentes ou erreur → fallback localStorage
      if (error || !data) return fallback;

      return {
        comptes: Boolean((data as any).guide_comptes_seen),
        transactions: Boolean((data as any).guide_transactions_seen),
        pilotage: Boolean((data as any).guide_pilotage_seen),
        tresorerie: Boolean((data as any).guide_tresorerie_seen),
        parametres: Boolean((data as any).guide_parametres_seen),
      };
    },
    enabled: !!userId,
    staleTime: 1000 * 60,
  });
}

// ── Marquer un guide comme vu ───────────────────────────────────

export function useMarkGuideSeen(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (screen: GuideScreen) => {
      // Toujours écrire en localStorage (secours + instantané)
      ls.set(lsKey(screen, userId), '1');
      if (!supabase || !userId) return;
      // Écriture BDD non-fatale (colonne peut ne pas exister encore)
      await supabase
        .from('profiles')
        .update({ [COLUMN[screen]]: true })
        .eq('id', userId);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [GUIDES_KEY, userId] });
    },
  });
}

// ── Hook principal par écran ────────────────────────────────────

export function useScreenGuide(screen: GuideScreen, userId: string | undefined) {
  const { data: seen, isLoading } = useGuidesSeen(userId);
  const markSeen = useMarkGuideSeen(userId);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  const alreadySeen = seen?.[screen] ?? true; // par défaut "vu" tant qu'on ne sait pas

  useEffect(() => {
    if (!userId || isLoading) return;
    if (!alreadySeen) {
      const t = setTimeout(() => setVisible(true), 700);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
    }
  }, [userId, isLoading, alreadySeen]);

  const goNext = useCallback((totalSteps: number) => {
    if (step < totalSteps - 1) {
      setStep(step + 1);
    } else {
      setVisible(false);
      markSeen.mutate(screen);
    }
  }, [step, screen, markSeen]);

  const skip = useCallback(() => {
    setVisible(false);
    markSeen.mutate(screen);
  }, [screen, markSeen]);

  return { visible, step, goNext, skip };
}
