/**
 * Relyka World — hooks de données (comptes partagés type Tricount).
 * Projets, participants, dépenses, répartition (shares), équilibres, invitations par ID.
 *
 * Intégration compte : si une dépense est « payée par moi » avec un compte choisi,
 * une VRAIE transaction (dépense) est créée sur ce compte ; « cash » → aucune transaction.
 */
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { useAddTransaction, useDeleteTransaction } from '../data/useTransactions';
import { useAuth } from '../../contexts/AuthContext';
import { todayISO } from '../../lib/dateUtils';

export interface RwProject {
  id: string; owner_id: string; name: string; emoji: string; description: string; currency: string; created_at: string;
  archived_at?: string | null;
}
export interface RwParticipant {
  id: string; project_id: string; user_id: string | null; display_name: string; created_at: string; pending?: boolean;
}
export interface RwExpense {
  id: string; project_id: string; title: string; emoji: string | null; amount: number; currency: string;
  date: string; paid_by: string; created_by: string | null; account_id: string | null; transaction_id: string | null; created_at: string;
}
export interface RwShare { id: string; expense_id: string; project_id: string; participant_id: string; amount: number; }
/**
 * Une ligne de la répartition du PAIEMENT d'une dépense sur un compte (migration 178).
 * À ne pas confondre avec `RwShare` : celui-ci répartit la DETTE entre participants, celle-là
 * répartit l'argent RÉELLEMENT SORTI entre les comptes du payeur.
 */
export interface RwExpenseAccount {
  id: string; expense_id: string; project_id: string; account_id: string;
  transaction_id: string | null; amount: number; created_by: string | null;
}
/** Ce que l'écran de saisie renvoie : un compte, un montant. `account_id` null = cash. */
export interface RwAccountSplit { account_id: string; amount: number }
/**
 * Qui a AVANCÉ l'argent, et combien (migration 184). À ne pas confondre avec `RwShare` (qui DOIT
 * quoi) ni avec `RwExpenseAccount` (depuis quel compte de MES comptes l'argent est sorti).
 * Une dépense peut être réglée à plusieurs : 60 € par l'un, 40 € par l'autre.
 */
export interface RwPayer {
  id: string; expense_id: string; project_id: string; participant_id: string; amount: number;
}
export interface RwInvitation {
  id: string; project_id: string; project_name: string; project_emoji: string | null; from_name: string; created_at: string;
}

const ok = () => !!supabase;

/**
 * Liste des projets dont l'utilisateur est membre (propriétaire ou participant inscrit).
 *
 * Le périmètre est TOUJOURS ciblé explicitement, jamais délégué à la RLS :
 *  • un ADMIN dispose d'une policy SELECT « admin_read » (migration 080) sur rw_projects → un
 *    `select('*')` nu lui renverrait les projets partagés de TOUS les utilisateurs ;
 *  • en « connecté en tant que », le token reste celui de l'admin (auth.uid() = admin) → la RLS
 *    membre filtrerait sur l'admin, pas sur l'identité visitée.
 * Ce filtre reproduit exactement `rw_can_access()` : owner_id = user OU ligne rw_participants avec
 * user_id = user (un invité en attente ou ayant refusé a user_id NULL → hors périmètre, comme côté
 * serveur). La RLS reste le garde-fou ; elle n'est simplement plus utilisée comme filtre de liste.
 */
