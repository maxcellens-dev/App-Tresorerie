/**
 * Onboarding — guide "Pour bien démarrer" : checklist d'étapes à accomplir.
 * - Le tour de présentation (obligatoire) est piloté par `profiles.app_tour_done`.
 * - Les étapes sont soit DÉDUITES des données (compte épargne, récurrence, projet,
 *   recommandation), soit marquées explicitement (réservés consultés,
 *   projection modifiée) dans `profiles.onboarding_state`.
 */
import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from './useProfile';
import { useAccounts } from './useAccounts';
import { useTransactions } from './useTransactions';
import { useProjects } from './useProjects';
import { useReservations } from './useReservations';
import { usePreSavings } from './usePreSavings';

export type OnboardingStepKey =
  | 'account_initialized'
  | 'recurring_tx'
  | 'project'
  | 'reco_validated'
  | 'reserved_consulted'
  | 'projection_edited';

// 'comptes' remplace le tour ancré qui présentait cette page : la page la plus structurante de
// l'app n'avait plus aucune présentation depuis son retrait.
export type PageIntroKey = 'transactions' | 'pilotage' | 'projets' | 'projection' | 'comptes';

export type OnboardingFlag =
  | 'dismissed' | 'checklist_intro_shown' | 'reserved_consulted' | 'projection_edited' | 'reco_validated'
  /** Vue pédagogique du tableau de bord (4 recommandations + 2 façons de s'en servir) déjà lue. */
  | 'discovery_intro_seen'
  // (`pilotage_simple` retiré : le tableau de bord n'a plus qu'une seule mise en page. D'anciens
  //  profils portent encore la clé dans `onboarding_state` — elle n'est simplement plus lue.)
  | 'intro_seen_transactions' | 'intro_seen_pilotage' | 'intro_seen_projets' | 'intro_seen_projection'
  | 'intro_seen_comptes' | 'intro_seen_menu';

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
  /** Vue pédagogique du tableau de bord déjà lue (remplace le tour ancré obligatoire). */
  discovery_intro_seen?: boolean;
  reserved_consulted?: boolean;
  projection_edited?: boolean;
  reco_validated?: boolean;
  // Présentations « 1ʳᵉ visite » par page (modal centré). Réinitialisées si on relance le tuto.
  intro_seen_transactions?: boolean;
  intro_seen_pilotage?: boolean;
  intro_seen_projets?: boolean;
  intro_seen_projection?: boolean;
  intro_seen_comptes?: boolean;
  intro_seen_menu?: boolean;
}

/** Toutes les clés de présentation de page, pour réinitialiser le tuto. */
export const ALL_PAGE_INTRO_KEYS: PageIntroKey[] = ['transactions', 'comptes', 'projets', 'projection', 'pilotage'];

// Les DEUX premières étapes sont les conditions de FIABILITÉ des calculs : sans elles, le Relyka
// et les conseils restent approximatifs. Les suivantes font découvrir des fonctions utiles mais
// n'ont aucun effet sur la justesse des chiffres — c'est l'ordre de la liste qui le dit.
// Tutoiement partout (règle de l'app) : ces libellés étaient restés au vouvoiement.
const STEP_META: { key: OnboardingStepKey; label: string; hint: string; route: string }[] = [
  { key: 'account_initialized', label: 'Mettre à jour le solde de tes comptes', route: '/(tabs)/comptes/solde', hint: 'Recopie le solde affiché par ta banque : c\'est ce qui rend tous tes chiffres justes. Bouton « + » → « Solde ».' },
  { key: 'recurring_tx',      label: 'Enregistrer tes revenus et charges récurrents', route: '/(tabs)/transactions', hint: 'Bouton « + » → « Dépense » ou « Recette », puis active « Récurrent » : tu ne les saisis qu\'une fois.' },
  // Suivre une reco puis consulter ses réservés viennent AVANT la création d'un projet : ce sont
  // les gestes du mois en cours, ceux qui font vivre le Relyka. Un projet est un engagement plus
  // long, il a sa place une fois le quotidien en place.
  { key: 'reco_validated',    label: 'Suivre une recommandation',           route: '/(tabs)/pilotage',     hint: 'Section Recommandations → Épargner, Investir, Réserver ou Cumuler, puis enregistre l\'action.' },
  { key: 'reserved_consulted',label: 'Voir tes montants réservés',          route: '/(tabs)/pilotage',     hint: 'Suivi du mois → appuie sur la ligne « Réservé » pour voir le détail.' },
  { key: 'project',           label: 'Créer un projet',                     route: '/(tabs)/projects',     hint: 'Appuie sur « + Projet » : mettre de côté, dépenser petit à petit, ou réserver pour plus tard.' },
  { key: 'projection_edited', label: 'Personnaliser une projection',        route: '/(tabs)/projection',   hint: 'Saisis une valeur dans « Hypothèse » ou « Épargne personnalisée ».' },
];

/** Indices par étape, pour le coachmark affiché à l'arrivée sur l'écran. */
export const ONBOARDING_HINTS: Record<OnboardingStepKey, { label: string; hint: string }> =
  Object.fromEntries(STEP_META.map((m) => [m.key, { label: m.label, hint: m.hint }])) as Record<OnboardingStepKey, { label: string; hint: string }>;

