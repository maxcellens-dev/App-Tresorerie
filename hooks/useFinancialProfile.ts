import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  computeInitialProfile,
  detectIrregularIncome,
  evaluateAutoTransition,
  computeMonthlyMetrics,
  PROFILE_ALLOCATIONS,
  safetyMarginFromQ8,
  weeklyVariableFromQ9,
} from '../lib/financialProfileEngine';
import type {
  UserFinancialProfile,
  UserQuestionnaireAnswers,
  ProfileChangeLog,
  ProfileMatrixConfig,
  ProfileNotificationMessage,
  FinancialProfileId,
} from '../types/database';
import type { QuestionnaireAnswers } from '../lib/financialProfileEngine';

const PROFILE_KEY = 'financial_profile';
const QUESTIONNAIRE_KEY = 'questionnaire_answers';
const CHANGE_LOG_KEY = 'profile_change_log';
const MATRIX_KEY = 'profile_matrix_config';
const NOTIF_KEY = 'profile_notification_messages';

// ── Lecture du profil ─────────────────────────────────────────

export function useFinancialProfile(userId: string | undefined) {
  return useQuery({
    queryKey: [PROFILE_KEY, userId],
    queryFn: async (): Promise<UserFinancialProfile | null> => {
      if (!supabase || !userId) return null;
      // Session (token) confirmée avant lecture : sinon une lecture précoce post-connexion e-mail
      // part en « anonyme » → 0 ligne RLS sans erreur → l'app croit que le questionnaire n'est pas
      // fait. On lève pour que react-query réessaie jusqu'à ce que la session soit prête.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session non prête');
      const { data, error } = await supabase
        .from('user_financial_profile')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Lecture des réponses ──────────────────────────────────────

export function useQuestionnaireAnswers(userId: string | undefined) {
  return useQuery({
    queryKey: [QUESTIONNAIRE_KEY, userId],
    queryFn: async (): Promise<UserQuestionnaireAnswers | null> => {
      if (!supabase || !userId) return null;
      const { data, error } = await supabase
        .from('user_questionnaire_answers')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Notification en attente ───────────────────────────────────

export function usePendingProfileChange(userId: string | undefined) {
  return useQuery({
    queryKey: [CHANGE_LOG_KEY, 'pending', userId],
    queryFn: async (): Promise<ProfileChangeLog | null> => {
      if (!supabase || !userId) return null;
      const { data, error } = await supabase
        .from('profile_change_log')
        .select('*')
        .eq('user_id', userId)
        .eq('notification_shown', false)
        .order('triggered_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!userId,
  });
}

// ── Messages de notification (admin config) ───────────────────

export function useProfileNotificationMessages() {
  return useQuery({
    queryKey: [NOTIF_KEY],
    queryFn: async (): Promise<ProfileNotificationMessage[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('profile_notification_messages')
        .select('*');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });
}

// ── Matrice de configuration (admin) ─────────────────────────

export function useProfileMatrixConfig() {
  return useQuery({
    queryKey: [MATRIX_KEY],
    queryFn: async (): Promise<ProfileMatrixConfig[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('profile_matrix_config')
        .select('*');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 10,
  });
}

// ── Sauvegarde du questionnaire + attribution du profil ───────

export function useSaveQuestionnaire(userId: string | undefined) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async ({
      answers,
      isUpdate = false,
    }: {
      answers: QuestionnaireAnswers;
      isUpdate?: boolean;
    }) => {
      if (!supabase || !userId) throw new Error('Non connecté');

      const profileId = computeInitialProfile(answers);
      const isIrregular = detectIrregularIncome(answers.q1, answers.q2);
      const now = new Date().toISOString();
      const autoUnlockAt = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString();
      const alloc = PROFILE_ALLOCATIONS[profileId];

      // 1. Upsert des réponses
      const { error: qErr } = await supabase
        .from('user_questionnaire_answers')
        .upsert({
          user_id: userId,
          q1: answers.q1, q2: answers.q2, q3: answers.q3, q4: answers.q4,
          q5: answers.q5, q6: answers.q6, q7: answers.q7, q8: answers.q8 ?? '', q9: answers.q9 ?? '',
          answered_at: now, updated_at: now,
        }, { onConflict: 'user_id' });
      if (qErr) throw qErr;

      // 2. Récupérer l'éventuel profil existant
      const { data: existing } = await supabase
        .from('user_financial_profile')
        .select('profile_id')
        .eq('user_id', userId)
        .maybeSingle();

      // 3. Upsert du profil
      const { error: pErr } = await supabase
        .from('user_financial_profile')
        .upsert({
          user_id: userId,
          profile_id: profileId,
          profile_source: 'questionnaire',
          assigned_at: now,
          auto_unlock_at: autoUnlockAt,
          is_irregular_income: isIrregular,
          consecutive_upgrade_months: 0,
          consecutive_downgrade_months: 0,
          updated_at: now,
        }, { onConflict: 'user_id' });
      if (pErr) throw pErr;

      // 4. Journal — notification uniquement si update manuel et profil différent
      const previousProfileId = existing?.profile_id ?? null;
      const profileChanged = existing && existing.profile_id !== profileId;
      const notifShown = !isUpdate || !profileChanged; // pas de notif pour modif manuelle

      await supabase.from('profile_change_log').insert({
        user_id: userId,
        previous_profile: previousProfileId,
        new_profile: profileId,
        change_reason: 'questionnaire_update',
        triggered_at: now,
        notification_shown: notifShown,
      });

      // 5a. Mise à jour des allocations dans profiles (non-fatale)
      const { error: allocErr } = await supabase.from('profiles').update({
        allocation_save_percent: alloc.save,
        allocation_invest_percent: alloc.invest,
        allocation_enjoy_percent: alloc.enjoy,
        allocation_keep_percent: alloc.keep,
        updated_at: now,
      }).eq('id', userId);
      if (allocErr) {
        console.warn('[saveQuestionnaire] update allocations profiles échoué (non bloquant):', allocErr);
      }

      // 5b. Mise à jour de la marge de sécurité (non-fatale, migration 031 requise)
      const marginAmount = safetyMarginFromQ8(answers.q8 ?? '');
      const { error: marginErr } = await supabase.from('profiles').update({
        safety_margin_amount: marginAmount,
      }).eq('id', userId);
      if (marginErr) {
        console.warn('[saveQuestionnaire] update safety_margin_amount échoué (migration 031 requise ?):', marginErr);
      }

      // 5c. Mise à jour du budget variable hebdo (non-fatale, migration 035 requise)
      const weeklyVar = weeklyVariableFromQ9(answers.q9 ?? '');
      const { error: weeklyErr } = await supabase.from('profiles').update({
        weekly_variable_budget: weeklyVar > 0 ? weeklyVar : null,
      }).eq('id', userId);
      if (weeklyErr) {
        console.warn('[saveQuestionnaire] update weekly_variable_budget échoué (migration 035 requise ?):', weeklyErr);
      }

      return profileId;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROFILE_KEY, userId] });
      client.invalidateQueries({ queryKey: [QUESTIONNAIRE_KEY, userId] });
      client.invalidateQueries({ queryKey: ['profile', userId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', userId] });
    },
  });
}

// ── Marquer la notification comme vue ────────────────────────

export function useMarkNotificationShown(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changeLogId: string) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profile_change_log')
        .update({ notification_shown: true })
        .eq('id', changeLogId)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [CHANGE_LOG_KEY, 'pending', userId] });
    },
  });
}

// ── Évaluation automatique mensuelle ─────────────────────────

export function useAutoProfileEvaluation(userId: string | undefined) {
  const client = useQueryClient();
  const { isImpersonating } = useAuth();

  return useMutation({
    mutationFn: async () => {
      // En consultation admin : ne JAMAIS lancer l'évaluation mensuelle du compte cible.
      // Elle écrit un profile_change_log (bilan mensuel / transition) et avance
      // last_auto_evaluation → visiter un compte ne doit pas déclencher son bilan.
      if (isImpersonating) return;
      if (!supabase || !userId) return;

      // Charger le profil actuel
      const { data: fp } = await supabase
        .from('user_financial_profile')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!fp) return; // pas encore de profil

      // Vérifier le gel des 6 premiers mois
      const autoUnlockAt = fp.auto_unlock_at ? new Date(fp.auto_unlock_at) : null;
      if (autoUnlockAt && new Date() < autoUnlockAt) return;

      // Vérifier si déjà évalué ce mois-ci
      const today = new Date();
      const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      if (fp.last_auto_evaluation === currentMonthStr) return;

      // Charger la config de la matrice
      const { data: configs } = await supabase
        .from('profile_matrix_config')
        .select('*');

      const configMap: Record<string, any> = {};
      (configs ?? []).forEach((c: any) => { configMap[c.transition] = c; });

      // Charger les transactions des 6 derniers mois
      const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, 1).toISOString().slice(0, 10);
      const { data: txns } = await supabase
        .from('transactions')
        .select('amount, date, account_id, linked_account_id, is_draft')
        .eq('profile_id', userId)
        .eq('is_draft', false)
        .gte('date', sixMonthsAgo);

      // Charger les comptes pour connaître leur type
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, type, balance')
        .eq('profile_id', userId)
        .eq('is_active', true);

      const accountTypeMap: Record<string, string> = {};
      let savingsBalance = 0;
      let checkingBalance = 0;
      (accounts ?? []).forEach((a: any) => {
        accountTypeMap[a.id] = a.type;
        if (a.type === 'savings') savingsBalance += Number(a.balance);
        if (a.type === 'checking') checkingBalance += Number(a.balance);
      });

      const rawTxns = (txns ?? []).map((t: any) => ({
        amount: Number(t.amount),
        date: t.date,
        account_type: accountTypeMap[t.account_id] ?? 'other',
        linked_account_type: t.linked_account_id ? (accountTypeMap[t.linked_account_id] ?? null) : null,
      }));

      const metrics = computeMonthlyMetrics(rawTxns, savingsBalance, checkingBalance);
      const result = evaluateAutoTransition(
        fp.profile_id as FinancialProfileId,
        metrics,
        fp.consecutive_upgrade_months ?? 0,
        fp.consecutive_downgrade_months ?? 0,
        configMap,
        fp.is_irregular_income ?? false,
      );

      // Mettre à jour le profil avec les nouveaux compteurs
      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        consecutive_upgrade_months: result.consecutiveUpgrade,
        consecutive_downgrade_months: result.consecutiveDowngrade,
        last_auto_evaluation: currentMonthStr,
        updated_at: now,
      };

      if (result.changed) {
        updatePayload.profile_id = result.newProfileId;
        updatePayload.profile_source = 'automatic';
        updatePayload.assigned_at = now;

        // Log le changement avec notification
        await supabase.from('profile_change_log').insert({
          user_id: userId,
          previous_profile: fp.profile_id,
          new_profile: result.newProfileId,
          change_reason: result.reason,
          triggered_at: now,
          notification_shown: false,
        });

        // Mettre à jour les allocations
        const alloc = PROFILE_ALLOCATIONS[result.newProfileId];
        await supabase.from('profiles').update({
          allocation_save_percent: alloc.save,
          allocation_invest_percent: alloc.invest,
          allocation_enjoy_percent: alloc.enjoy,
          allocation_keep_percent: alloc.keep,
          updated_at: now,
        }).eq('id', userId);
      } else {
        // Pas de changement ce mois-ci → « bilan mensuel » : on informe quand même l'utilisateur
        // qu'il reste dans le même profil (uniquement après le gel, 1×/mois grâce aux gardes plus haut).
        await supabase.from('profile_change_log').insert({
          user_id: userId,
          previous_profile: fp.profile_id,
          new_profile: fp.profile_id,
          change_reason: 'monthly_recap',
          triggered_at: now,
          notification_shown: false,
        });
      }

      await supabase
        .from('user_financial_profile')
        .update(updatePayload)
        .eq('user_id', userId);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROFILE_KEY, userId] });
      client.invalidateQueries({ queryKey: [CHANGE_LOG_KEY, 'pending', userId] });
      client.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });
}