export function useRwProjects(userId: string | undefined) {
  const { isImpersonating } = useAuth();
  return useQuery({
    queryKey: ['rw_projects', userId, isImpersonating],
    enabled: !!userId && ok(),
    /* La page Projets affichait ses projets PERSO d'emblée (cache du Pilotage) puis attendait la
       partie partagée : deux moitiés de la même page qui n'arrivaient pas ensemble. Deux causes,
       corrigées ensemble — trois allers-retours EN SÉRIE (mes projets, mes participations, puis les
       lignes) ramenés à UN SEUL via `rw_my_projects` (migration 178), et une minute de fraîcheur
       pour absorber les allers-retours entre onglets. Le gain décisif vient d'ailleurs : la requête
       est préchauffée dès le démarrage (DataPrefetcher) et PERSISTÉE (lib/queryPersist), donc la
       liste est déjà là au premier pixel — le réseau ne fait plus que confirmer. */
    staleTime: 60_000,
    queryFn: async (): Promise<RwProject[]> => {
      /* En « connecté en tant que », le jeton reste celui de l'ADMIN : la RPC (qui s'appuie sur
         auth.uid()) rendrait SES projets, pas ceux du compte visité. On garde donc le chemin
         explicite dans ce cas — c'est exactement la raison d'être du filtre ci-dessous. */
      if (!isImpersonating) {
        const { data, error } = await supabase!.rpc('rw_my_projects');
        if (error) throw error;
        return (data ?? []) as RwProject[];
      }
      const [{ data: owned, error: e1 }, { data: parts, error: e2 }] = await Promise.all([
        supabase!.from('rw_projects').select('id').eq('owner_id', userId),
        supabase!.from('rw_participants').select('project_id').eq('user_id', userId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const ids = Array.from(new Set([
        ...((owned ?? []) as any[]).map((o) => o.id),
        ...((parts ?? []) as any[]).map((p) => p.project_id),
      ]));
      if (ids.length === 0) return [];
      const { data, error } = await supabase!.from('rw_projects').select('*').in('id', ids).order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RwProject[];
    },
  });
}

/** Un projet + ses participants. */
export function useRwProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['rw_project', projectId],
    enabled: !!projectId && ok(),
    queryFn: async (): Promise<{ project: RwProject | null; participants: RwParticipant[] }> => {
      const [{ data: proj, error: e1 }, { data: parts, error: e2 }] = await Promise.all([
        supabase!.from('rw_projects').select('*').eq('id', projectId).maybeSingle(),
        supabase!.from('rw_participants').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { project: (proj ?? null) as RwProject | null, participants: (parts ?? []) as RwParticipant[] };
    },
  });
}

/**
 * Dépenses + répartitions d'un projet + répartition des paiements par compte.
 *
 * ORDRE : date de l'ÉVÉNEMENT décroissante, puis instant de SAISIE décroissant. La liste sortait
 * jusqu'ici dans l'ordre que PostgreSQL voulait bien lui donner à date égale — c'est-à-dire, en
 * pratique, un ordre qui ressemblait à l'alphabet des libellés. Deux dépenses du même jour
 * apparaissaient donc dans un ordre sans rapport avec celui où on les avait saisies.
 */
export function useRwExpenses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['rw_expenses', projectId],
    enabled: !!projectId && ok(),
    queryFn: async (): Promise<{ expenses: RwExpense[]; shares: RwShare[]; accounts: RwExpenseAccount[]; payers: RwPayer[] }> => {
      const [
        { data: expenses, error: e1 }, { data: shares, error: e2 },
        { data: accs, error: e3 }, { data: pays, error: e4 },
      ] = await Promise.all([
        supabase!.from('rw_expenses').select('*').eq('project_id', projectId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase!.from('rw_expense_shares').select('*').eq('project_id', projectId),
        supabase!.from('rw_expense_accounts').select('*').eq('project_id', projectId),
        supabase!.from('rw_expense_payers').select('*').eq('project_id', projectId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      /* Les deux dernières tables datent des migrations 178 et 184 : tant qu'elles ne sont pas
         déployées, on retombe sur les colonnes historiques (compte unique, payeur unique) plutôt
         que d'échouer — l'écran reste utilisable pendant le déploiement. */
      return {
        expenses: (expenses ?? []).map((e: any) => ({ ...e, amount: Number(e.amount) })) as RwExpense[],
        shares: (shares ?? []).map((s: any) => ({ ...s, amount: Number(s.amount) })) as RwShare[],
        accounts: e3 ? [] : ((accs ?? []).map((a: any) => ({ ...a, amount: Number(a.amount) })) as RwExpenseAccount[]),
        payers: e4 ? [] : ((pays ?? []).map((p: any) => ({ ...p, amount: Number(p.amount) })) as RwPayer[]),
      };
    },
  });
}

/**
 * Découpe `total` en `count` parts égales au centime près, l'arrondi tombant sur la PREMIÈRE part.
 * Extrait de l'écran de saisie : il sert maintenant à deux choses — proposer le partage égal, et
 * reconnaître à la relecture qu'une répartition enregistrée était bien égale (sans quoi rouvrir une
 * dépense finement répartie l'aurait aplatie au premier enregistrement).
 */
export function splitEvenly(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((total / count) * 100) / 100;
  const parts = Array.from({ length: count }, () => base);
  parts[0] = Math.round((base + (total - base * count)) * 100) / 100;
  return parts;
}

/**
 * Ce que chaque participant a AVANCÉ sur une dépense.
 *
 * Depuis la migration 184 une dépense peut avoir plusieurs payeurs (60 € par l'un, 40 € par
 * l'autre). Les lignes de `rw_expense_payers` font foi quand elles existent ; sinon on retombe sur
 * la colonne historique `paid_by`, qui porte alors la totalité. Les deux chemins cohabitent le
 * temps du déploiement, et l'historique n'a rien à rattraper.
 */
export function paidByParticipant(expense: RwExpense, payers: RwPayer[]): Array<{ participant_id: string; amount: number }> {
  const own = payers.filter((p) => p.expense_id === expense.id && p.amount > 0);
  return own.length
    ? own.map((p) => ({ participant_id: p.participant_id, amount: p.amount }))
    : [{ participant_id: expense.paid_by, amount: expense.amount }];
}

/** Solde net par participant : positif = on lui doit, négatif = il doit. */
export function computeBalances(
  participants: RwParticipant[],
  expenses: RwExpense[],
  shares: RwShare[],
  payers: RwPayer[] = [],
): Map<string, number> {
  const net = new Map<string, number>();
  participants.forEach((p) => net.set(p.id, 0));
  for (const e of expenses) {
    for (const p of paidByParticipant(e, payers)) {
      net.set(p.participant_id, (net.get(p.participant_id) ?? 0) + p.amount);
    }
  }
  for (const s of shares) net.set(s.participant_id, (net.get(s.participant_id) ?? 0) - s.amount);
  return net;
}

/** Suggestions de remboursement « qui paie qui » (algorithme glouton). */
export function settleUp(balances: { id: string; amount: number }[]): { from: string; to: string; amount: number }[] {
  const debtors = balances.filter((b) => b.amount < -0.005).map((b) => ({ ...b })).sort((a, b) => a.amount - b.amount);
  const creditors = balances.filter((b) => b.amount > 0.005).map((b) => ({ ...b })).sort((a, b) => b.amount - a.amount);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(-debtors[i].amount, creditors[j].amount);
    if (pay > 0.005) out.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(pay * 100) / 100 });
    debtors[i].amount += pay; creditors[j].amount -= pay;
    if (Math.abs(debtors[i].amount) < 0.005) i++;
    if (Math.abs(creditors[j].amount) < 0.005) j++;
  }
  return out;
}

