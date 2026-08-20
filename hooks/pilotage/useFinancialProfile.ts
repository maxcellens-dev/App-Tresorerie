import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  computeInitialProfile,
  computeProfileFromData,
  resolveLiveProfile,
  detectIrregularIncome,
  computeMonthlyMetrics,
  PROFILE_ALLOCATIONS,
  safetyMarginFromQ8,
  weeklyVariableFromQ9,
} from '../../lib/finance/financialProfileEngine';
import { computeReferenceMonthlyIncome } from '../../lib/finance/incomeAverage';
import { isoDay } from '../../lib/dateUtils';
import type {
  UserFinancialProfile,
  UserQuestionnaireAnswers,
  ProfileChangeLog,
  ProfileMatrixConfig,
  ProfileNotificationMessage,
  FinancialProfileId,
  ChangeReason,
} from '../../types/database';
import type { QuestionnaireAnswers } from '../../lib/finance/financialProfileEngine';

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

/**
 * Le changement de profil NET, tel qu'il doit être annoncé — pas la liste des étapes.
 *
 * ⚠️ Plusieurs lignes peuvent être en attente en même temps : le profil vivant en journalise une à
 * CHAQUE saut (l'utilisateur ajoute son épargne → P1→P2, puis ses récurrences → P2→P3…), et le
 * bilan mensuel en ajoute encore une. En n'en lisant qu'une à la fois, le modal s'enchaînait : on
 * fermait « ton profil a changé », l'invalidation faisait remonter la ligne précédente, et un
 * deuxième — puis un troisième — modal s'ouvrait. L'utilisateur se voyait raconter, une fenêtre à
 * la fois, des transitions intermédiaires qu'il n'a jamais vécues à l'écran.
 *
 * On ne garde donc que le RÉSULTAT : profil d'arrivée = celui de la ligne la plus récente, profil de
 * départ = celui de la plus ancienne non lue (le dernier que l'utilisateur ait vu annoncé). Toutes
 * les lignes sont consommées d'un coup à la fermeture (`ids`).
 */
export interface PendingProfileChange {
  /** Toutes les lignes non lues à marquer « vues » d'un seul geste. */
  ids: string[];
  previous_profile: string | null;
  new_profile: string;
  change_reason: ChangeReason;
  triggered_at: string;
  /**
   * `false` = les changements se sont annulés entre eux (P3 → P4 → P3) : il n'y a rien à annoncer,
   * mais il faut quand même consommer les lignes, sinon elles ressortiraient au prochain lancement.
   */
  display: boolean;
}

