/**
 * Clôture mensuelle — détection des mois à clôturer et statut souple (confirmed/estimated).
 * Activable via l'admin (feature flag monthly_closure_enabled). Désactivé → aucun effet.
 *
 * Un mois passé IGNORÉ (non confirmé après un délai de grâce) est marqué `estimated` : il reste
 * proposé à la clôture, mais il est EXCLU des baselines (dérive, moyennes variables, σ) pour ne
 * pas polluer les mois suivants. Confirmer plus tard écrase le statut (upsert) → rétro-corrigeable.
 */
import { useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useProfile } from '../data/useProfile';
import { useTransactions } from '../data/useTransactions';
import { recomputeBalances } from '../data/useTransactions';
import { useFeatureFlags } from '../config/useFeatureFlags';

export interface MonthClosure { id: string; profile_id: string; month_key: string; surplus: number; closed_at: string; status?: 'confirmed' | 'estimated'; }

/**
 * Libellés des régularisations créées PAR la clôture (et par elle seule) — ceux qu'une réouverture
 * doit défaire. Ils sont écrits par components/MonthlyClosure : toute évolution de ces libellés
 * doit être répercutée ICI, sinon la réouverture laisserait des ajustements orphelins.
 * ⚠️ « Régularisation solde » n'en fait PAS partie : c'est la régul que l'utilisateur saisit
 * lui-même en mettant son solde à jour. Elle ne doit jamais être supprimée par une réouverture.
 */
export const CLOSURE_REGUL_NOTES = [
  'Régularisation (à jour)',
  'Régularisation clôture (mois)',
  'Régularisation clôture (mois courant)',
];

/**
 * Mois ROUVERTS pendant cette session — au niveau du MODULE, et pas dans un `useRef`.
 *
 * `useMonthlyClosure` est appelé par neuf écrans à la fois (Pilotage, Pouls, la modale de clôture,
 * l'écran Clôture, Succès, la gamification, la saisie…). Une mémoire portée par un `useRef` est
 * propre à CHAQUE instance : celle qui exécute la réouverture la remplit, les huit autres l'ignorent
 * — et continuent d'appliquer les automatismes qu'elle devait justement suspendre. C'est un fait de
 * session, pas un état de composant : il vit donc au module, comme la file d'interruptions.
 *
 * Ce que cette mémoire suspend, jusqu'au prochain démarrage :
 *   • le re-marquage automatique en `estimated` — sinon la ligne `month_closures` réapparaît dans la
 *     seconde et rouvrir semble n'avoir servi à rien ;
 *   • l'ouverture automatique de la modale de clôture — se voir réclamer la clôture du mois qu'on
 *     vient délibérément de rouvrir n'a aucun sens.
 */
const reopenedThisSession = new Set<string>();
export function wasReopenedThisSession(monthKey: string | null | undefined): boolean {
  return !!monthKey && reopenedThisSession.has(monthKey);
}

/** Clôture d'UN compte pour UN mois — partagée entre tous ceux qui voient le compte (migration 179). */
export interface AccountClosure { account_id: string; month_key: string; closed_by: string; balance: number | null; closed_at: string; }

/**
 * Comptes DÉJÀ clôturés, tous mois confondus, sur le périmètre visible de l'utilisateur.
 *
 * Sert au cas des comptes JOINTS : plusieurs personnes voient le même compte, et sans trace
 * partagée chacune le clôturerait de son côté — donc autant de régularisations empilées sur le même
 * compte que de participants. Une clôture par compte et par mois, quel que soit son auteur.
 */
export function useAccountClosures(userId: string | undefined) {
  return useQuery({
    queryKey: ['account_closures', userId],
    enabled: !!userId,
    queryFn: async (): Promise<AccountClosure[]> => {
      if (!supabase || !userId) return [];
      /* ⚠️ LA RLS N'EST PAS UN FILTRE DE LISTE. La policy de lecture s'appuie sur `acct_can_access`,
         qui contient une branche `is_app_admin()` : un `select('*')` nu renverrait les clôtures de
         TOUS les comptes de TOUS les utilisateurs chez un administrateur — et, en « connecté en tant
         que », le jeton reste celui de l'admin. On résout donc explicitement les comptes du profil
         VISITÉ, comme partout ailleurs (useAllTransactions, useAllAccounts). */
      const [ownRes, memRes] = await Promise.all([
        supabase.from('accounts').select('id').eq('profile_id', userId),
        supabase.from('account_members').select('account_id').eq('user_id', userId),
      ]);
      const ids = [...new Set([
        ...((ownRes.data ?? []) as any[]).map((a) => a.id),
        ...((memRes.data ?? []) as any[]).map((m) => m.account_id),
      ])];
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('account_closures').select('*').in('account_id', ids);
      /* Table ABSENTE (migration 179 pas déployée sur cette instance) → on se comporte comme avant :
         aucune trace de clôture par compte. C'est le seul cas où l'absence de réponse est une
         réponse.
         ⚠️ Toute AUTRE erreur remonte. Elle se lisait jusqu'ici « aucun compte n'est clôturé », et
         un compte joint déjà régularisé par un autre participant était donc reproposé : deux
         régularisations empilées sur le même compte, une par personne. Un échec de lecture ne doit
         jamais se traduire par une écriture en double. */
      if (error) {
        const missingTable = error.code === '42P01' || error.code === 'PGRST205'
          || /does not exist|schema cache/i.test(error.message ?? '');
        if (missingTable) return [];
        throw error;
      }
      return (data ?? []) as AccountClosure[];
    },
  });
}