/** Crée un projet et ajoute le créateur comme participant. */
export function useCreateRwProject(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; emoji: string; description: string; myName: string }): Promise<RwProject> => {
      if (!supabase) throw new Error('Backend indisponible');
      // Création via RPC SECURITY DEFINER (owner_id = auth.uid() côté serveur, ajoute le créateur
      // en participant) → robuste face aux policies d'INSERT / RETURNING.
      const { data: pid, error } = await supabase.rpc('rw_create_project', {
        p_name: input.name, p_emoji: input.emoji, p_desc: input.description, p_myname: input.myName,
      });
      if (error) throw new Error(error.message);
      return { id: pid } as RwProject;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_projects'] }),
  });
}

export function useUpdateRwProject(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { name?: string; description?: string; emoji?: string }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_projects').update(patch).eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_project', projectId] }); qc.invalidateQueries({ queryKey: ['rw_projects'] }); },
  });
}

export function useDeleteRwProject(userId: string | undefined) {
  const qc = useQueryClient();
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      // Nettoyage de MES propres transactions réelles liées (RLS : on ne touche que les nôtres,
      // created_by = moi ; chaque participant garde les siennes). Règle :
      //   • Transaction PASSÉE (date ≤ aujourd'hui = a impacté le compte) → CONSERVÉE : elle devient
      //     une simple dépense/recette normale (le lien projet disparaît avec rw_expenses en cascade).
      //   • Transaction NON passée (future) → supprimée (réversion du solde via useDeleteTransaction).
      const today = todayISO();
      const { data: myExpenses } = await supabase
        .from('rw_expenses')
        .select('id, transaction_id, date')
        .eq('project_id', projectId)
        .eq('created_by', userId);
      const futureIds = ((myExpenses ?? []) as Array<{ id: string; transaction_id: string | null; date: string }>)
        .filter((e) => e.date > today);
      // Répartition multi-comptes (migration 178) : une dépense future peut porter PLUSIEURS
      // transactions. Ne retirer que `transaction_id` en laisserait sur les autres comptes.
      const { data: splits } = futureIds.length
        ? await supabase.from('rw_expense_accounts').select('transaction_id, created_by, expense_id')
            .in('expense_id', futureIds.map((e) => e.id))
        : { data: [] as any[] };
      const toDelete = new Set<string>();
      for (const e of futureIds) if (e.transaction_id) toDelete.add(e.transaction_id);
      for (const s of ((splits ?? []) as Array<{ transaction_id: string | null; created_by: string | null }>)) {
        if (s.transaction_id && s.created_by === userId) toDelete.add(s.transaction_id);
      }
      for (const txId of toDelete) {
        try { await delTx.mutateAsync(txId); } catch { /* déjà supprimée */ }
      }
      const { error } = await supabase.from('rw_projects').delete().eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_projects'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['rw_linked_tx_ids', userId] });
    },
  });
}

/**
 * Set des `transaction_id` de MES transactions réelles liées à une dépense Relyka World.
 * Sert à afficher la pastille « projet » dans la liste des transactions (les transactions RW
 * ne portent pas de project_id — le lien est via rw_expenses.transaction_id).
 */
export function useRwLinkedTransactionIds(userId: string | undefined) {
  return useQuery({
    queryKey: ['rw_linked_tx_ids', userId],
    queryFn: async (): Promise<Set<string>> => {
      if (!supabase || !userId) return new Set();
      // Deux sources : la colonne historique (une dépense = un compte) ET la répartition
      // multi-comptes (migration 178). Sans la seconde, une dépense payée depuis deux comptes
      // n'aurait été reconnue comme « de projet » que sur l'un des deux.
      const [{ data: legacy }, { data: split }] = await Promise.all([
        supabase.from('rw_expenses').select('transaction_id').eq('created_by', userId).not('transaction_id', 'is', null),
        supabase.from('rw_expense_accounts').select('transaction_id').eq('created_by', userId).not('transaction_id', 'is', null),
      ]);
      const ids = [
        ...((legacy ?? []) as Array<{ transaction_id: string | null }>).map((e) => e.transaction_id),
        ...((split ?? []) as Array<{ transaction_id: string | null }>).map((e) => e.transaction_id),
      ].filter(Boolean) as string[];
      return new Set(ids);
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/** Archive / désarchive un projet partagé (réservé au propriétaire via RLS). */
export function useSetRwProjectArchived(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; archived: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase
        .from('rw_projects')
        .update({ archived_at: input.archived ? new Date().toISOString() : null })
        .eq('id', input.projectId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['rw_projects'] });
      qc.invalidateQueries({ queryKey: ['rw_project', v.projectId] });
    },
  });
}