export function usePendingProfileChange(userId: string | undefined) {
  return useQuery({
    queryKey: [CHANGE_LOG_KEY, 'pending', userId],
    queryFn: async (): Promise<PendingProfileChange | null> => {
      if (!supabase || !userId) return null;
      const { data, error } = await supabase
        .from('profile_change_log')
        .select('*')
        .eq('user_id', userId)
        .eq('notification_shown', false)
        .order('triggered_at', { ascending: false })
        // Garde-fou : au-delà, ce sont de toute façon de vieilles étapes intermédiaires.
        .limit(50);
      if (error) throw error;

      const rows = (data ?? []) as ProfileChangeLog[];
      if (rows.length === 0) return null;

      const latest = rows[0];                 // la plus récente = l'état actuel
      const oldest = rows[rows.length - 1];   // la plus ancienne = le dernier état connu de l'utilisateur
      const ids = rows.map(r => r.id);

      const newProfile = latest.new_profile;
      const previousProfile = oldest.previous_profile;
      const isNetChange = !!previousProfile && previousProfile !== newProfile;

      if (isNetChange) {
        // Motif : celui du dernier vrai changement (la ligne la plus récente peut être un simple
        // bilan « maintien » posé après coup — il ne doit pas masquer la transition réelle).
        const lastRealChange = rows.find(r => r.previous_profile !== r.new_profile) ?? latest;
        return {
          ids,
          previous_profile: previousProfile,
          new_profile: newProfile,
          change_reason: lastRealChange.change_reason,
          triggered_at: latest.triggered_at,
          display: true,
        };
      }

      // Aucun changement net. Le bilan mensuel, lui, reste dû : c'est un rendez-vous, pas la
      // conséquence d'un mouvement. Sinon : rien à dire, on consomme en silence.
      const recap = rows.find(r => r.change_reason === 'monthly_recap');
      return {
        ids,
        previous_profile: newProfile,
        new_profile: newProfile,
        change_reason: (recap?.change_reason ?? latest.change_reason) as ChangeReason,
        triggered_at: (recap ?? latest).triggered_at,
        display: !!recap,
      };
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
      live = false,
    }: {
      answers: QuestionnaireAnswers;
      isUpdate?: boolean;
      /**
       * Profil « vivant » : issu du nouveau démarrage, où q5 est MESURÉE (épargne ÷ dépenses) et où
       * q4/q6 arrivent plus tard. Il se recalcule à chaque changement de données réelles
       * (useLiveProfileSync) au lieu d'attendre le bilan mensuel, et n'est pas gelé.
       */
      live?: boolean;
    }) => {
      if (!supabase || !userId) throw new Error('Non connecté');

      const profileId = computeInitialProfile(answers);
      const isIrregular = detectIrregularIncome(answers.q1, answers.q2);
      const now = new Date().toISOString();
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
        .select('profile_id, auto_unlock_at')
        .eq('user_id', userId)
        .maybeSingle();

      // Gel initial = config admin `freeze_months` (défaut 2 mois — migration 144) : pendant ce
      // délai, aucun changement AUTOMATIQUE de profil, sauf cas exceptionnels (chute de revenus).
      // Le gel ne se pose qu'au TOUT PREMIER questionnaire : une mise à jour ultérieure (via
      // Paramètres → Profil financier) conserve la date d'origine — elle ne relance JAMAIS le gel.
      let autoUnlockAt: string | null;
      if (live) {
        // Profil vivant : AUCUN gel. Il doit pouvoir bouger dès que l'utilisateur complète son
        // installation (« j'ajoute mon épargne → mon profil suit dans la seconde »). Geler deux
        // mois un profil calculé sur des données encore partielles n'aurait aucun sens.
        autoUnlockAt = null;
      } else if (existing) {
        autoUnlockAt = (existing as any).auto_unlock_at ?? null;
      } else {
        const { data: freezeCfg } = await supabase
          .from('profile_matrix_config').select('freeze_months').limit(1).maybeSingle();
        const freezeMonths = Number((freezeCfg as any)?.freeze_months ?? 2);
        autoUnlockAt = new Date(Date.now() + freezeMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      // 3. Upsert du profil
      const { error: pErr } = await supabase
        .from('user_financial_profile')
        .upsert({
          user_id: userId,
          profile_id: profileId,
          // ⚠️ `profile_source` porte une contrainte CHECK ('questionnaire' | 'automatic') en base :
          // la phase « vivante » est donc marquée dans `profiles.onboarding_state.pp_live` (jsonb),
          // ce qui évite une migration pour un simple drapeau de parcours.
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

/**
 * Marque une OU PLUSIEURS lignes comme vues. Le pluriel est essentiel : le modal annonce le
 * changement net de plusieurs lignes à la fois, il doit donc toutes les consommer d'un coup —
 * sinon les étapes intermédiaires ressortent une à une à la fermeture (cf. usePendingProfileChange).
 */
export function useMarkNotificationShown(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (changeLogIds: string | string[]) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const ids = Array.isArray(changeLogIds) ? changeLogIds : [changeLogIds];
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('profile_change_log')
        .update({ notification_shown: true })
        .in('id', ids)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [CHANGE_LOG_KEY, 'pending', userId] });
    },
  });
}

// ── Métriques réelles (partagées : profil vivant + évaluation mensuelle) ─────

interface RealMetricsResult {
  metrics: ReturnType<typeof computeMonthlyMetrics>;
  savingsBalance: number;
  checkingBalance: number;
  investedBalance: number;
  /** Revenu de référence — LE MÊME que celui affiché partout (cf. lib/incomeAverage). */
  avgMonthlyIncome: number;
  q3: string | null;
}

/**
 * Charge les métriques RÉELLES du compte (soldes + 6 mois de transactions) et les passe au même
 * `computeMonthlyMetrics` que l'évaluation mensuelle. Une seule façon de mesurer, partagée par les
 * deux mécanismes — sinon le profil « vivant » et le bilan mensuel raconteraient deux histoires.
 */
async function loadRealMetrics(userId: string): Promise<RealMetricsResult | null> {
  if (!supabase) return null;
  const today = new Date();
  // Heure LOCALE (`isoDay`) : `toISOString` bascule en UTC et rendait le 31 du mois précédent pour
  // un 1er construit en local — la fenêtre de 6 mois démarrait un jour trop tôt.
  const sixMonthsAgo = isoDay(new Date(today.getFullYear(), today.getMonth() - 6, 1));

  const [{ data: answers }, { data: txns, error: txErr }, { data: accounts, error: accErr }, { data: prof }] = await Promise.all([
    supabase.from('user_questionnaire_answers').select('q3').eq('user_id', userId).maybeSingle(),
    supabase.from('transactions')
      // `note`, `is_reserved` et le TYPE de catégorie sont nécessaires au revenu de référence
      // partagé (une recette « régul » ou posée sur une catégorie de dépense n'en est pas une).
      .select('id, amount, date, account_id, linked_account_id, is_draft, is_reserved, note, is_recurring, recurrence_rule, recurrence_end_date, materialized_from, category:categories(type)')
      .eq('profile_id', userId).eq('is_draft', false).gte('date', sixMonthsAgo),
    supabase.from('accounts')
      .select('id, type, balance')
      .eq('profile_id', userId).eq('is_active', true).eq('is_joint', false),
    supabase.from('profiles').select('created_at').eq('id', userId).maybeSingle(),
  ]);

  /* ⚠️ ON NE CONCLUT PAS SUR UNE LECTURE EN ÉCHEC. Ces deux erreurs n'étaient pas lues : une
     lecture ratée rendait `undefined`, donc « aucune transaction », donc des revenus et des
     dépenses à zéro — et ces métriques SERVENT À ÉCRIRE le profil financier de l'utilisateur
     (cf. useAutoProfileEvaluation). Un incident réseau pouvait ainsi le faire rétrograder tout
     seul. `null` remonte à l'appelant, qui n'évalue rien du tout. */
  if (txErr || accErr) return null;

  const accountTypeMap: Record<string, string> = {};
  const checkingIds = new Set<string>();
  let savingsBalance = 0;
  let checkingBalance = 0;
  let investedBalance = 0;
  (accounts ?? []).forEach((a: any) => {
    accountTypeMap[a.id] = a.type;
    if (a.type === 'savings') savingsBalance += Number(a.balance);
    if (a.type === 'checking') { checkingBalance += Number(a.balance); checkingIds.add(a.id); }
    if (a.type === 'investment') investedBalance += Number(a.balance);
  });

  const rawTxns = (txns ?? []).map((t: any) => ({
    amount: Number(t.amount),
    date: t.date,
    account_type: accountTypeMap[t.account_id] ?? 'other',
    linked_account_type: t.linked_account_id ? (accountTypeMap[t.linked_account_id] ?? null) : null,
  }));

  const q3 = ((answers as any)?.q3 ?? null) as string | null;
  return {
    metrics: computeMonthlyMetrics(rawTxns, savingsBalance, checkingBalance, 6, 3, q3),
    savingsBalance,
    checkingBalance,
    investedBalance,
    // MÊME mesure que le Pilotage et la page « Profil financier ». Il y en avait deux, elles ne
    // s'accordaient pas, et c'est le profil qui en payait le prix (cf. lib/incomeAverage).
    avgMonthlyIncome: computeReferenceMonthlyIncome(
      (txns ?? []) as any[], checkingIds, isoDay(today),
      (prof as any)?.created_at ?? null,
    ),
    q3,
  };
}

// ── PROFIL VIVANT — recalculé sur les SEULES DONNÉES RÉELLES ─────────────────────────────────
//
// Le profil ne dépend plus d'aucune réponse déclarée : ni questionnaire d'accueil, ni « micro-
// questions ». Il se déduit de ce que l'utilisateur a saisi (épargne, revenu constaté, mis de côté,
// placements) — donc dès qu'il renseigne la dernière donnée manquante, son profil apparaît, et il
// reste P1 (le plus prudent) tant qu'il manque quelque chose.
//
// Il n'y a plus non plus de garde : le recalcul vaut pour tout le monde, puisqu'il ne contredit
// plus une réponse que l'utilisateur aurait donnée lui-même.
//
// ⚠️ Il y en avait encore une, et c'était le bug derrière « le profil ne se met plus à jour » :
// dès que le premier BILAN MENSUEL (useAutoProfileEvaluation) changeait le profil, il posait
// `profile_source: 'automatic'` — et ce recalcul s'arrêtait alors DÉFINITIVEMENT (`return null`
// avant même de lire les données), puisqu'il ne s'exécutait plus jamais que sur `'questionnaire'`.
// Un seul bilan mensuel suffisait à figer le profil pour toujours, pendant que les recos (qui
// lisent la même ligne mais ne passent pas par ce recalcul) continuaient de refléter sa dernière
// valeur — d'où l'impression de « deux profils différents ». Cette garde datait d'avant le profil
// vivant, où 'automatic' signifiait « le questionnaire a laissé la main » : ça n'a plus de sens
// depuis qu'il n'y a plus de questionnaire à laisser. Et le gel (`auto_unlock_at`) n'y était pour
// rien : le profil vivant est explicitement posé SANS gel dès sa création (cf. plus bas, `live`).

export function useLiveProfileSync(userId: string | undefined) {
  const client = useQueryClient();
  const { isImpersonating } = useAuth();

  return useMutation({
    mutationFn: async (): Promise<FinancialProfileId | null> => {
      if (isImpersonating) return null;          // consultation admin : jamais d'écriture
      if (!supabase || !userId) return null;

      const { data: fp } = await supabase
        .from('user_financial_profile')
        .select('profile_id')
        .eq('user_id', userId)
        .maybeSingle();
      // Ligne ABSENTE = compte qui n'a jamais eu de profil (le questionnaire, qui la créait, n'existe
      // plus). On la CRÉE au lieu d'abandonner : sans ça, aucun profil n'était jamais attribué et
      // l'écran restait vide indéfiniment.

      const real = await loadRealMetrics(userId);
      if (!real) return null;

      /* DÉPENSES ESSENTIELLES = la base du matelas (charges récurrentes + enveloppe variable).
         Elle n'était PAS transmise ici : le profil vivant continuait donc de mesurer le matelas en
         mois de REVENUS, à contre-courant du reste de l'app depuis que la définition a changé. Deux
         écrans annonçaient « 7 mois » et « 4 mois » pour la même personne.
         Lue dans le cache du Pilotage — même source, même chiffre, aucun aller-retour réseau. */
      const pilotage = client.getQueryData<any>(['pilotage_data', userId]);
      const essentials = Number(pilotage?.monthly_essential_expenses) || undefined;

      /* Le profil DÉCOULE des mesures — aucune réponse déclarée n'entre dans le calcul.
         Données incomplètes → P0 « Découverte » : on dit qu'on ne sait pas encore, au lieu de
         classer d'office en « épargne critique » quelqu'un qui vient d'arriver. */
      const inputs = {
        availableSavings: real.savingsBalance,
        monthlyEssentialExpenses: essentials,
        /* Le solde courant ne sert QU'EN APPOINT : un découvert ne devient un diagnostic que s'il
           n'y a plus rien pour le combler, ou si les charges dépassent le revenu (cf.
           `hasStructuralDeficit`). Un rouge passager avant la paie n'est pas une situation. */
        checkingBalance: real.checkingBalance,
        /* Patrimoine BANCAIRE (le seul que l'app connaisse) : il gouverne les paliers hauts, où le
           nombre de mois de réserve ne distingue plus rien. */
        totalLiquidWealth: real.checkingBalance + real.savingsBalance + real.investedBalance,
        // ⚠️ PAS `metrics.avg_income_6m` : celui-là divise par 6 des mois RÉVOLUS et renvoie donc 0
        // pour un compte neuf, dont la seule paie est dans le mois courant → « aucun revenu
        // constaté » → P1 à vie, alors que l'app affiche par ailleurs 2 000 € et 7,5 mois.
        avgMonthlyIncome: real.avgMonthlyIncome,
        // ⚠️ PAS `metrics.flux_total` : c'est un POURCENTAGE, et il était lu comme un montant en
        // euros — le taux d'épargne calculé derrière valait alors 1,5 % au lieu de 30 %.
        monthlySetAside: real.metrics.set_aside_monthly,
        totalInvested: real.investedBalance,
      };

      /* HYSTÉRÉSIS. Ce calcul tourne à chaque fois que les données bougent : sans marge, quelqu'un
         qui oscille autour de 6 mois de réserve verrait son profil basculer d'avant en arrière à
         chaque saisie — et recevrait une notification de changement à chacune. `resolveLiveProfile`
         exige que le seuil soit franchi FRANCHEMENT dans le sens du trajet. C'est ce qui permet
         d'évaluer en continu sans ralentir l'évaluation. */
      const current = (fp as any)?.profile_id as FinancialProfileId | undefined;
      const live = resolveLiveProfile(current ?? null, inputs);
      const next = live.profileId;

      if (!live.changed && fp) return next;

      const now = new Date().toISOString();
      const alloc = PROFILE_ALLOCATIONS[next as FinancialProfileId];
      await supabase.from('user_financial_profile').upsert({
        user_id: userId,
        profile_id: next,
        // Le profil n'est plus « gelé » : il suit les données en continu.
        auto_unlock_at: null,
        assigned_at: now,
        updated_at: now,
      }, { onConflict: 'user_id' });

      await supabase.from('profiles').update({
        allocation_save_percent: alloc.save,
        allocation_invest_percent: alloc.invest,
        allocation_enjoy_percent: alloc.enjoy,
        allocation_keep_percent: alloc.keep,
        updated_at: now,
      }).eq('id', userId);

      // Notification : l'utilisateur voit le modal de changement de profil dans la foulée de son
      // geste (« mon virement d'épargne vient de me faire passer en P4 »), et non un mois plus tard.
      // PREMIÈRE attribution → aucune notification : il n'y a pas de « changement » à annoncer, et
      // un modal « ton profil a changé » sur un compte qui vient d'en recevoir un serait absurde.
      if (fp) {
        await supabase.from('profile_change_log').insert({
          user_id: userId,
          previous_profile: (fp as any).profile_id,
          new_profile: next,
          change_reason: 'automatic_upgrade',
          triggered_at: now,
          notification_shown: false,
        });
      }

      return next;
    },
    onSuccess: (changedTo) => {
      if (!changedTo) return;
      client.invalidateQueries({ queryKey: [PROFILE_KEY, userId] });
      client.invalidateQueries({ queryKey: [QUESTIONNAIRE_KEY, userId] });
      client.invalidateQueries({ queryKey: [CHANGE_LOG_KEY, 'pending', userId] });
      client.invalidateQueries({ queryKey: ['profile', userId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', userId] });
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

      // Gel initial (freeze_months, défaut 2 mois — migration 144) : pendant ce délai, pas de
      // changement automatique NI de bilan mensuel… SAUF cas exceptionnels (chute de revenus) :
      // on évalue quand même, et seul un résultat 'exceptional_revenue_drop' est appliqué.
      const autoUnlockAt = fp.auto_unlock_at ? new Date(fp.auto_unlock_at) : null;
      const frozen = !!autoUnlockAt && new Date() < autoUnlockAt;

      const today = new Date();
      const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

      /* ── PROFIL VIVANT : ON N'ATTEND PLUS LE 1ᴱᴿ DU MOIS ────────────────────────────────────
         Ce garde-fou (`last_auto_evaluation === currentMonthStr`) ramenait l'évaluation à UNE FOIS
         PAR MOIS. Conséquence : quelqu'un qui renseigne son épargne le 3 gardait jusqu'au 1er
         suivant un profil calculé sans elle — un diagnostic dont l'app savait déjà qu'il était
         faux, et sur lequel elle continuait pourtant de fonder ses recommandations.
         Le profil décrit une SITUATION : quand la situation change, il change.

         Ce que la cadence mensuelle protégeait réellement, c'est le clignotement autour d'un
         seuil. C'est désormais le rôle de l'hystérésis (`resolveLiveProfile`), qui le traite là où
         le problème se pose — dans la décision — au lieu de ralentir toute l'évaluation.

         `last_auto_evaluation` n'est plus un verrou : il ne sert plus qu'à ne produire qu'UN SEUL
         bilan mensuel (le journal `profile_change_log`), qui, lui, reste un rendez-vous. */
      const alreadyReportedThisMonth = fp.last_auto_evaluation === currentMonthStr;

      // Charger la config de la matrice + la tranche de revenu déclarée (repli du matelas de sécurité
      // tant qu'aucune recette n'a encore été constatée — cf. lib/securityCushion).
      const [{ data: configs }, { data: answers }] = await Promise.all([
        supabase.from('profile_matrix_config').select('*'),
        supabase.from('user_questionnaire_answers').select('q3').eq('user_id', userId).maybeSingle(),
      ]);

      const configMap: Record<string, any> = {};
      (configs ?? []).forEach((c: any) => { configMap[c.transition] = c; });

      // Charger les transactions des 6 derniers mois (heure LOCALE : cf. `isoDay`).
      const sixMonthsAgo = isoDay(new Date(today.getFullYear(), today.getMonth() - 6, 1));
      const { data: txns, error: txErr } = await supabase
        .from('transactions')
        .select('amount, date, account_id, linked_account_id, is_draft')
        .eq('profile_id', userId)
        .eq('is_draft', false)
        .gte('date', sixMonthsAgo);

      // Charger les comptes pour connaître leur type
      const { data: accounts, error: accErr } = await supabase
        .from('accounts')
        .select('id, type, balance')
        .eq('profile_id', userId)
        .eq('is_active', true)
        .eq('is_joint', false); // comptes joints exclus des agrégats perso

      /* ⚠️ Une lecture en échec ne vaut PAS « rien à lire ». Sans ce contrôle, un incident réseau
         donnait des métriques à zéro — revenus nuls, épargne nulle — et cette évaluation ÉCRIT le
         profil : l'utilisateur pouvait être rétrogradé par une simple coupure. On n'évalue pas. */
      if (txErr || accErr) return;

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

      /* ── CETTE ÉVALUATION NE DÉCIDE PLUS DU PROFIL ──────────────────────────────────────────
         Deux moteurs écrivaient `profile_id` avec des règles DIFFÉRENTES : le profil vivant
         (`useLiveProfileSync`, à chaque changement de données, matelas en mois de dépenses) et
         celui-ci (une fois par mois, matrice `profile_matrix_config` et compteurs de mois
         consécutifs). Ils se contredisaient : le palier obtenu dépendait de qui avait écrit en
         dernier — et le profil pouvait donc changer tout seul, le 1er du mois, sans qu'aucune
         donnée n'ait bougé.

         UN SEUL décide désormais : le profil vivant. Il reste à celle-ci ce qu'elle sait faire de
         mieux et que l'autre ne fait pas — le RENDEZ-VOUS MENSUEL : une entrée de journal par mois,
         qui porte la notification. Elle ne touche plus ni au palier, ni aux allocations. */
      const metrics = computeMonthlyMetrics(rawTxns, savingsBalance, checkingBalance, 6, 3, (answers as any)?.q3 ?? null);
      void metrics; // conservé : le bilan mensuel s'en servira pour commenter l'évolution.

      // Pendant le gel initial, pas de bilan : il tomberait sur des données encore partielles.
      if (frozen) return;
      // Un seul bilan par mois — c'est un rendez-vous, pas un flux.
      if (alreadyReportedThisMonth) return;

      const now = new Date().toISOString();
      await supabase.from('profile_change_log').insert({
        user_id: userId,
        previous_profile: fp.profile_id,
        new_profile: fp.profile_id,
        change_reason: 'monthly_recap',
        triggered_at: now,
        notification_shown: false,
      });

      await supabase
        .from('user_financial_profile')
        .update({ last_auto_evaluation: currentMonthStr, updated_at: now })
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
