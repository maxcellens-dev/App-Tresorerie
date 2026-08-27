import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  resolveLiveProfile,
  resolveProfileId,
  thresholdsFromMatrix,
  allocationsFromRows,
  FINANCIAL_PROFILE_IDS,
  PROFILE_ALLOCATIONS,
  PROFILE_LADDER_VERSION,
} from '../../lib/finance/financialProfileEngine';
import type {
  UserFinancialProfile,
  UserQuestionnaireAnswers,
  ProfileChangeLog,
  ProfileMatrixConfig,
  ProfileNotificationMessage,
  FinancialProfileId,
  ChangeReason,
} from '../../types/database';

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

// ── Répartitions par palier (réglage admin) ──────────────────

const ALLOCATIONS_KEY = 'profile_allocations';

/**
 * LA TABLE DE RÉPARTITION APPLIQUÉE : celle de l'administration, complétée par le code.
 *
 * Lue par tout le monde (le référentiel décide de ce qu'on recommande), écrite par les seuls
 * administrateurs. Une lecture en échec ou une table vide rendent les valeurs du code : le calcul
 * reste juste hors-ligne, et une erreur réseau ne peut pas redistribuer le Relyka de toute la base.
 */
export function useProfileAllocations() {
  return useQuery({
    queryKey: [ALLOCATIONS_KEY],
    queryFn: async () => {
      if (!supabase) return allocationsFromRows(null);
      const { data, error } = await supabase.from('profile_allocations').select('*');
      if (error) throw error;
      return allocationsFromRows(data as any[]);
    },
    staleTime: 1000 * 60 * 10,
    // Table absente (migration pas encore jouée) → on garde les valeurs du code, sans réessais.
    retry: false,
    placeholderData: allocationsFromRows(null),
  });
}