/** Ajoute un participant « simple nom » (non inscrit). */
export function useAddRwParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_participants').insert({ project_id: projectId, user_id: null, display_name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

/** Renomme un participant (utile surtout pour les participants non inscrits). */
export function useUpdateRwParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { participantId: string; name: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('rw_participants').update({ display_name: input.name.trim() }).eq('id', input.participantId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_project', projectId] }); qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); },
  });
}

/** Ré-invite un participant non inscrit EXISTANT par son ID public (RPC sécurisée). S'il accepte,
 *  il reprend la place du participant partout où il était affecté (parts/dépenses inchangées). */
export function useRwReinviteParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { participantId: string; code: string }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('rw_reinvite_participant', { p_project: projectId, p_participant: input.participantId, p_code: input.code });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

/**
 * RETIRER un participant (inscrit ou non), avec REPRISE de ce qu'il laisse derrière lui.
 *
 * ⚠️ La suppression directe de la ligne — ce que faisait cette fonction — est un piège : dans le
 * schéma, `rw_expenses.paid_by` référence le participant en ON DELETE CASCADE. Retirer quelqu'un
 * effaçait donc TOUTES les dépenses qu'il avait avancées, pour tout le monde, sans le moindre
 * avertissement, et les équilibres du projet devenaient faux.
 *
 * Le retrait passe donc par la RPC `rw_remove_participant` (migration 178) : elle exige un
 * `reassignTo` dès qu'il reste une dépense ou une part au nom du partant, et transfère le tout au
 * repreneur (parts fusionnées si les deux figuraient déjà sur la même dépense). Rien ne disparaît.
 */
export function useRemoveRwParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | { participantId: string; reassignTo?: string | null }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const participantId = typeof input === 'string' ? input : input.participantId;
      const reassignTo = typeof input === 'string' ? null : (input.reassignTo ?? null);
      const { error } = await supabase.rpc('rw_remove_participant', {
        p_participant: participantId, p_reassign: reassignTo,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_project', projectId] });
      qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] });
      qc.invalidateQueries({ queryKey: ['rw_projects'] });
    },
  });
}

/** Annule une invitation ENVOYÉE et pas encore acceptée (la personne reste dans le projet en tant
 *  que participant non inscrit — c'est seulement le rattachement à un compte qui est annulé). */
export function useRwCancelInvitation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (participantId: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('rw_cancel_invitation', { p_participant: participantId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

/** Combien de dépenses / de parts un participant laisserait-il derrière lui ? (0 → retrait direct) */
export function countParticipantRefs(
  participantId: string,
  expenses: RwExpense[],
  shares: RwShare[],
  payers: RwPayer[] = [],
): number {
  const paid = expenses.filter((e) =>
    paidByParticipant(e, payers).some((p) => p.participant_id === participantId)).length;
  return paid + shares.filter((s) => s.participant_id === participantId).length;
}

/**
 * Combien de ses dépenses ont été réglées depuis le compte bancaire de QUELQU'UN D'AUTRE ?
 *
 * Ces dépenses-là ont une transaction en face, dans le Relyka de son auteur : elle porte son solde,
 * son budget du mois, ses recommandations. Les réattribuer ferait diverger les deux — le projet
 * dirait « c'est Paul qui a payé », le compte de Marie continuerait d'être débité. On refuse donc le
 * retrait tant qu'il en reste (garde-fou aussi côté serveur, migration 191 : la règle protège de
 * l'argent réel, elle ne peut pas vivre uniquement à l'écran).
 *
 * ⚠️ On ne compte QUE les transactions d'autrui. Ce garde-fou regardait la simple existence d'une
 * transaction, sans se demander à qui elle appartient : il bloquait donc aussi sur des lignes que
 * l'utilisateur avait saisies LUI-MÊME, sur SES comptes — c'est-à-dire qu'il l'empêchait de réparer
 * ses propres saisies, sans jamais lui dire comment s'en sortir.
 */
export function countParticipantRealTx(
  participantId: string,
  expenses: RwExpense[],
  payers: RwPayer[],
  expenseAccounts: RwExpenseAccount[],
  userId?: string,
): number {
  const othersTx = new Set(
    expenseAccounts.filter((a) => a.transaction_id && a.created_by !== userId).map((a) => a.expense_id),
  );
  const hasSplitRow = new Set(expenseAccounts.map((a) => a.expense_id));
  return expenses.filter((e) => {
    if (!paidByParticipant(e, payers).some((p) => p.participant_id === participantId)) return false;
    if (othersTx.has(e.id)) return true;
    // Colonne historique (dépense d'avant la répartition multi-comptes) : elle ne vaut que s'il
    // n'existe aucune ligne de répartition, sinon on compterait deux fois la même dépense.
    return !hasSplitRow.has(e.id) && e.transaction_id != null && e.created_by !== userId;
  }).length;
}

/**
 * FUSIONNER deux lignes qui désignent la même personne (migration 191).
 *
 * Les défauts d'invitation ont pu laisser un participant « non inscrit » à côté du compte Relyka de
 * la même personne, chacun portant une partie des dépenses. Fusionner consolide l'attribution sur
 * une seule ligne — et NE TOUCHE À AUCUNE TRANSACTION : chaque dépense garde la sienne, sur le
 * compte de son propriétaire. Aucun solde ne bouge, rien n'est débité deux fois.
 */
export function useRwMergeParticipant(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { from: string; into: string }) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('rw_merge_participants', { p_from: input.from, p_into: input.into });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_project', projectId] });
      qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] });
    },
  });
}

