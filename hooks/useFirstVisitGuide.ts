/**
 * Brouillon de progression du questionnaire d'onboarding (reprise « là où on s'est arrêté »).
 * Persisté en localStorage (web uniquement, no-op sur natif) ; la complétion finale est en base
 * (profiles.initial_onboarding_completed). Les guides d'écran sont désormais gérés par TourContext.
 */

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
