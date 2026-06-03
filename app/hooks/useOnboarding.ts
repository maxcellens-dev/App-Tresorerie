/**
 * Onboarding — guide "Pour bien démarrer" : checklist d'étapes à accomplir.
 * - Le tour de présentation (obligatoire) est piloté par `profiles.app_tour_done`.
 * - Les étapes sont soit DÉDUITES des données (compte épargne, récurrence, projet,
 *   objectif, recommandation), soit marquées explicitement (réservés consultés,
 *   projection modifiée) dans `profiles.onboarding_state`.
 */
import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useProfile } from './useProfile';
import { useAccounts } from './useAccounts';
import { useTransactions } from './useTransactions';
import { useProjects } from './useProjects';
import { useObjectives } from './useObjectives';
import { useReservations } from './useReservations';
import { usePreSavings } from './usePreSavings';

export type OnboardingStepKey =
  | 'savings_account'
  | 'recurring_tx'
  | 'project'
  | 'objective'
  | 'reco_validated'
  | 'reserved_consulted'
  | 'projection_edited';

export type OnboardingFlag = 'dismissed' | 'checklist_intro_shown' | 'reserved_consulted' | 'projection_edited';

export interface OnboardingStep {
  key: OnboardingStepKey;
  label: string;
  hint: string;
  route: string;
  done: boolean;
}

interface OnboardingState {
  dismissed?: boolean;
  checklist_intro_shown?: boolean;
  reserved_consulted?: boolean;
  projection_edited?: boolean;
}

const STEP_META: { key: OnboardingStepKey; label: string; hint: string; route: string }[] = [
  { key: 'savings_account',   label: 'Créer un compte d\'épargne',          route: '/(tabs)/comptes',      hint: 'Onglet Comptes → bouton « Compte » → choisissez le type « Épargne ».' },
  { key: 'recurring_tx',      label: 'Ajouter une transaction récurrente',  route: '/(tabs)/transactions', hint: 'Bouton « Dépense » ou « Recette » → activez « Récurrent » avant d\'enregistrer.' },
  { key: 'project',           label: 'Créer un projet',                     route: '/(tabs)/projects',     hint: 'Appuyez sur « + » pour définir un projet d\'épargne (voiture, voyage…).' },
  { key: 'objective',         label: 'Définir un objectif',                 route: '/(tabs)/objectives',   hint: 'Appuyez sur « + » pour fixer un objectif annuel d\'investissement.' },
  { key: 'reco_validated',    label: 'Suivre une recommandation',           route: '/(tabs)/pilotage',     hint: 'Section Recommandations → Épargner, Investir, Conserver ou Cumuler, puis enregistrez l\'action.' },
  { key: 'reserved_consulted',label: 'Consulter vos montants réservés',     route: '/(tabs)/pilotage',     hint: 'Suivi du mois → appuyez sur la ligne « Réservé » pour voir le détail.' },
  { key: 'projection_edited', label: 'Personnaliser une projection',        route: '/(tabs)/projection',   hint: 'Saisissez une valeur dans « Hypothèse » ou « Épargne personnalisée ».' },
];

/** Indices par étape, pour le coachmark affiché à l'arrivée sur l'écran. */
export const ONBOARDING_HINTS: Record<OnboardingStepKey, { label: string; hint: string }> =
  Object.fromEntries(STEP_META.map((m) => [m.key, { label: m.label, hint: m.hint }])) as Record<OnboardingStepKey, { label: string; hint: string }>;

export function useUpdateOnboarding(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { app_tour_done?: boolean; flags?: Partial<Record<OnboardingFlag, boolean>> }) => {
      if (!supabase || !userId) return;
      const updates: Record<string, any> = {};
      if (patch.app_tour_done !== undefined) updates.app_tour_done = patch.app_tour_done;
      if (patch.flags) {
        // Fusionne avec l'état existant.
        const { data } = await supabase.from('profiles').select('onboarding_state').eq('id', userId).single();
        const prev = ((data as any)?.onboarding_state ?? {}) as OnboardingState;
        updates.onboarding_state = { ...prev, ...patch.flags };
      }
      if (Object.keys(updates).length === 0) return;
      await supabase.from('profiles').update(updates).eq('id', userId);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile', userId] }); },
  });
}

export function useOnboarding(userId: string | undefined) {
  const { data: profile } = useProfile(userId);
  const { data: accounts = [] } = useAccounts(userId);
  const { data: transactions = [] } = useTransactions(userId);
  const { data: projects = [] } = useProjects(userId);
  const { data: objectives = [] } = useObjectives(userId);
  const { data: reservations = [] } = useReservations(userId);
  const { data: preSavings } = usePreSavings(userId);
  const update = useUpdateOnboarding(userId);

  const state = ((profile as any)?.onboarding_state ?? {}) as OnboardingState;
  const appTourDone = Boolean((profile as any)?.app_tour_done);
  const questionnaireDone = Boolean((profile as any)?.initial_onboarding_completed);

  const steps: OnboardingStep[] = useMemo(() => {
    const hasSavings = accounts.some((a: any) => a.type === 'savings');
    const hasRecurring = (transactions as any[]).some((t) => t.is_recurring);
    const hasReco =
      (preSavings?.epargne?.total_cumule ?? 0) > 0 ||
      (preSavings?.invest?.total_cumule ?? 0) > 0 ||
      reservations.length > 0 ||
      (transactions as any[]).some((t) => t.linked_account?.type === 'savings' || t.linked_account?.type === 'investment');

    const done: Record<OnboardingStepKey, boolean> = {
      savings_account: hasSavings,
      recurring_tx: hasRecurring,
      project: projects.length > 0,
      objective: objectives.length > 0,
      reco_validated: hasReco,
      reserved_consulted: Boolean(state.reserved_consulted),
      projection_edited: Boolean(state.projection_edited),
    };
    return STEP_META.map((m) => ({ ...m, done: done[m.key] }));
  }, [accounts, transactions, projects, objectives, reservations, preSavings, state.reserved_consulted, state.projection_edited]);

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount === total;
  const dismissed = Boolean(state.dismissed);

  // Badge visible : tour terminé, non refusé, pas tout fini.
  const badgeVisible = appTourDone && !dismissed && !allDone;
  // Auto-ouverture de la checklist : juste après le tour, une seule fois.
  const shouldAutoOpenChecklist = appTourDone && !dismissed && !allDone && !state.checklist_intro_shown;

  return {
    profile,
    questionnaireDone,
    appTourDone,
    steps,
    doneCount,
    total,
    allDone,
    dismissed,
    badgeVisible,
    shouldAutoOpenChecklist,
    markTourDone: () => update.mutate({ app_tour_done: true }),
    markFlag: (flag: OnboardingFlag, value = true) => update.mutate({ flags: { [flag]: value } }),
    dismiss: () => update.mutate({ flags: { dismissed: true } }),
  };
}