/** Entrée commune aux deux écritures d'une dépense (création / modification). */
interface RwExpenseInput {
  title: string; emoji?: string | null; amount: number; date: string;
  /** Payeur PRINCIPAL (celui qui a le plus avancé) — colonne historique, jamais nulle. */
  paidBy: string;
  /** Qui a avancé quoi. Une seule entrée = le cas courant. */
  payers: { participant_id: string; amount: number }[];
  shares: { participant_id: string; amount: number }[];
  /** Répartition de MA part avancée entre MES comptes. Vide = « cash » (aucune transaction). */
  accountSplits: RwAccountSplit[];
  projectName: string; categoryId?: string | null;
}

/** Remplace la liste des payeurs d'une dépense (supprimer puis réécrire : c'est un ensemble). */
async function writePayers(expenseId: string, projectId: string, input: RwExpenseInput): Promise<void> {
  if (!supabase) return;
  await supabase.from('rw_expense_payers').delete().eq('expense_id', expenseId);
  const rows = input.payers
    .filter((p) => p.amount > 0)
    .map((p) => ({ expense_id: expenseId, project_id: projectId, participant_id: p.participant_id, amount: p.amount }));
  if (rows.length) {
    const { error } = await supabase.from('rw_expense_payers').insert(rows);
    if (error) throw error;
  }
}

/** Une ligne de rattachement « cette transaction paie cette dépense ». */
interface SplitRow {
  expense_id: string; project_id: string; account_id: string;
  transaction_id: string | null; amount: number; created_by: string | null;
}

/**
 * Crée les vraies transactions d'une dépense, une par compte de la répartition.
 * Catégorie « Projets » + libellé préfixé du nom du projet (c'est ce libellé qui s'affiche en bleu
 * dans la liste des transactions).
 *
 * ⚠️ CHAQUE TRANSACTION EST RATTACHÉE IMMÉDIATEMENT, dans la même itération.
 * Les lignes de rattachement étaient auparavant insérées EN BLOC après la boucle : si la deuxième
 * transaction échouait (réseau, droit, limite de saisie), la première existait déjà sur le compte
 * mais n'était rattachée à rien. Plus aucun nettoyage ultérieur ne pouvait la retrouver — elle
 * restait à débiter le compte pour toujours, et un nouvel enregistrement en créait une de plus.
 * C'est précisément le mécanisme qui fabrique des doublons invisibles.
 */
async function postSplitTransactions(
  addTx: ReturnType<typeof useAddTransaction>,
  expenseId: string,
  projectId: string,
  userId: string | undefined,
  /* Volontairement RÉDUIT à ce que la fonction lit : elle sert aussi bien à la saisie d'une dépense
     qu'à la reventilation en masse, qui n'a ni parts ni payeurs à fournir. */
  input: Pick<RwExpenseInput, 'title' | 'date' | 'accountSplits' | 'projectName' | 'categoryId'>,
): Promise<SplitRow[]> {
  const out: SplitRow[] = [];
  for (const s of input.accountSplits) {
    if (!s.account_id || !(Math.abs(s.amount) > 0)) continue;
    const tx = await addTx.mutateAsync({
      account_id: s.account_id,
      category_id: input.categoryId ?? null,
      amount: -Math.abs(s.amount),
      date: input.date,
      note: `${input.projectName} · ${input.title || 'Dépense'}`,
    });
    const row: SplitRow = {
      expense_id: expenseId, project_id: projectId, account_id: s.account_id,
      transaction_id: (tx as any)?.id ?? null, amount: Math.abs(s.amount), created_by: userId ?? null,
    };
    // Rattachement AVANT de passer au compte suivant : une transaction qui existe est toujours
    // retrouvable, donc toujours nettoyable au prochain enregistrement.
    const { error } = await supabase!.from('rw_expense_accounts').insert(row);
    if (error) throw error;
    out.push(row);
  }
  return out;
}