/** Écriture admin d'un palier. La somme à 100 est vérifiée en base ET avant l'envoi. */
export function useUpdateProfileAllocation(userId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (row: {
      profile_id: FinancialProfileId;
      save_percent: number; invest_percent: number; enjoy_percent: number; keep_percent: number;
    }) => {
      if (!supabase || !userId) throw new Error('Non connecté');
      const total = row.save_percent + row.invest_percent + row.enjoy_percent + row.keep_percent;
      /* Refus AVANT l'aller-retour : la contrainte en base rendrait une erreur Postgres brute, que
         l'administrateur n'a aucune raison d'avoir à décoder. */
      if (total !== 100) throw new Error(`La répartition doit faire 100 % (actuellement ${total} %).`);
      const { error } = await supabase.from('profile_allocations').upsert({
        ...row, updated_at: new Date().toISOString(), updated_by: userId,
      }, { onConflict: 'profile_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [ALLOCATIONS_KEY] });
      // Les montants recommandés en découlent directement : on relance le calcul des écrans.
      client.invalidateQueries({ queryKey: ['pilotage_data'] });
    },
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
 * ⚠️ LE DÉCOMPTE SE FAIT EN BASE (migration 211). Il se faisait côté client, sur au plus 5 000
 * lignes téléchargées : passé ce cap, l'administrateur lisait une répartition TRONQUÉE sans que
 * rien ne le signale — et calibrait des seuils dessus. La fonction rend dix lignes, quel que soit
 * le nombre d'inscrits, et aucune donnée personnelle ne transite.
 *
 * Le chemin historique reste en REPLI : une OTA arrive avant une migration, et l'écran doit
 * continuer de fonctionner entre les deux. Il porte alors sa limite, signalée par `truncated`.
 */
const DISTRIBUTION_CLIENT_LIMIT = 5000;

export function useProfileDistribution(enabled = true) {
  return useQuery({
    queryKey: ['profile_distribution'],
    queryFn: async (): Promise<{
      counts: Record<string, number>; total: number; pending: number; truncated: boolean;
    }> => {
      if (!supabase) return { counts: {}, total: 0, pending: 0, truncated: false };

      const agg = await supabase.rpc('admin_profile_distribution', {
        p_ladder_version: PROFILE_LADDER_VERSION,
      });
      if (!agg.error && Array.isArray(agg.data)) {
        const counts: Record<string, number> = {};
        let total = 0;
        let pending = 0;
        for (const row of agg.data as any[]) {
          const id = resolveProfileId(row.profile_id);
          const n = Number(row.users) || 0;
          counts[id] = (counts[id] ?? 0) + n;
          total += n;
          pending += Number(row.pending) || 0;
        }
        return { counts, total, pending, truncated: false };
      }

      /* Repli : fonction pas encore déployée. On compte côté client, mais on DIT que le décompte
         peut être incomplet — un total tronqué présenté comme exact est pire que pas de total. */
      const { data, error } = await supabase
        .from('user_financial_profile')
        .select('profile_id, ladder_version')
        .limit(DISTRIBUTION_CLIENT_LIMIT);
      if (error) throw error;
      const counts: Record<string, number> = {};
      let pending = 0;
      for (const row of (data ?? []) as any[]) {
        const id = resolveProfileId(row.profile_id);
        counts[id] = (counts[id] ?? 0) + 1;
        // Encore sur les anciennes règles : sera reclassé en silence à la prochaine ouverture.
        if (Number(row.ladder_version ?? 0) < PROFILE_LADDER_VERSION) pending++;
      }
      const total = (data ?? []).length;
      return { counts, total, pending, truncated: total >= DISTRIBUTION_CLIENT_LIMIT };
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
   la copie q9 pour tous les écrans. */

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

/**
 * Ce que le PILOTAGE mesure, et que le profil ne doit surtout pas recalculer de son côté.
 *
 * ⚠️ TOUTES LES MESURES VIENNENT DE LÀ, et c'est le correctif décisif de ce module.
 *
 * Le profil relisait ses propres comptes en base, avec `is_joint = false` et `profile_id = moi` —
 * un périmètre plus étroit que celui de TOUT le reste de l'app, qui compte les comptes partagés et
 * joints pondérés au % d'impact. Conséquence, visible sur une seule et même page « Profil
 * financier » : la ligne « Ton matelas de sécurité » annonçait « 4,2 mois » (épargne du tableau de
 * bord, compte joint compris) juste sous un palier « Premiers repères — moins d'un mois de dépenses
 * de côté » (classement calculé sans lui). Deux mesures du même matelas, contradictoires, à trois
 * lignes d'écart. Le revenu avait déjà été rapatrié ici pour exactement cette raison ; les SOLDES
 * suivent le même chemin.
 *
 * Ces valeurs sont passées EN ARGUMENT plutôt que lues dans le cache au moment du calcul : lues,
 * elles pouvaient être périmées (le Pilotage se recalcule après l'écriture d'une transaction) — le
 * profil s'écrivait alors sur l'état d'AVANT la saisie, et plus rien ne le rattrapait. C'est
 * exactement ce qui faisait qu'un loyer saisi ne changeait pas le profil.
 */
export interface LiveProfileMeasures {
  avgMonthlyIncome: number;
  monthlyEssentialExpenses: number | undefined;
  hasRecurringExpenses: boolean;
  /** Soldes du PÉRIMÈTRE, exactement ceux qu'affiche le tableau de bord. */
  savingsBalance: number;
  checkingBalance: number;
  investedBalance: number;
  /**
   * Mois RÉVOLUS consécutifs terminés dans le rouge. Mesuré par le moteur du Pilotage
   * (`consecutive_overdraft_months`) : il l'était ici aussi, sur une seconde lecture de six mois de
   * transactions à chaque synchronisation — deux fois le même calcul, deux fois le coût réseau, et
   * deux occasions de diverger.
   */
  consecutiveOverdraftMonths: number;
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
    /* ── UNE SYNCHRONISATION À LA FOIS ─────────────────────────────────────────────────────────
       Cette mutation LIT le profil courant, décide, puis écrit. Deux exécutions simultanées lisent
       donc le MÊME profil de départ, concluent la même chose, et journalisent deux fois la même
       transition — ce qui arrive pendant le démarrage, où plusieurs comptes sont créés coup sur
       coup et où chaque écriture relance l'observateur. Le journal alimente les statistiques
       d'administration : des doublons y comptent des transitions qui n'ont eu lieu qu'une fois.
       `scope` sérialise : la seconde attend la première, relit un profil à jour, et n'a plus rien
       à écrire. */
    scope: { id: `live-profile-sync:${userId ?? 'anon'}` },
    mutationFn: async (measures: LiveProfileMeasures): Promise<FinancialProfileId | null> => {
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

      /* MESURES DU PILOTAGE — revenu, dépenses essentielles, charges connues, SOLDES et découvert
         chronique. Elles arrivent EN ARGUMENT, fraîches (cf. `LiveProfileMeasures` et
         components/system/LiveProfileSync) : lues dans le cache au moment du calcul, elles
         pouvaient dater d'avant la saisie qui vient justement de déclencher ce recalcul. */
      const {
        avgMonthlyIncome, monthlyEssentialExpenses: essentials, hasRecurringExpenses,
        savingsBalance, checkingBalance, investedBalance, consecutiveOverdraftMonths,
      } = measures;

      /* SEUILS DE L'ÉCHELLE : lus dans `profile_matrix_config` (écran d'administration), jamais
         codés en dur. Une lecture en échec retombe champ par champ sur les valeurs de repli — le
         profil reste calculable hors-ligne, avec le comportement documenté. */
      const [{ data: matrix }, { data: allocRows }] = await Promise.all([
        supabase.from('profile_matrix_config').select('*'),
        /* Les POURCENTAGES du palier viennent eux aussi de l'administration (migration 207) : ils
           sont recopiés dans `profiles.allocation_*` juste en dessous, et ce miroir doit porter la
           valeur réglée, pas celle du code — sinon l'export de données et le contexte IA
           annonceraient une répartition que personne n'applique. */
        supabase.from('profile_allocations').select('*'),
      ]);
      const thresholds = thresholdsFromMatrix(matrix as any[]);
      const allocationTable = allocationsFromRows(allocRows as any[]);

      /* Le profil DÉCOULE des mesures — aucune réponse déclarée n'entre dans le calcul.
         Données incomplètes → P0 « Découverte » : on dit qu'on ne sait pas encore, au lieu de
         classer d'office en « épargne critique » quelqu'un qui vient d'arriver. */
      const inputs = {
        /* LE MÊME matelas que celui affiché sur la page « Profil financier », au centime près : il
           vient du Pilotage, comptes partagés et joints compris. Relu ici sur les seuls comptes
           personnels, il classait « sans filet » quelqu'un dont l'épargne est sur un compte joint —
           pendant que la ligne juste au-dessus lui annonçait plusieurs mois de réserve. */
        availableSavings: savingsBalance,
        monthlyEssentialExpenses: essentials,
        /* Le solde courant ne sert QU'EN APPOINT : un découvert ne devient un diagnostic que s'il
           n'y a plus rien pour le combler, ou si les charges dépassent le revenu (cf.
           `hasStructuralDeficit`). Un rouge passager avant la paie n'est pas une situation. */
        checkingBalance,
        // Ce qui transforme un découvert en DIAGNOSTIC : sa répétition, pas sa présence.
        consecutiveOverdraftMonths,
        /* LE MÊME revenu que le tableau de bord, au chiffre près — il vient de lui (cf.
           `LiveProfileMeasures`). Recalculé ici, il ignorait les comptes joints : un salaire versé
           sur un compte joint n'existait pas pour le classement, et l'utilisateur restait en
           « Découverte » en voyant son revenu affiché juste à côté. */
        avgMonthlyIncome,
        totalInvested: investedBalance,
        /* Décide du DÉNOMINATEUR du matelas, jamais du droit d'être classé : sans charge connue, on
           divise par le revenu (prudent) plutôt que par un total amputé du loyer. */
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
      const alloc = allocationTable[next as FinancialProfileId] ?? PROFILE_ALLOCATIONS[next as FinancialProfileId];
      await supabase.from('user_financial_profile').upsert({
        user_id: userId,
        profile_id: next,
        /* Qui a posé ce palier. La colonne n'était pas écrite : une ligne CRÉÉE ici prenait donc le
           défaut de la base, `'questionnaire'` — c'est-à-dire le nom d'un système qui n'existe plus,
           sur une ligne calculée à partir des seules données réelles. L'export de données et
           l'administration lisaient cette provenance. */
        profile_source: 'automatic',
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

      /* ── LE GEL INITIAL A ÉTÉ RETIRÉ D'ICI ──────────────────────────────────────────────────
         Il lisait `auto_unlock_at` pour suspendre le bilan mensuel pendant les deux premiers mois
         (`freeze_months`, migration 144). Ce verrou ne pouvait plus se fermer : le profil vivant
         pose explicitement `auto_unlock_at: null` à chaque écriture ET à la création de la ligne,
         et les dernières dates héritées du questionnaire ont expiré depuis longtemps (la 144 les a
         ramenées à assigned_at + 2 mois).
         Ce qu'il protégeait n'a plus d'objet non plus : il évitait qu'un profil issu de neuf
         réponses déclarées soit contredit trop vite par des données encore partielles. Il n'y a
         plus de réponse déclarée à protéger — et ce qui manque se DIT (fiabilité du profil) au lieu
         de suspendre le calcul. Un verrou qui ne se ferme jamais finit par être cru sur parole. */

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
  const { isImpersonating } = useAuth();
  return useMutation({
    mutationFn: async ({
      target,
      reason,
    }: {
      target: FinancialProfileId;
      reason: 'automatic_upgrade' | 'automatic_downgrade' | 'exceptional_revenue_drop' | 'monthly_recap';
    }) => {
      /* ── JAMAIS SUR LE COMPTE DE QUELQU'UN D'AUTRE ─────────────────────────────────────────────
         Cet écran prend `user.id`, c'est-à-dire — en consultation « connecté en tant que » — celui
         de l'utilisateur VISITÉ. Un administrateur en train de regarder un compte pouvait donc lui
         forcer un palier et lui envoyer une vraie notification de changement de profil, sur des
         données qui n'ont pas bougé. Les deux autres écritures du module posent déjà cette garde
         (profil vivant, bilan mensuel) ; celle-ci l'avait oubliée. */
      if (isImpersonating) {
        throw new Error("Tu es connecté en tant qu'un autre utilisateur : la simulation modifierait SON profil.");
      }
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
          /* Sans ce tampon, la ligne forcée passe pour « classée par une échelle périmée » : la
             synchronisation suivante la traite en RECLASSEMENT et la réécrit aussitôt, ce qui
             annule la simulation sous les yeux de l'administrateur. */
          ladder_version: PROFILE_LADDER_VERSION,
          updated_at: now,
        }, { onConflict: 'user_id' });
      if (pErr) throw pErr;

      /* Aligne les allocations sur le nouveau profil — avec la table de l'ADMINISTRATION, comme le
         vrai moteur (migration 207). Lire la table du CODE ici écrivait dans `profiles` des
         pourcentages que personne n'applique : l'export de données et le contexte envoyé aux
         conseils IA annonçaient alors une répartition inventée. */
      const { data: allocRows } = await supabase.from('profile_allocations').select('*');
      const alloc = allocationsFromRows(allocRows as any[])[target] ?? PROFILE_ALLOCATIONS[target];
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