/* Arithmétique des clés de mois : PURE, donc sortie dans lib/monthKeys (ce fichier-ci tire
   react-query et Supabase, ce qui la rendait intestable en Node). Réexportée pour ne casser
   aucun des chemins d'import existants.
 */
import { ym, addMonthKey, lastDayOfMonthKey, monthLabel } from '../../lib/finance/monthKeys';
export { ym, addMonthKey, lastDayOfMonthKey, monthLabel };

export function useMonthClosures(userId: string | undefined) {
  return useQuery({
    queryKey: ['month_closures', userId],
    queryFn: async (): Promise<MonthClosure[]> => {
      if (!supabase || !userId) return [];
      const { data, error } = await supabase.from('month_closures').select('*').eq('profile_id', userId).order('month_key', { ascending: true });
      if (error) throw error;
      return (data ?? []) as MonthClosure[];
    },
    enabled: !!userId,
  });
}

export function useMonthlyClosure(userId: string | undefined) {
  const qc = useQueryClient();
  const { data: flags } = useFeatureFlags();
  const enabled = Boolean(flags?.monthly_closure_enabled);
  const { data: profile } = useProfile(userId);
  const { data: transactions = [] } = useTransactions(userId);
  const { data: closures = [], isSuccess: closuresLoaded } = useMonthClosures(userId);

  // Verrou effectif : ignoré si la fonctionnalité Clôture est désactivée (tout reste éditable).
  // La valeur stockée (closure_lock_date) est conservée → réactiver la fonctionnalité re-fige.
  const rawLock: string | null = (profile as any)?.closure_lock_date ?? null;
  const lockDate: string | null = enabled ? rawLock : null;

  /**
   * Mois RÉELLEMENT clôturés — c'est-à-dire CONFIRMÉS par l'utilisateur.
   *
   * `closures` contient aussi les mois marqués `estimated` : ceux qu'on a auto-marqués faute de
   * réponse passé le délai de grâce. Un mois estimé n'est PAS clôturé — il reste proposé à la
   * clôture. Les quatre écrans qui lisent ces données refaisaient chacun ce filtre de leur côté ;
   * l'écran Clôture, lui, l'avait oublié, et affichait donc le même mois à la fois en « en attente »
   * et en « clôturé ». La définition vit ici, une seule fois.
   */
  const confirmedClosures = useMemo(
    () => closures.filter((c) => (c.status ?? 'confirmed') === 'confirmed'),
    [closures],
  );

  const pendingMonths = useMemo(() => {
    /* ⚠️ Tant que les clôtures ne sont pas CHARGÉES, on ne conclut rien. `closures = []` se lit
       « aucun mois n'a jamais été clôturé » et fait remonter tout l'historique comme en attente :
       les transactions arrivent souvent en premier (cache persisté), et la modale s'ouvrait une
       fraction de seconde au démarrage chez un utilisateur pourtant à jour, avant de se rétracter.
       `isSuccess` et jamais `isFetched` : ce dernier est vrai aussi quand la lecture a ÉCHOUÉ. */
    if (!enabled || !closuresLoaded || !transactions.length) return [];
    // Seuls les mois CONFIRMÉS sont réellement clos : un mois `estimated` reste proposé à la clôture
    // (le user peut toujours répondre plus tard) mais est déjà exclu des baselines.
    const confirmed = confirmedClosures;
    const closedSet = new Set(confirmed.map((c) => c.month_key));
    const cur = ym(new Date());
    const firstTx = (transactions as any[]).reduce((min, t) => (t.date < min ? t.date : min), (transactions as any[])[0].date) as string;
    const firstKey = firstTx.slice(0, 7);
    const lastClosed = confirmed.length ? confirmed[confirmed.length - 1].month_key : null;
    let start = lastClosed ? addMonthKey(lastClosed, 1) : firstKey;
    if (start < firstKey) start = firstKey;
    const res: string[] = [];
    let k = start;
    let guard = 0;
    while (k < cur && guard < 60) {
      if (!closedSet.has(k)) res.push(k);
      k = addMonthKey(k, 1);
      guard++;
    }
    return res; // du plus ancien au plus récent
  }, [enabled, closuresLoaded, transactions, confirmedClosures]);

  // ── Marquage AUTO `estimated` : un mois pendant ignoré au-delà du délai de grâce (8 jours dans
  // le mois suivant) est marqué estimated (jamais bloquant, silencieux, rétro-corrigeable). ──
  const estimatedRunFor = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !userId || !supabase || pendingMonths.length === 0) return;
    const now = new Date();
    const prevMonth = addMonthKey(ym(now), -1);
    const graceOver = now.getDate() >= 8;
    const alreadyMarked = new Set(closures.map((c) => c.month_key)); // confirmed OU estimated
    const toEstimate = pendingMonths.filter((mk) =>
      !alreadyMarked.has(mk) && !reopenedThisSession.has(mk)
      && (mk < prevMonth || (mk === prevMonth && graceOver)),
    );
    if (toEstimate.length === 0) return;
    const sig = `${userId}:${toEstimate.join(',')}`;
    if (estimatedRunFor.current === sig) return;
    estimatedRunFor.current = sig;
    (async () => {
      try {
        const rows = toEstimate.map((mk) => ({ profile_id: userId, month_key: mk, surplus: 0, status: 'estimated' }));
        await supabase!.from('month_closures').upsert(rows, { onConflict: 'profile_id,month_key', ignoreDuplicates: true });
        qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      } catch { estimatedRunFor.current = null; }
    })();
  }, [enabled, userId, pendingMonths, closures, qc]);

  const closeMonths = useMutation({
    mutationFn: async ({ monthKeys, surplus, status = 'confirmed' }: { monthKeys: string[]; surplus: number; status?: 'confirmed' | 'estimated' }) => {
      if (!supabase || !userId || !monthKeys.length) return;
      const rows = monthKeys.map((mk) => ({ profile_id: userId, month_key: mk, surplus: mk === monthKeys[monthKeys.length - 1] ? surplus : 0, status }));
      const { error } = await supabase.from('month_closures').upsert(rows, { onConflict: 'profile_id,month_key' });
      if (error) throw error;
      // AUCUN blocage (décision produit) : on ne pose plus de verrou dur — les mois restent modifiables,
      // le statut confirmed/estimated suffit à la fiabilité. On efface un éventuel verrou hérité.
      /* `last_closure_bilan` n'est PLUS écrit : la pop-up de félicitations qu'il alimentait est
         supprimée (cf. components/closure/MonthlyClosure). La colonne survit en base — un bundle
         plus ancien encore déployé continue de la lire, et la retirer ferait échouer TOUT ce
         `update`, donc la clôture avec. Le reliquat reste enregistré là où il sert vraiment :
         `month_closures.surplus` (repris dans l'export de données). */
      await supabase.from('profiles').update({ closure_lock_date: null }).eq('id', userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    },
  });

  /**
   * Mois RÉOUVRABLE = uniquement la clôture confirmée la PLUS RÉCENTE.
   *
   * Rouvrir un mois ancien alors qu'un mois postérieur reste clos produirait un trou incohérent :
   * les régularisations du mois rouvert disparaissent, mais celles des mois suivants — calculées
   * PAR RAPPORT à ce solde — restent en place et deviennent fausses. On dépile donc dans l'ordre.
   */
  const reopenableMonth = useMemo(() => {
    if (confirmedClosures.length === 0) return null;
    return confirmedClosures.reduce((a, b) => (a.month_key > b.month_key ? a : b)).month_key;
  }, [confirmedClosures]);

  const reopenMonth = useMutation({
    mutationFn: async (monthKey: string) => {
      if (!supabase || !userId) return;
      if (reopenableMonth && monthKey !== reopenableMonth) {
        throw new Error(`Rouvre d'abord ${monthLabel(reopenableMonth)} : on ne peut rouvrir que la dernière clôture.`);
      }
      /* ROUVRIR = DÉFAIRE. Les régularisations créées PAR la clôture n'ont plus lieu d'être : les
         laisser, c'est garder un ajustement de solde qui ne correspond plus à aucune vérification —
         et il serait recréé à la clôture suivante, en double. On ne touche QU'À CELLES-LÀ : les
         régularisations saisies à la main par l'utilisateur (« Régularisation solde ») restent.

         ⚠️ Cette suppression se faisait ici, en SQL généré côté client, sur le critère
         « pas de catégorie ET libellé dans cette liste ». Depuis la migration 175, une
         régularisation PORTE une catégorie : le filtre ne correspondait plus à rien, et rouvrir un
         mois ne défaisait plus RIEN — il retirait la ligne `month_closures` en laissant toutes les
         régularisations en place. D'où le symptôme « je rouvre un mois et il me propose des montants
         différents de ceux de la validation ».
         La règle vit désormais en base (`reopen_month_regularisations`, migration 179), sur une
         marque explicite posée par la clôture (`closure_month`), avec repli sur l'ancien critère
         pour les lignes écrites avant. Elle nettoie aussi les clôtures par compte (comptes joints).

         `p_profile` (migration 190) : la fonction se limitait au profil de `auth.uid()`. En
         « connecté en tant que », le jeton reste celui de l'administrateur — elle ne trouvait donc
         RIEN à supprimer chez la personne dépannée, et la réouverture repartait en annonçant un
         succès. On lui dit désormais sur quel profil travailler ; elle vérifie elle-même le droit. */
      const { error: rpcErr } = await supabase.rpc('reopen_month_regularisations', { p_month: monthKey, p_profile: userId });
      if (rpcErr) throw new Error(rpcErr.message);

      /* ON VÉRIFIE QUE ÇA A BIEN EFFACÉ. Toute cette histoire tient à une suppression qui ne
         supprimait rien sans que personne ne s'en aperçoive : le mois disparaissait de la liste, les
         régularisations restaient, et les soldes gardaient une correction qui ne correspondait plus
         à aucune vérification. Une réouverture qui laisse une ligne marquée derrière elle est un
         échec — on le dit, et on n'efface pas la clôture (l'état reste cohérent, réessayable). */
      const { data: leftovers, error: leftErr } = await supabase
        .from('transactions').select('id').eq('profile_id', userId).eq('closure_month', monthKey).limit(1);
      if (leftErr) throw new Error(leftErr.message);
      if (leftovers && leftovers.length > 0) {
        throw new Error("Les régularisations de ce mois n'ont pas pu être supprimées. Le mois reste donc clôturé : c'est plus sûr que de le rouvrir en laissant tes soldes corrigés par une vérification qui n'existe plus. Réessaie.");
      }

      const { error } = await supabase.from('month_closures').delete().eq('profile_id', userId).eq('month_key', monthKey);
      if (error) throw new Error(error.message);
      reopenedThisSession.add(monthKey);
      // Recalcule le verrou = dernier jour du mois clôturé le plus récent restant (sinon null).
      /* Les soldes ont bougé (régularisations supprimées) : on les RECALCULE depuis les faits, comme
         partout ailleurs — sinon les comptes garderaient la valeur qu'ils avaient avec les réguls.
         Comptes JOINTS compris : ils portent désormais eux aussi des régularisations de clôture. */
      const [{ data: accs }, { data: mem }] = await Promise.all([
        supabase.from('accounts').select('id').eq('profile_id', userId),
        supabase.from('account_members').select('account_id').eq('user_id', userId),
      ]);
      const ids = [...new Set([
        ...((accs ?? []) as any[]).map((a) => a.id),
        ...((mem ?? []) as any[]).map((m) => m.account_id),
      ])];
      await recomputeBalances(ids);

      const remaining = closures.filter((c) => c.month_key !== monthKey).map((c) => c.month_key);
      const newLock = remaining.length ? lastDayOfMonthKey(remaining.reduce((a, b) => (a > b ? a : b))) : null;
      /* `last_closure_bilan: null` reste écrit ici, alors que plus rien ne le lit : c'est ce qui
         purge la valeur héritée chez les utilisateurs déjà passés par une clôture, et qui coupe la
         pop-up sur un bundle plus ancien encore déployé. */
      await supabase.from('profiles').update({ closure_lock_date: newLock, last_closure_bilan: null }).eq('id', userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['month_closures', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
      // Les soldes bougent (régularisations supprimées) → tout ce qui en dépend doit se relire.
      qc.invalidateQueries({ queryKey: ['transactions', userId] });
      qc.invalidateQueries({ queryKey: ['accounts', userId] });
      qc.invalidateQueries({ queryKey: ['pilotage_data', userId] });
      qc.invalidateQueries({ queryKey: ['account_closures', userId] });
    },
  });

  return { enabled, pendingMonths, lockDate, closures, confirmedClosures, closeMonths, reopenMonth, reopenableMonth };
}