export function useUpdateOnboarding(userId: string | undefined) {
  const qc = useQueryClient();
  const { isImpersonating } = useAuth();
  return useMutation({
    mutationFn: async (patch: { app_tour_done?: boolean; flags?: Partial<Record<OnboardingFlag, boolean>> }) => {
      // En mode « connecté en tant que » (consultation admin) : on n'écrit JAMAIS l'état
      // d'onboarding du compte cible (tour de présentation, étapes du guide, présentations de
      // page…). Visiter un compte ne doit pas valider/avancer son onboarding.
      if (isImpersonating) return;
      if (!supabase || !userId) return;
      const updates: Record<string, any> = {};
      if (patch.app_tour_done !== undefined) updates.app_tour_done = patch.app_tour_done;
      if (patch.flags) {
        // Fusionne avec l'état existant. ⚠️ Lecture-modification-écriture : une lecture EN ÉCHEC
        // rendue comme « état vide » ferait repartir la fusion de {} et EFFACERAIT tous les
        // drapeaux déjà acquis. On propage l'erreur → la mutation échoue, l'état reste intact.
        const { data, error } = await supabase
          .from('profiles').select('onboarding_state').eq('id', userId).single();
        if (error) throw error;
        const prev = ((data as any)?.onboarding_state ?? {}) as OnboardingState;
        updates.onboarding_state = { ...prev, ...patch.flags };
      }
      if (Object.keys(updates).length === 0) return;
      const { error: writeError } = await supabase.from('profiles').update(updates).eq('id', userId);
      if (writeError) throw writeError;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile', userId] }); },
  });
}

export function useOnboarding(userId: string | undefined) {
  const { data: profile } = useProfile(userId);
  const { data: accounts = [] } = useAccounts(userId);
  const { data: transactions = [] } = useTransactions(userId);
  const { data: projects = [] } = useProjects(userId);
  const { data: reservations = [] } = useReservations(userId);
  const { data: preSavings } = usePreSavings(userId);
  const update = useUpdateOnboarding(userId);

  const state = ((profile as any)?.onboarding_state ?? {}) as OnboardingState;
  const appTourDone = Boolean((profile as any)?.app_tour_done);
  const questionnaireDone = Boolean((profile as any)?.initial_onboarding_completed);

  // Étapes déduites des données (le reste vient de drapeaux explicites dans onboarding_state).
  // Clés « data » : une fois accomplies, on les fige (done_<clé>) pour qu'elles restent
  // validées même si l'utilisateur supprime ensuite l'élément créé.
  const DATA_KEYS: OnboardingStepKey[] = ['account_initialized', 'recurring_tx', 'project'];
  const persistedDone = (k: OnboardingStepKey) => Boolean((state as any)['done_' + k]);

  const { steps, pendingPersist } = useMemo(() => {
    const hasBalance = accounts.some((a: any) => a.type === 'checking' && Number(a.balance) !== 0);
    const hasRegul = (transactions as any[]).some(
      (t) => typeof t.note === 'string' && (t.note.startsWith('Régularisation') || t.note === 'Ajustement de solde')
    );
    const hasRecurring = (transactions as any[]).some((t) => t.is_recurring);

    const dataDone: Record<string, boolean> = {
      account_initialized: hasBalance || hasRegul,
      recurring_tx: hasRecurring,
      project: projects.length > 0,
    };
    const done: Record<OnboardingStepKey, boolean> = {
      account_initialized: dataDone.account_initialized || persistedDone('account_initialized'),
      recurring_tx: dataDone.recurring_tx || persistedDone('recurring_tx'),
      project: dataDone.project || persistedDone('project'),
      // « Suivre une recommandation » : validée UNIQUEMENT en passant par les boutons de reco
      // (Épargner / Investir / Conserver / Cumuler), pas par un virement épargne quelconque.
      reco_validated: Boolean(state.reco_validated),
      reserved_consulted: Boolean(state.reserved_consulted),
      projection_edited: Boolean(state.projection_edited),
    };
    const pending = DATA_KEYS.filter((k) => dataDone[k] && !persistedDone(k));
    return { steps: STEP_META.map((m) => ({ ...m, done: done[m.key] })), pendingPersist: pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, transactions, projects, reservations, preSavings, state]);

  // Fige les étapes déduites accomplies (persistance « apprise une fois »).
  const persistDone = () => {
    if (!pendingPersist.length) return;
    const flags: Record<string, boolean> = {};
    pendingPersist.forEach((k) => { flags['done_' + k] = true; });
    update.mutate({ flags: flags as any });
  };

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount === total;
  const dismissed = Boolean(state.dismissed);

  // Badge visible dès qu'il reste des étapes et que le guide n'est pas refusé.
  // (Le badge vit dans l'en-tête des onglets, donc uniquement après l'onboarding.)
  const badgeVisible = !dismissed && !allDone;
  // Auto-ouverture de la checklist : une seule fois, après la vue de découverte du tableau de bord.
  // (Elle était conditionnée au tour ancré `app_tour_done`, qui n'est plus déclenché automatiquement
  // — sans ce changement, le drapeau ne serait jamais posé chez les nouveaux comptes.)
  const shouldAutoOpenChecklist =
    Boolean(state.discovery_intro_seen || appTourDone) && !dismissed && !allDone && !state.checklist_intro_shown;

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
    pendingPersist,
    persistDone,
    markTourDone: () => update.mutate({ app_tour_done: true }),
    markFlag: (flag: OnboardingFlag, value = true) => update.mutate({ flags: { [flag]: value } }),
    dismiss: () => update.mutate({ flags: { dismissed: true } }),
  };
}
