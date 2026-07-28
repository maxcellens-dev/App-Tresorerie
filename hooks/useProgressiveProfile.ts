/**
 * useProgressiveProfile — branche le moteur `lib/progressiveProfile` sur les données réelles.
 *
 * Persistance : tout tient dans `profiles.onboarding_state` (jsonb existant → aucune migration).
 *   pp_live         : la phase progressive est en cours (profil recalculé en direct)
 *   pp_socle        : le démarrage a été terminé
 *   pp_ev_*         : compteurs d'événements (any / relyka / comptes / tx)
 *   pp_done_<clé>   : question répondue (y compris « je ne sais pas »)
 *
 * « Plus tard » n'est PAS persisté : il vaut pour la session en cours. La question revient au
 * prochain lancement — on guide jusqu'au bout sans jamais bloquer.
 */
import { useCallback, useMemo, useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useQuestionnaireAnswers, useLiveProfileSync } from './useFinancialProfile';
import {
  nextProgressiveQuestion,
  profileStillProvisional,
  PROGRESSIVE_ORDER,
  type ProgressiveKey,
  type ProgressivePick,
} from '../lib/progressiveProfile';
import {
  safetyMarginFromQ8,
  weeklyVariableFromQ9,
  estimateWeeklyVariable,
} from '../lib/financialProfileEngine';
import { incomeFromQ3 } from '../lib/securityCushion';

/** Événements observables. `any` est incrémenté à chaque fois, quel que soit le type. */
export type ProgressiveEventKind = 'any' | 'relyka' | 'comptes' | 'tx';

/* ── Report « plus tard » : mémoire de SESSION (module rechargé au lancement) ── */
const snoozedThisSession = new Set<ProgressiveKey>();
let snoozeListeners: Array<() => void> = [];
function notifySnooze() { snoozeListeners.forEach((l) => l()); }