// ── Admin — simulation d'une transition (force le profil + déclenche la pop-up) ─────

/**
 * Bascule RÉELLEMENT le profil de l'utilisateur courant vers `target` et journalise la
 * transition avec `notification_shown=false` → la pop-up ProfileChangeModal s'affiche.
 * Sert à l'admin pour tester n'importe quel cas, sans respecter critères ni gel.
 */
export function useSimulateProfileChange(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      target,
      reason,
    }: {
      target: FinancialProfileId;
      reason: 'automatic_upgrade' | 'automatic_downgrade' | 'exceptional_revenue_drop' | 'monthly_recap';
    }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const now = new Date().toISOString();

      // Profil actuel → previous_profile
      const { data: fp } = await supabase
        .from('user_financial_profile')
        .select('profile_id')
        .eq('user_id', userId)
        .maybeSingle();
      const previous = fp?.profile_id ?? null;

      // Force le profil cible (profile_source borné à 'questionnaire'|'automatic' en base).
      const { error: pErr } = await supabase
        .from('user_financial_profile')
        .upsert({
          user_id: userId,
          profile_id: target,
          profile_source: 'automatic',
          assigned_at: now,
          updated_at: now,
        }, { onConflict: 'user_id' });
      if (pErr) throw pErr;

      // Aligne les allocations sur le nouveau profil (comme le vrai moteur).
      const alloc = PROFILE_ALLOCATIONS[target];
      await supabase.from('profiles').update({
        allocation_save_percent: alloc.save,
        allocation_invest_percent: alloc.invest,
        allocation_enjoy_percent: alloc.enjoy,
        allocation_keep_percent: alloc.keep,
        updated_at: now,
      }).eq('id', userId);

      // Journalise → déclenche la pop-up (non lue).
      const { error: lErr } = await supabase.from('profile_change_log').insert({
        user_id: userId,
        previous_profile: previous,
        new_profile: target,
        change_reason: reason,
        triggered_at: now,
        notification_shown: false,
      });
      if (lErr) throw lErr;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROFILE_KEY, userId] });
      client.invalidateQueries({ queryKey: [CHANGE_LOG_KEY, 'pending', userId] });
      client.invalidateQueries({ queryKey: ['profile', userId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', userId] });
    },
  });
}

// ── Admin — mise à jour des messages de notification ─────────

export function useUpdateNotificationMessage(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      transition,
      direction,
      title,
      body,
    }: {
      transition: string;
      direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same';
      title: string;
      body: string;
    }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profile_notification_messages')
        .upsert({
          transition, direction, title, body,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: 'transition,direction' });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [NOTIF_KEY] });
    },
  });
}

// ── Admin — mise à jour de la matrice ────────────────────────

export function useUpdateMatrixConfig(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<ProfileMatrixConfig> & { transition: string }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const { error } = await supabase
        .from('profile_matrix_config')
        .upsert({
          ...config,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        }, { onConflict: 'transition' });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [MATRIX_KEY] });
    },
  });
}
