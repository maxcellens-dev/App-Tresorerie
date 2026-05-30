/**
 * Gestion des guides "première visite" par écran.
 * Persistance via localStorage (web) — compatible avec une future migration AsyncStorage.
 * Si un guide n'est pas terminé, il est reproposé au prochain lancement.
 */

import { useState, useEffect, useCallback } from 'react';

const storage = {
  get: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {}
    return null;
  },
  set: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
  },
};

export interface GuideState {
  step: number;
  completed: boolean;
}

function guideKey(screen: string, userId?: string) {
  return `guide_${screen}_${userId ?? 'anon'}`;
}

/**
 * Hook pour un guide d'écran.
 * - `visible` : true si le guide doit s'afficher
 * - `step` : étape courante (0-based)
 * - `goNext` : passe à l'étape suivante
 * - `dismiss` : ferme et marque comme terminé
 * - `skipAll` : ferme sans marquer les étapes suivantes
 */
export function useFirstVisitGuide(screen: string, totalSteps: number, userId?: string) {
  const key = guideKey(screen, userId);

  const [state, setState] = useState<GuideState>(() => {
    const raw = storage.get(key);
    if (raw) {
      try {
        const parsed: GuideState = JSON.parse(raw);
        // Si non terminé, reproposer depuis le début
        if (!parsed.completed) return { step: 0, completed: false };
        return parsed;
      } catch {}
    }
    return { step: 0, completed: false };
  });

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (userId && !state.completed) {
      // Petit délai pour laisser l'écran se charger
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [userId, state.completed]);

  const save = useCallback((newState: GuideState) => {
    setState(newState);
    storage.set(key, JSON.stringify(newState));
  }, [key]);

  const goNext = useCallback(() => {
    if (state.step < totalSteps - 1) {
      save({ step: state.step + 1, completed: false });
    } else {
      save({ step: state.step, completed: true });
      setVisible(false);
    }
  }, [state.step, totalSteps, save]);

  const dismiss = useCallback(() => {
    save({ step: state.step, completed: true });
    setVisible(false);
  }, [state.step, save]);

  const skipAll = useCallback(() => {
    save({ step: totalSteps - 1, completed: true });
    setVisible(false);
  }, [totalSteps, save]);

  return { visible, step: state.step, goNext, dismiss, skipAll };
}

// ── Clé pour le progrès du questionnaire ─────────────────────

const questionnaireKey = (userId?: string) => `questionnaire_progress_${userId ?? 'anon'}`;

export interface QuestionnaireProgress {
  currentStep: number;
  answers: Record<string, string>;
}

export function saveQuestionnaireProgress(userId: string | undefined, progress: QuestionnaireProgress) {
  storage.set(questionnaireKey(userId), JSON.stringify(progress));
}

export function loadQuestionnaireProgress(userId: string | undefined): QuestionnaireProgress | null {
  const raw = storage.get(questionnaireKey(userId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function clearQuestionnaireProgress(userId: string | undefined) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(questionnaireKey(userId));
    }
  } catch {}
}