/** Ajoute une dépense + sa répartition (dette entre participants, paiement entre comptes). */
export function useAddRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const addTx = useAddTransaction(userId);
  return useMutation({
    mutationFn: async (input: RwExpenseInput) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      /* La dépense est écrite AVANT ses transactions : il faut son id pour rattacher chaque ligne
         de répartition, et une dépense sans transaction reste cohérente (c'est le cas « cash »)
         alors qu'une transaction orpheline ne l'est pas. */
      const { data: exp, error } = await supabase.from('rw_expenses').insert({
        project_id: projectId, title: input.title, emoji: input.emoji ?? null, amount: Math.abs(input.amount),
        date: input.date, paid_by: input.paidBy, created_by: userId,
        // Colonnes historiques : renseignées avec la PREMIÈRE ligne de la répartition, pour que
        // tout ce qui les lit encore (suppression de projet, garde-fou « a impacté un vrai compte »)
        // continue de fonctionner tel quel.
        account_id: input.accountSplits[0]?.account_id ?? null, transaction_id: null,
      }).select().single();
      if (error) throw error;
      const expenseId = (exp as any).id as string;

      const rows = input.shares
        .filter((s) => s.amount > 0)
        .map((s) => ({ expense_id: expenseId, project_id: projectId, participant_id: s.participant_id, amount: s.amount }));
      if (rows.length) {
        const { error: se } = await supabase.from('rw_expense_shares').insert(rows);
        if (se) throw se;
      }

      await writePayers(expenseId, projectId, input);

      // Le rattachement est fait transaction par transaction DANS `postSplitTransactions` : ne pas
      // réinsérer ici, ce serait une deuxième ligne pour le même paiement.
      const splitRows = await postSplitTransactions(addTx, expenseId, projectId, userId, input);
      if (splitRows.length) {
        await supabase.from('rw_expenses')
          .update({ account_id: splitRows[0].account_id, transaction_id: splitRows[0].transaction_id })
          .eq('id', expenseId);
      }
      return exp as RwExpense;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['rw_linked_tx_ids', userId] }); },
  });
}

/**
 * Supprime les transactions réelles d'une dépense — celles de la répartition multi-comptes ET, pour
 * les dépenses d'avant la migration 178, celle portée par la colonne historique.
 * Ne touche QUE nos propres lignes : la transaction d'un autre participant est son argent.
 */
async function dropSplitTransactions(
  delTx: ReturnType<typeof useDeleteTransaction>,
  expense: Pick<RwExpense, 'id' | 'transaction_id' | 'created_by'>,
  userId: string | undefined,
): Promise<void> {
  if (!supabase) return;
  const { data: rows, error: readErr } = await supabase
    .from('rw_expense_accounts').select('id, transaction_id, created_by').eq('expense_id', expense.id);
  /* Si on ne SAIT PAS ce qui existe, on ne recrée rien : continuer reviendrait à empiler une
     nouvelle transaction par-dessus une ancienne qu'on n'a pas pu voir. */
  if (readErr) throw readErr;

  const mine = ((rows ?? []) as Array<{ id: string; transaction_id: string | null; created_by: string | null }>)
    .filter((r) => r.created_by === userId);

  const toDelete = mine.map((r) => r.transaction_id).filter(Boolean) as string[];
  // Ligne d'avant la répartition multi-comptes : elle n'a pas d'entrée dans rw_expense_accounts.
  if (expense.transaction_id && expense.created_by === userId && !toDelete.includes(expense.transaction_id)) {
    toDelete.push(expense.transaction_id);
  }

  for (const txId of toDelete) await deleteTransactionForSure(delTx, txId);
  if (mine.length) {
    const { error } = await supabase.from('rw_expense_accounts').delete().in('id', mine.map((r) => r.id));
    if (error) throw error;
  }
}

/**
 * Supprime une transaction, et VÉRIFIE qu'elle a bien disparu.
 *
 * ⚠️ Le code avalait toute erreur de suppression sous le commentaire « déjà supprimée ». Or ce
 * `catch` ne distinguait pas « la ligne n'existait plus » (bénin) de « la suppression a échoué »
 * (réseau, droit, conflit). Dans le second cas, l'enregistrement continuait et RECRÉAIT une
 * transaction : le compte se retrouvait débité DEUX FOIS pour la même dépense, et chaque nouvel
 * enregistrement en ajoutait une. C'est le mécanisme exact du doublon.
 *
 * On ne conclut donc plus à partir d'une exception : on va REGARDER si la ligne est encore là. Si
 * elle a disparu, tout va bien — l'échec était sans objet. Si elle est toujours présente, on lève,
 * et l'appelant s'arrête AVANT de recréer quoi que ce soit.
 */
async function deleteTransactionForSure(
  delTx: ReturnType<typeof useDeleteTransaction>,
  transactionId: string,
): Promise<void> {
  try {
    await delTx.mutateAsync(transactionId);
    return;
  } catch (e) {
    if (!supabase) throw e;
    const { data } = await supabase.from('transactions').select('id').eq('id', transactionId).maybeSingle();
    if (!data) return; // elle n'existait déjà plus : l'échec ne portait sur rien
    throw new Error(
      "La transaction liée à cette dépense n'a pas pu être supprimée. Rien n'a été réenregistré — "
      + 'réessaie, pour éviter que ton compte soit débité deux fois.',
    );
  }
}