export function useProgressiveProfile() {
  const { user, isImpersonating } = useAuth();
  const userId = user?.id;
  const client = useQueryClient();
  const { data: profile } = useProfile(userId);
  const { data: answers } = useQuestionnaireAnswers(userId);
  const liveSync = useLiveProfileSync(userId);

  // Re-rendu quand un report change (l'état vit hors de React pour survivre aux démontages).
  const [, forceTick] = useState(0);
  useEffect(() => {
    const l = () => forceTick((n) => n + 1);
    snoozeListeners.push(l);
    return () => { snoozeListeners = snoozeListeners.filter((x) => x !== l); };
  }, []);

  const state = ((profile as any)?.onboarding_state ?? {}) as Record<string, any>;

  /**
   * Une question compte comme répondue UNIQUEMENT via son drapeau `pp_done_<clé>`.
   *
   * ⚠️ Surtout pas « la ligne de réponse est non vide » : le socle écrit délibérément des valeurs
   * NEUTRES pour q4 et q6 (le profil doit exister dès la sortie du démarrage, même provisoire).
   * S'y fier faisait passer ces deux questions pour déjà répondues — et plus aucune ne se
   * déclenchait. Le drapeau distingue « une valeur existe » de « l'utilisateur a répondu ».
   */
  const answered = useMemo(() => {
    const done: Record<string, boolean> = {};
    for (const k of PROGRESSIVE_ORDER) done[k] = Boolean(state['pp_done_' + k]);
    return done;
  }, [state]);

  const pick: ProgressivePick | null = useMemo(() => {
    if (isImpersonating) return null;            // consultation admin : aucune question au compte cible
    if (!profile) return null;
    return nextProgressiveQuestion({
      socleDone: Boolean(state.pp_socle),
      events: {
        any: Number(state.pp_ev_any ?? 0),
        relyka: Number(state.pp_ev_relyka ?? 0),
        comptes: Number(state.pp_ev_comptes ?? 0),
        tx: Number(state.pp_ev_tx ?? 0),
      },
      answered,
      snoozed: Object.fromEntries([...snoozedThisSession].map((k) => [k, true])),
    });
  }, [profile, state, answered, isImpersonating]);

  const provisional = Boolean(state.pp_live) && profileStillProvisional(answered);

  /**
   * Écriture fusionnée dans onboarding_state.
   * `patch` peut être une FONCTION de l'état fraîchement relu : indispensable pour les compteurs,
   * qui doivent s'incrémenter à partir de la valeur en base et non d'un cache potentiellement
   * périmé (deux écrans qui signalent une interaction quasi simultanément).
   */
  const patchState = useCallback(async (
    patch: Record<string, any> | ((prev: Record<string, any>) => Record<string, any> | null),
  ) => {
    if (isImpersonating || !supabase || !userId) return;
    const { data, error } = await supabase.from('profiles').select('onboarding_state').eq('id', userId).single();
    if (error) throw error;                       // une lecture en échec ne doit JAMAIS repartir de {}
    const prev = ((data as any)?.onboarding_state ?? {}) as Record<string, any>;
    const resolved = typeof patch === 'function' ? patch(prev) : patch;
    if (!resolved) return;                        // rien à écrire (ex. phase progressive terminée)
    const { error: wErr } = await supabase.from('profiles')
      .update({ onboarding_state: { ...prev, ...resolved } })
      .eq('id', userId);
    if (wErr) throw wErr;
    client.invalidateQueries({ queryKey: ['profile', userId] });
  }, [client, isImpersonating, userId]);

  /**
   * Signale une interaction. Silencieux et non bloquant : c'est un compteur, jamais un chemin
   * critique — s'il échoue, l'utilisateur ne doit rien voir.
   *
   * ⚠️ Cette fonction doit rester STABLE (aucune dépendance sur `state`). Les écrans l'appellent
   * depuis un `useFocusEffect` qui en dépend : si son identité changeait à chaque écriture, elle
   * relancerait l'effet, qui réécrirait, à l'infini. On lit donc l'état frais dans patchState.
   */
  const trackEvent = useCallback((kind: ProgressiveEventKind = 'any') => {
    if (isImpersonating || !userId) return;
    patchState((prev) => {
      if (!prev.pp_socle) return null;            // rien tant que le démarrage n'est pas fini
      if (!prev.pp_live) return null;             // phase progressive terminée
      // Toutes les questions répondues : plus rien à déclencher → on arrête d'écrire des compteurs
      // à chaque changement d'écran (le profil, lui, continue de suivre les données réelles).
      if (PROGRESSIVE_ORDER.every((k) => prev['pp_done_' + k])) return null;
      const next: Record<string, any> = { pp_ev_any: Number(prev.pp_ev_any ?? 0) + 1 };
      if (kind !== 'any') next['pp_ev_' + kind] = Number(prev['pp_ev_' + kind] ?? 0) + 1;
      return next;
    }).catch(() => {});
  }, [isImpersonating, patchState, userId]);

  const snooze = useCallback((key: ProgressiveKey) => {
    snoozedThisSession.add(key);
    notifySnooze();
  }, []);

  /** Enregistre la réponse, met à jour les champs dérivés, puis recalcule le profil en direct. */
  const answer = useMutation({
    mutationFn: async ({ key, value }: { key: ProgressiveKey; value: string }) => {
      if (isImpersonating || !supabase || !userId) return;
      const now = new Date().toISOString();

      await supabase.from('user_questionnaire_answers')
        .upsert({ user_id: userId, [key]: value, updated_at: now }, { onConflict: 'user_id' });

      // Champs dérivés : mêmes conversions que le questionnaire historique, pour que les deux
      // chemins produisent exactement les mêmes valeurs en base.
      if (key === 'q8') {
        await supabase.from('profiles')
          .update({ safety_margin_amount: safetyMarginFromQ8(value) })
          .eq('id', userId);
      }
      if (key === 'q9') {
        // « Je ne sais pas » → estimation automatique depuis la tranche de revenu, jamais 0 :
        // supposer zéro dépense variable gonflerait le Relyka de façon trompeuse.
        const weekly = weeklyVariableFromQ9(value)
          || estimateWeeklyVariable(String((answers as any)?.q3 ?? ''));
        await supabase.from('profiles')
          .update({ weekly_variable_budget: weekly > 0 ? weekly : null })
          .eq('id', userId);
      }

      await patchState({ ['pp_done_' + key]: true });
      return key;
    },
    onSuccess: async (key) => {
      client.invalidateQueries({ queryKey: ['questionnaire_answers', userId] });
      client.invalidateQueries({ queryKey: ['profile', userId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', userId] });
      // Une réponse de profil peut faire changer le palier : on le recalcule tout de suite.
      if (key === 'q4' || key === 'q6') liveSync.mutate();
    },
  });

  return {
    /** La question à poser maintenant (ou null). */
    pick,
    /** Le profil est-il encore provisoire ? (des questions de profil sans réponse) */
    provisional,
    /** Phase progressive en cours. */
    active: Boolean(state.pp_live),
    trackEvent,
    snooze,
    answer: (key: ProgressiveKey, value: string) => answer.mutate({ key, value }),
    saving: answer.isPending,
    /** Revenu mensuel de référence — sert à illustrer les tranches en euros (« ≈ 180 € / mois »). */
    monthlyIncome: incomeFromQ3((answers as any)?.q3),
  };
}
