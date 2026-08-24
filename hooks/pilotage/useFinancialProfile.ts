import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  resolveLiveProfile,
  resolveProfileId,
  thresholdsFromMatrix,
  FINANCIAL_PROFILE_IDS,
  PROFILE_ALLOCATIONS,
  PROFILE_LADDER_VERSION,
} from '../../lib/finance/financialProfileEngine';
import { computeReferenceMonthlyIncome } from '../../lib/finance/incomeAverage';
import { isoDay } from '../../lib/dateUtils';
import { countConsecutiveOverdraftMonths } from '../../lib/finance/balanceAt';
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

/**
 * Rang d'un palier sur l'échelle — sert à journaliser le SENS RÉEL d'un changement.
 *
 * ⚠️ Ne pas se fier à `live.direction` pour un RECLASSEMENT : celui-ci repart d'un profil nul (la
 * bande d'hystérésis de l'ancienne échelle n'a plus de sens), et `direction` vaut alors `null`.
 * Comparer les deux rangs donne toujours la bonne réponse, quelle que soit l'origine du changement.
 */
const rankOfProfile = (id: string | null | undefined): number =>
  FINANCIAL_PROFILE_IDS.indexOf(resolveProfileId(id));

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

// ── Distribution des profils (admin) ─────────────────────────

/**
 * COMBIEN D'UTILISATEURS PAR PALIER — la seule façon de vérifier que les groupes sont homogènes.
 *
 * Une échelle qui range 70 % de la base dans le même palier ne segmente rien : elle donne le même
 * conseil à tout le monde en ayant l'air de personnaliser. Ce décompte est donc l'instrument de
 * calibrage — on ne recalibre pas des seuils qui pilotent des milliers de recommandations à l'aveugle.
 *
 * ⚠️ On ne lit QUE `profile_id` et `ladder_version` : aucune donnée personnelle ne transite, et la
 * requête reste légère même à grande échelle. Le décompte se fait côté client, faute de vue agrégée.
 */