/** Modifie une dépense + ses deux répartitions. Recrée les transactions liées si nécessaire. */
export function useUpdateRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const addTx = useAddTransaction(userId);
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    /* Plus de drapeau « suis-je le payeur ? » : il décrivait la situation d'APRÈS et servait à
       décider s'il fallait nettoyer — ce qui laissait des transactions derrière soi dès qu'on
       cessait d'être payeur. Le périmètre est désormais déduit de ce qui EXISTE (mes lignes), pas
       de ce que l'écran croit savoir. */
    mutationFn: async (input: RwExpenseInput & { expense: RwExpense }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');

      /* ── MES LIGNES SONT TOUJOURS RECONSTRUITES, celles des autres jamais touchées ────────────
         Le nettoyage était conditionné à `iAmPayer`, c'est-à-dire à la situation APRÈS
         modification. Retirer son nom de la liste des payeurs sautait donc le nettoyage : mes
         anciennes transactions restaient en base, mon compte restait débité, et plus rien ne les
         rattachait à quoi que ce soit. On supprime donc systématiquement MES lignes, puis on les
         recrée d'après la nouvelle répartition — vide si je ne paie plus, ce qui est exactement le
         résultat attendu.
         `dropSplitTransactions` ne touche que ce qui m'appartient : l'argent des autres payeurs
         reste intact, quel que soit ce que je modifie. */
      const legacyWasMine = input.expense.created_by === userId;
      await dropSplitTransactions(delTx, input.expense, userId);
      const splitRows = await postSplitTransactions(addTx, input.expense.id, projectId, userId, input);

      /* Colonnes historiques : je ne les réécris QUE si elles étaient à moi. Sur une dépense créée
         par quelqu'un d'autre, elles pointent SA transaction — les remettre à zéro effacerait le
         lien vers l'argent d'un autre participant. */
      const account_id = legacyWasMine ? (splitRows[0]?.account_id ?? null) : input.expense.account_id;
      const transaction_id = legacyWasMine ? (splitRows[0]?.transaction_id ?? null) : input.expense.transaction_id;
      const { error } = await supabase.from('rw_expenses').update({
        title: input.title, emoji: input.emoji ?? null, amount: Math.abs(input.amount),
        date: input.date, paid_by: input.paidBy, account_id, transaction_id,
      }).eq('id', input.expense.id);
      if (error) throw error;
      // (Les lignes de rattachement sont posées par `postSplitTransactions`, transaction par
      //  transaction — surtout ne PAS les réinsérer ici : ce serait un doublon par enregistrement.)
      await writePayers(input.expense.id, projectId, input);
      // Remplace la répartition de la dette.
      await supabase.from('rw_expense_shares').delete().eq('expense_id', input.expense.id);
      const rows = input.shares.filter((s) => s.amount > 0)
        .map((s) => ({ expense_id: input.expense.id, project_id: projectId, participant_id: s.participant_id, amount: s.amount }));
      if (rows.length) { const { error: se } = await supabase.from('rw_expense_shares').insert(rows); if (se) throw se; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['rw_linked_tx_ids', userId] }); },
  });
}

/** Supprime une dépense (et les transactions liées, en rétablissant le solde des comptes). */
export function useDeleteRwExpense(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    mutationFn: async (expense: RwExpense) => {
      if (!supabase) throw new Error('Backend indisponible');
      await dropSplitTransactions(delTx, expense, userId);
      const { error } = await supabase.from('rw_expenses').delete().eq('id', expense.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['rw_linked_tx_ids', userId] }); },
  });
}

/**
 * CHANGEMENT EN MASSE du compte imputé — le geste de fin de projet.
 *
 * Cas réel : pendant le voyage, on saisit tout en « cash » ou sur un compte par défaut ; au retour,
 * on veut que ces dépenses tombent sur le BON compte pour qu'elles impactent son Relyka. Le faire
 * dépense par dépense était rédhibitoire.
 *
 * `toAccountId = null` → on repasse en « cash » : les transactions sont supprimées (les soldes sont
 * rétablis par useDeleteTransaction), la dépense reste dans le projet.
 * On ne déplace QUE nos propres lignes — l'argent des autres participants ne nous appartient pas.
 */
export function useRwBulkReassignAccount(projectId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const addTx = useAddTransaction(userId);
  const delTx = useDeleteTransaction(userId);
  return useMutation({
    mutationFn: async (input: {
      /** Chaque dépense avec CE QUE J'Y AI AVANCÉ — jamais son montant total : à deux payeurs,
       *  recréer la transaction pour la totalité ferait sortir de mon compte l'argent d'un autre. */
      expenses: Array<{ expense: RwExpense; myAmount: number }>;
      toAccountId: string | null;
      projectName: string;
      categoryId?: string | null;
    }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      for (const { expense: e, myAmount } of input.expenses) {
        await dropSplitTransactions(delTx, e, userId);
        let account_id: string | null = null;
        let transaction_id: string | null = null;
        if (input.toAccountId && myAmount > 0) {
          const rows = await postSplitTransactions(addTx, e.id, projectId, userId, {
            title: e.title, date: e.date,
            accountSplits: [{ account_id: input.toAccountId, amount: myAmount }],
            projectName: input.projectName, categoryId: input.categoryId ?? null,
          });
          // Rattachement déjà posé par `postSplitTransactions` (cf. son en-tête).
          if (rows.length) {
            account_id = rows[0].account_id;
            transaction_id = rows[0].transaction_id;
          }
        }
        const { error } = await supabase.from('rw_expenses').update({ account_id, transaction_id }).eq('id', e.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['rw_linked_tx_ids', userId] });
    },
  });
}

/** Invite un utilisateur par son code public (RPC sécurisée). */
export function useRwInviteByCode(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { code: string; name: string }) => {
      if (!supabase || !projectId) throw new Error('Backend indisponible');
      const { error } = await supabase.rpc('rw_invite_by_code', { p_project: projectId, p_code: input.code, p_name: input.name });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }),
  });
}

export interface RwProjectStats {
  participants: { id: string; name: string }[];
  total: number;
  /** Total payé par participant (id → montant), pour la barre de contribution. */
  paidBy: Record<string, number>;
}

/**
 * Stats LÉGÈRES de plusieurs projets partagés (2 requêtes pour toute la liste) : participants,
 * total réuni et répartition par payeur → affichées sur les cartes de la page Projets sans
 * devoir ouvrir chaque projet.
 */
export function useRwProjectsStats(userId: string | undefined, projectIds: string[]) {
  return useQuery({
    queryKey: ['rw_projects_stats', userId, projectIds.slice().sort().join(',')],
    enabled: !!userId && ok() && projectIds.length > 0,
    queryFn: async (): Promise<Record<string, RwProjectStats>> => {
      const [partsRes, expsRes] = await Promise.all([
        supabase!.from('rw_participants').select('id, project_id, display_name').in('project_id', projectIds),
        supabase!.from('rw_expenses').select('project_id, amount, paid_by').in('project_id', projectIds),
      ]);
      const out: Record<string, RwProjectStats> = {};
      for (const pid of projectIds) out[pid] = { participants: [], total: 0, paidBy: {} };
      for (const p of (partsRes.data ?? []) as any[]) {
        out[p.project_id]?.participants.push({ id: p.id, name: p.display_name });
      }
      for (const e of (expsRes.data ?? []) as any[]) {
        const s = out[e.project_id];
        if (!s) continue;
        const amt = Number(e.amount) || 0;
        s.total += amt;
        if (e.paid_by) s.paidBy[e.paid_by] = (s.paidBy[e.paid_by] ?? 0) + amt;
      }
      return out;
    },
  });
}

/**
 * Invitations en attente reçues par l'utilisateur.
 *
 * `rw_my_invitations` s'appuie sur `auth.uid()` : en « connecté en tant que », le jeton reste celui
 * de l'ADMIN — il voyait donc SES invitations, ou rien. Le bloc était simplement masqué, ce qui
 * revenait à ne pas pouvoir dépanner quelqu'un dont l'invitation ne passe pas. En impersonation on
 * emprunte donc la variante administrateur (`rw_invitations_for`, migration 185), qui prend
 * l'utilisateur en paramètre et vérifie `is_app_admin()` avant tout.
 */
export function useRwInvitations(userId: string | undefined) {
  const { isImpersonating } = useAuth();
  return useQuery({
    queryKey: ['rw_invitations', userId, isImpersonating],
    enabled: !!userId && ok(),
    queryFn: async (): Promise<RwInvitation[]> => {
      // Enrichi du nom du projet et de l'invitant : l'invité n'a pas encore accès au projet.
      const { data, error } = isImpersonating
        ? await supabase!.rpc('rw_invitations_for', { p_user: userId })
        : await supabase!.rpc('rw_my_invitations');
      if (error) throw error;
      return (data ?? []) as RwInvitation[];
    },
  });
}

export function useRwRespondInvitation(userId: string | undefined) {
  const qc = useQueryClient();
  const { isImpersonating } = useAuth();
  return useMutation({
    mutationFn: async (input: { inviteId: string; accept: boolean }) => {
      if (!supabase) throw new Error('Backend indisponible');
      /* Même raison qu'à la lecture : `rw_accept_invitation` lie l'invitation à `auth.uid()`, donc
         en impersonation elle rattacherait le projet à l'ADMIN. La variante administrateur agit
         explicitement au nom du destinataire de l'invitation. */
      const { error } = isImpersonating
        ? await supabase.rpc('rw_respond_invitation_for', { p_invite: input.inviteId, p_accept: input.accept })
        : await supabase.rpc(input.accept ? 'rw_accept_invitation' : 'rw_decline_invitation', { p_invite: input.inviteId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rw_invitations', userId] });
      qc.invalidateQueries({ queryKey: ['rw_projects'] });
    },
  });
}

/** Abonnement temps réel : rafraîchit le projet quand un participant modifie quelque chose. */
export function useRwRealtime(projectId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!supabase || !projectId) return;
    const client = supabase;
    // Nom de canal UNIQUE par montage. Si l'écran est remonté (ex. retour après ajout d'une
    // dépense) avant la fin du nettoyage asynchrone du canal précédent, un nom partagé ferait
    // renvoyer par `.channel()` le canal DÉJÀ souscrit → `.on()` lève « cannot add
    // postgres_changes callbacks after subscribe() » (écran blanc). Un suffixe aléatoire élimine
    // toute collision de topic ; le `removeChannel` du cleanup ferme bien chaque instance.
    const channel = client.channel(`rw_${projectId}_${Math.random().toString(36).slice(2)}`);
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_expenses', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_expense_shares', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_expense_accounts', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_expenses', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rw_participants', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['rw_project', projectId] }))
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [projectId, qc]);
}