export function useProfileDistribution(enabled = true) {
  return useQuery({
    queryKey: ['profile_distribution'],
    queryFn: async (): Promise<{ counts: Record<string, number>; total: number; pending: number }> => {
      if (!supabase) return { counts: {}, total: 0, pending: 0 };
      const { data, error } = await supabase
        .from('user_financial_profile')
        .select('profile_id, ladder_version')
        .limit(5000);
      if (error) throw error;
      const counts: Record<string, number> = {};
      let pending = 0;
      for (const row of (data ?? []) as any[]) {
        const id = resolveProfileId(row.profile_id);
        counts[id] = (counts[id] ?? 0) + 1;
        // Encore sur les anciennes règles : sera reclassé en silence à la prochaine ouverture.
        if (Number(row.ladder_version ?? 0) < PROFILE_LADDER_VERSION) pending++;
      }
      return { counts, total: (data ?? []).length, pending };
    },
    enabled,
    staleTime: 1000 * 60 * 5,
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

/* ── LE QUESTIONNAIRE D'ACCUEIL A ÉTÉ RETIRÉ D'ICI ───────────────────────────────────────────────
   `useSaveQuestionnaire` enregistrait neuf réponses déclarées, en tirait un profil
   (`computeInitialProfile`) et posait un GEL de deux mois pendant lequel rien ne pouvait bouger.
   Plus rien ne l'appelait depuis la refonte du démarrage — le profil se déduit des données réelles
   et n'est plus gelé. Ce n'était donc pas seulement du code mort : c'était un SECOND moteur de
   profil, avec ses propres règles, prêt à contredire la cascade au premier rebranchement.
   Ce que ce hook écrivait encore et qui compte vraiment — la marge de sécurité et le budget
   variable — passe par `useUpdateProfile` (hooks/data/useProfile), qui synchronise déjà les copies
   q8/q9 pour tous les écrans. */

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
  savingsBalance: number;
  checkingBalance: number;
  investedBalance: number;
  /** Au moins un compte d'épargne existe — porte d'entrée du classement (cf. ProfileDataInputs). */
  hasSavingsAccount: boolean;
  /** Revenu de référence — LE MÊME que celui affiché partout (cf. lib/incomeAverage). */
  avgMonthlyIncome: number;
  /** Mois RÉVOLUS consécutifs terminés dans le rouge (0 = aucun). ≥ seuil ⇒ découvert chronique. */
  consecutiveOverdraftMonths: number;
}

/**
 * Charge les données RÉELLES du compte (soldes + 6 mois de transactions) dont le classement a
 * besoin : épargne, placements, revenu de référence, découvert chronique.
 *
 * Elle calculait aussi le TAUX D'ÉPARGNE (une passe complète de transformation des transactions à
 * chaque recalcul). Il ne classe plus rien — il mesurait un mérite, et il valait 0 % pour qui
 * épargne autrement que par virement interne. La passe est partie avec lui.
 */
async function loadRealMetrics(userId: string): Promise<RealMetricsResult | null> {
  if (!supabase) return null;
  const today = new Date();
  // Heure LOCALE (`isoDay`) : `toISOString` bascule en UTC et rendait le 31 du mois précédent pour
  // un 1er construit en local — la fenêtre de 6 mois démarrait un jour trop tôt.
  const sixMonthsAgo = isoDay(new Date(today.getFullYear(), today.getMonth() - 6, 1));

  /* La tranche de revenu du questionnaire (q3) était lue ici : elle servait de dernier repli au
     matelas. Le classement ne s'appuie plus jamais dessus — sans revenu CONSTATÉ on reste en P0,
     donc un repli déclaratif ne peut plus rien décider. Une lecture de moins à chaque recalcul. */
  const [{ data: txns, error: txErr }, { data: accounts, error: accErr }, { data: prof }] = await Promise.all([
    supabase.from('transactions')
      // `note`, `is_reserved` et le TYPE de catégorie sont nécessaires au revenu de référence
      // partagé (une recette « régul » ou posée sur une catégorie de dépense n'en est pas une).
      /* `regul_target`, `regul_covered` et `created_at` : indispensables au modèle d'ANCRES
         (cf. lib/balanceAt). Sans eux, reconstituer un solde de fin de mois retombe sur une
         soustraction naïve qui ignore les régularisations — et le décompte des mois dans le rouge
         serait faux précisément chez ceux qui corrigent leurs soldes. */
      .select('id, amount, date, account_id, linked_account_id, is_draft, is_reserved, note, is_recurring, recurrence_rule, recurrence_end_date, materialized_from, regul_target, regul_covered, created_at, category:categories(type)')
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

  const checkingIds = new Set<string>();
  let savingsBalance = 0;
  let checkingBalance = 0;
  let investedBalance = 0;
  let hasSavingsAccount = false;
  (accounts ?? []).forEach((a: any) => {
    if (a.type === 'savings') { savingsBalance += Number(a.balance); hasSavingsAccount = true; }
    if (a.type === 'checking') { checkingBalance += Number(a.balance); checkingIds.add(a.id); }
    if (a.type === 'investment') investedBalance += Number(a.balance);
  });

  /* DÉCOUVERT CHRONIQUE — mesuré, enfin. Le moteur l'attendait (`consecutiveOverdraftMonths`) mais
     personne ne le calculait : « chroniquement déficitaire » se décidait donc sur le solde du jour.
     On compte les mois RÉVOLUS terminés dans le rouge, tous comptes courants confondus, via le
     modèle d'ancres (cf. lib/balanceAt) — pas une soustraction naïve qui ignorerait les
     régularisations. */
  const checkingAccounts = (accounts ?? [])
    .filter((a: any) => a.type === 'checking')
    .map((a: any) => ({ id: a.id, balance: Number(a.balance) }));
  const consecutiveOverdraftMonths = countConsecutiveOverdraftMonths(
    (txns ?? []) as any[], checkingAccounts, today,
  );

  return {
    savingsBalance,
    checkingBalance,
    investedBalance,
    hasSavingsAccount,
    consecutiveOverdraftMonths,
    // MÊME mesure que le Pilotage et la page « Profil financier ». Il y en avait deux, elles ne
    // s'accordaient pas, et c'est le profil qui en payait le prix (cf. lib/incomeAverage).
    avgMonthlyIncome: computeReferenceMonthlyIncome(
      (txns ?? []) as any[], checkingIds, isoDay(today),
      (prof as any)?.created_at ?? null,
    ),
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
        .select('profile_id, ladder_version')
        .eq('user_id', userId)
        .maybeSingle();
      // Ligne ABSENTE = compte qui n'a jamais eu de profil (le questionnaire, qui la créait, n'existe
      // plus). On la CRÉE au lieu d'abandonner : sans ça, aucun profil n'était jamais attribué et
      // l'écran restait vide indéfiniment.

      /* RECLASSEMENT APRÈS CHANGEMENT DE RÈGLES (cf. PROFILE_LADDER_VERSION).
         Modifier la cascade reclasse toute la base à la première ouverture. Sans ce garde-fou,
         chaque utilisateur recevrait une fenêtre « ton profil a changé » pour un changement qu'il
         n'a pas provoqué — des milliers de notifications le même jour, et la plus mauvaise façon
         d'annoncer une amélioration. On écrit le nouveau palier, on le journalise (les statistiques
         d'administration restent justes), mais la notification est marquée comme déjà vue. */
      const storedLadder = Number((fp as any)?.ladder_version ?? 0);
      const isReclassification = !!fp && storedLadder < PROFILE_LADDER_VERSION;

      const real = await loadRealMetrics(userId);
      if (!real) return null;

      /* DÉPENSES ESSENTIELLES = la base du matelas (charges récurrentes + enveloppe variable).
         Elle n'était PAS transmise ici : le profil vivant continuait donc de mesurer le matelas en
         mois de REVENUS, à contre-courant du reste de l'app depuis que la définition a changé. Deux
         écrans annonçaient « 7 mois » et « 4 mois » pour la même personne.
         Lue dans le cache du Pilotage — même source, même chiffre, aucun aller-retour réseau. */
      const pilotage = client.getQueryData<any>(['pilotage_data', userId]);
      const essentials = Number(pilotage?.monthly_essential_expenses) || undefined;
      /* Les CHARGES RÉCURRENTES sont-elles connues ? Sans elles, les « dépenses essentielles » se
         réduisent à l'enveloppe variable : quelqu'un avec 3 000 € de côté, 400 €/mois de courses et
         un loyer que l'app ignore obtient 7,5 mois de réserve — donc « Sécurité acquise ». Le
         matelas retombe alors sur le revenu, dénominateur prudent (cf. lib/securityCushion).
         ⚠️ On lit `has_recurring_expenses` (au moins UNE dépense récurrente saisie), pas le montant :
         celui-ci applique un périmètre strict qui écarte les virements, donc quelqu'un qui couvre ses
         charges par un virement vers un compte joint passait pour n'en avoir aucune. */
      const hasRecurringExpenses = !!pilotage?.has_recurring_expenses;

      /* SEUILS DE L'ÉCHELLE : lus dans `profile_matrix_config` (écran d'administration), jamais
         codés en dur. Une lecture en échec retombe champ par champ sur les valeurs de repli — le
         profil reste calculable hors-ligne, avec le comportement documenté. */
      const { data: matrix } = await supabase.from('profile_matrix_config').select('*');
      const thresholds = thresholdsFromMatrix(matrix as any[]);

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
        // Ce qui transforme un découvert en DIAGNOSTIC : sa répétition, pas sa présence.
        consecutiveOverdraftMonths: real.consecutiveOverdraftMonths,
        /* Patrimoine BANCAIRE (le seul que l'app connaisse) : il gouverne les paliers hauts, où le
           nombre de mois de réserve ne distingue plus rien. */
        totalLiquidWealth: real.checkingBalance + real.savingsBalance + real.investedBalance,
        // ⚠️ PAS `metrics.avg_income_6m` : celui-là divise par 6 des mois RÉVOLUS et renvoie donc 0
        // pour un compte neuf, dont la seule paie est dans le mois courant → « aucun revenu
        // constaté » → P1 à vie, alors que l'app affiche par ailleurs 2 000 € et 7,5 mois.
        avgMonthlyIncome: real.avgMonthlyIncome,
        totalInvested: real.investedBalance,
        /* Les deux PORTES D'ENTRÉE du classement : sans compte d'épargne ni charge récurrente, le
           matelas vaut mécaniquement zéro et on annoncerait « moins d'un mois devant toi » à
           quelqu'un dont on ne sait rien. C'est le cas de tout nouvel inscrit — un groupe entier,
           classé par un artefact. Le moteur répond P0 : on ne sait pas encore. */
        hasSavingsAccount: real.hasSavingsAccount,
        hasRecurringExpenses,
      };

      /* HYSTÉRÉSIS. Ce calcul tourne à chaque fois que les données bougent : sans marge, quelqu'un
         qui oscille autour de 6 mois de réserve verrait son profil basculer d'avant en arrière à
         chaque saisie — et recevrait une notification de changement à chacune. `resolveLiveProfile`
         exige que le seuil soit franchi FRANCHEMENT dans le sens du trajet. C'est ce qui permet
         d'évaluer en continu sans ralentir l'évaluation. */
      const current = (fp as any)?.profile_id as FinancialProfileId | undefined;
      /* Un RECLASSEMENT repart de zéro : on lit le palier que la nouvelle échelle donne, sans se
         laisser retenir par l'hystérésis d'un palier attribué par les règles PRÉCÉDENTES. La bande
         protège d'un clignotement entre deux mesures, pas d'un changement de définition. */
      const live = resolveLiveProfile(isReclassification ? null : (current ?? null), inputs, thresholds);
      const next = live.profileId;

      if (!live.changed && fp && !isReclassification) return next;
      // Reclassement qui ne change rien : on tamponne la version et on s'arrête là.
      if (isReclassification && next === current) {
        await supabase.from('user_financial_profile')
          .update({ ladder_version: PROFILE_LADDER_VERSION })
          .eq('user_id', userId);
        return next;
      }

      const now = new Date().toISOString();
      const alloc = PROFILE_ALLOCATIONS[next as FinancialProfileId];
      await supabase.from('user_financial_profile').upsert({
        user_id: userId,
        profile_id: next,
        // Le profil n'est plus « gelé » : il suit les données en continu.
        auto_unlock_at: null,
        assigned_at: now,
        ladder_version: PROFILE_LADDER_VERSION,
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
          /* Le SENS réel du changement. Il était écrit « automatic_upgrade » en dur : une BAISSE de
             profil était donc journalisée comme une hausse. La fenêtre affichée à l'utilisateur ne
             s'en apercevait pas (elle recalcule le sens depuis les deux paliers), mais tout ce qui
             lit le journal — statistiques d'administration, historique — comptait des hausses qui
             n'en étaient pas. */
          change_reason: rankOfProfile(next) < rankOfProfile((fp as any).profile_id)
            ? 'automatic_downgrade' : 'automatic_upgrade',
          triggered_at: now,
          /* Un RECLASSEMENT ne s'annonce pas : l'utilisateur n'a rien fait, et « ton profil a
             changé » lui ferait chercher ce qu'il a bien pu provoquer. La ligne est écrite (le
             journal reste complet) mais déjà marquée comme vue. */
          notification_shown: isReclassification,
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
    /* Évaluation déclenchée toute seule au montage du tableau de bord : l'utilisateur n'a rien
       demandé, un échec ne lui apprend rien. Opt-out du backstop global (lib/ui/writeErrors). */
    meta: { silentError: true },
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

      /* ── CETTE ÉVALUATION NE DÉCIDE PLUS DU PROFIL ──────────────────────────────────────────
         Deux moteurs écrivaient `profile_id` avec des règles DIFFÉRENTES : le profil vivant
         (`useLiveProfileSync`, à chaque changement de données) et celui-ci (une fois par mois,
         matrice et compteurs de mois consécutifs). Ils se contredisaient : le palier obtenu
         dépendait de qui avait écrit en dernier — et le profil pouvait changer tout seul le 1er du
         mois, sans qu'aucune donnée n'ait bougé.

         UN SEUL décide désormais : le profil vivant. Il ne reste ici que le RENDEZ-VOUS MENSUEL —
         une entrée de journal par mois, qui porte la notification.

         Elle lisait encore six mois de transactions, tous les comptes, la matrice et le
         questionnaire pour en tirer des métriques que plus personne n'utilisait : un aller-retour
         complet à chaque ouverture de l'app, pour rien. Poser un rendez-vous ne demande que la
         date. */

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
