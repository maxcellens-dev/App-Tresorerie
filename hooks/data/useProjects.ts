import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import type { Project } from '../../types/database';
import { todayISO } from '../../lib/dateUtils';
import { buildProjectTransactions, projectMode, type ProjectMode } from '../../lib/finance/projectTx';
import { reverseBalanceAndDeleteTransactions, recomputeBalances, TX_REVERSAL_COLS } from './useTransactions';

const PROJECTS_KEY = 'projects';
const TRANSACTIONS_KEY = 'transactions';

/** Nombre maximal d'échéances générées d'avance pour un projet sans date de fin. */
const MAX_SCHEDULE_MONTHS = 24;

interface ScheduleInput {
  profileId: string;
  projectId: string;
  projectName: string;
  mode: ProjectMode;
  allocationType: 'monthly' | 'date' | 'ponctuel';
  monthlyAllocation: number;
  /** Date de la 1ʳᵉ échéance (modes 'monthly' / 'date'). */
  startDate: string;
  /** Date cible (mode 'date') — borne la génération. */
  targetDate: string | null;
  /** Échéances saisies une à une (mode 'ponctuel'). */
  ponctuelEntries?: { date: string; amount: number }[];
  sourceId: string | null;
  linkedId: string | null;
  projetsCategoryId: string | null;
  expenseCategoryId: string | null;
  /** N'inclure que les échéances STRICTEMENT postérieures à cette date (passé figé). */
  afterDate?: string | null;
  /** Mois (YYYY-MM) déjà pourvus d'une transaction validée → ne pas y recréer de brouillon. */
  skipMonths?: Set<string>;
}

/**
 * Construit toutes les lignes de transaction de l'échéancier d'un projet (rien n'est inséré ici).
 * Utilisé à la création ET à la régénération (mise à jour, suppression d'une échéance).
 */
function buildScheduleRows(input: ScheduleInput): any[] {
  const today = todayISO();
  const one = (amount: number, date: string) =>
    buildProjectTransactions({
      profileId: input.profileId,
      projectId: input.projectId,
      projectName: input.projectName,
      mode: input.mode,
      amount,
      date,
      accountId: input.sourceId,
      linkedAccountId: input.linkedId,
      projetsCategoryId: input.projetsCategoryId,
      expenseCategoryId: input.expenseCategoryId,
      today,
    });

  const keep = (date: string) => !input.afterDate || date > input.afterDate;
  const rows: any[] = [];

  if (input.allocationType === 'ponctuel') {
    for (const e of input.ponctuelEntries ?? []) {
      if (e.amount > 0 && keep(e.date)) rows.push(...one(e.amount, e.date));
    }
    return rows;
  }

  if (!(input.monthlyAllocation > 0)) return rows;
  const cursor = new Date(input.startDate + 'T00:00:00');
  const endLimit = input.targetDate ? new Date(input.targetDate + 'T23:59:59') : null;
  for (let i = 0; i < MAX_SCHEDULE_MONTHS; i++) {
    if (endLimit && cursor > endLimit) break;
    const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (keep(d) && !input.skipMonths?.has(d.slice(0, 7))) rows.push(...one(input.monthlyAllocation, d));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return rows;
}

/** Catégorie « Projets » du profil (porte les réservations du mode « Conserver »). */
async function fetchProjetsCategoryId(profileId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('profile_id', profileId)
    .eq('name', 'Projets')
    .eq('type', 'expense')
    .maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * Comptes du projet selon son mode :
 *  - 'transfer' : source ≠ destination (virements) ;
 *  - 'reserve'  : destination = source (réservation sur place) ;
 *  - 'spend'    : un seul compte (celui des dépenses), aucune destination.
 */
function normalizeAccounts(mode: ProjectMode, sourceId: string | null, linkedId: string | null) {
  if (mode === 'spend') return { sourceId, linkedId: null };
  if (mode === 'reserve') return { sourceId, linkedId: sourceId };
  return { sourceId, linkedId };
}

export function useProjects(profileId: string | undefined) {
  return useQuery({
    queryKey: [PROJECTS_KEY, profileId],
    queryFn: async (): Promise<Project[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        ...p,
        target_amount: Number(p.target_amount),
        monthly_allocation: Number(p.monthly_allocation),
      }));
    },
    enabled: !!profileId,
  });
}

export function useAddProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      target_amount: number;
      monthly_allocation: number;
      allocation_type?: 'monthly' | 'date' | 'ponctuel';
      target_date?: string;
      current_accumulated?: number;
      mode?: ProjectMode;
      expense_category_id?: string | null;
      source_account_id?: string;
      linked_account_id?: string;
      transaction_day?: number;
      first_payment_date?: string;
      ponctuel_entries?: { date: string; amount: number }[];
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const mode: ProjectMode = input.mode ?? 'transfer';
      const { sourceId, linkedId } = normalizeAccounts(mode, input.source_account_id || null, input.linked_account_id || null);
      const expenseCategoryId = mode === 'spend' ? (input.expense_category_id ?? null) : null;
      const allocationType = input.allocation_type || 'monthly';

      const payload = {
        profile_id: profileId,
        name: input.name,
        description: input.description || null,
        target_amount: input.target_amount,
        monthly_allocation: input.monthly_allocation,
        allocation_type: allocationType,
        target_date: input.target_date || null,
        current_accumulated: input.current_accumulated || 0,
        mode,
        expense_category_id: expenseCategoryId,
        source_account_id: sourceId,
        linked_account_id: linkedId,
        transaction_day: input.transaction_day || null,
        first_payment_date: input.first_payment_date || null,
        status: 'active',
      };
      const { data, error } = await supabase
        .from('projects')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      const startDate = input.first_payment_date || (() => {
        const now = new Date();
        const day = input.transaction_day || now.getDate();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      })();

      const txnsToInsert = buildScheduleRows({
        profileId,
        projectId: data.id,
        projectName: input.name,
        mode,
        allocationType,
        monthlyAllocation: input.monthly_allocation,
        startDate,
        targetDate: input.target_date || null,
        ponctuelEntries: input.ponctuel_entries,
        sourceId,
        linkedId,
        projetsCategoryId: mode === 'reserve' ? await fetchProjetsCategoryId(profileId) : null,
        expenseCategoryId,
      });

      if (txnsToInsert.length > 0) {
        const { error: txErr } = await supabase.from('transactions').insert(txnsToInsert);
        if (txErr) console.warn('Transaction(s) non créée(s):', txErr);
        // Mode « Dépenser » : ce sont de vraies dépenses validées → le solde du compte doit en tenir
        // compte tout de suite (les échéances futures, posted=false, seront portées le jour venu).
        else if (mode === 'spend') await recomputeBalances([sourceId]);
      }

      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      description?: string;
      target_amount?: number;
      monthly_allocation?: number;
      allocation_type?: 'monthly' | 'date' | 'ponctuel';
      target_date?: string | null;
      current_accumulated?: number;
      /** Catégorie des dépenses (mode 'spend'). Le MODE, lui, n'est jamais modifiable. */
      expense_category_id?: string | null;
      source_account_id?: string | null;
      linked_account_id?: string | null;
      transaction_day?: number | null;
      first_payment_date?: string;
      status?: string;
      ponctuel_entries?: { date: string; amount: number }[];
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = todayISO();

      // État AVANT pour détecter si l'ÉCHÉANCIER change réellement (sinon : pas de
      // régénération, on préserve les transactions déjà validées — cf. renommage).
      const { data: before, error: beforeErr } = await supabase
        .from('projects')
        .select('mode, expense_category_id, monthly_allocation, allocation_type, target_date, source_account_id, linked_account_id, transaction_day, first_payment_date')
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (beforeErr) throw beforeErr;

      // Le mode est FIGÉ à la création : on le relit du projet, jamais de l'entrée.
      const mode = projectMode(before);
      const { sourceId, linkedId } = normalizeAccounts(
        mode,
        input.source_account_id !== undefined ? input.source_account_id : (before as any)?.source_account_id ?? null,
        input.linked_account_id !== undefined ? input.linked_account_id : (before as any)?.linked_account_id ?? null,
      );
      const expenseCategoryId = mode === 'spend'
        ? (input.expense_category_id !== undefined ? input.expense_category_id : (before as any)?.expense_category_id ?? null)
        : null;

      // 1. Mettre à jour le projet
      const { data, error } = await supabase
        .from('projects')
        .update({
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.target_amount !== undefined && { target_amount: input.target_amount }),
          ...(input.monthly_allocation !== undefined && { monthly_allocation: input.monthly_allocation }),
          ...(input.allocation_type && { allocation_type: input.allocation_type }),
          ...(input.target_date !== undefined && { target_date: input.target_date }),
          ...(input.current_accumulated !== undefined && { current_accumulated: input.current_accumulated }),
          expense_category_id: expenseCategoryId,
          source_account_id: sourceId,
          linked_account_id: linkedId,
          ...(input.transaction_day !== undefined && { transaction_day: input.transaction_day }),
          ...(input.first_payment_date !== undefined && { first_payment_date: input.first_payment_date || null }),
          ...(input.status && { status: input.status }),
        })
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;

      // Changement de catégorie (mode « Dépenser ») : on re-catégorise TOUTES les dépenses du projet,
      // passées comprises — c'est un simple reclassement, sans effet sur les soldes.
      const categoryChanged = mode === 'spend' && expenseCategoryId !== ((before as any)?.expense_category_id ?? null);
      if (categoryChanged) {
        await supabase
          .from('transactions')
          .update({ category_id: expenseCategoryId })
          .eq('project_id', input.id)
          .eq('profile_id', profileId)
          .is('linked_account_id', null)
          .lt('amount', 0);
      }

      // Régénérer les transactions UNIQUEMENT si un champ d'échéancier change réellement.
      // Un simple renommage / changement de description / statut ne doit PAS nuker + recréer
      // les transactions (ce qui dé-validait les paiements passés et brassait les soldes).
      const changed = (field: string, val: unknown) =>
        val !== undefined && String((before as any)?.[field] ?? '') !== String((val as any) ?? '');
      const scheduleChanged =
        changed('monthly_allocation', input.monthly_allocation) ||
        changed('allocation_type', input.allocation_type) ||
        changed('target_date', input.target_date) ||
        changed('source_account_id', sourceId) ||
        changed('linked_account_id', linkedId) ||
        changed('transaction_day', input.transaction_day) ||
        changed('first_payment_date', input.first_payment_date) ||
        input.ponctuel_entries !== undefined;
      if (!scheduleChanged) return data;

      const projectName = input.name ?? data.name;
      const endDate = input.target_date !== undefined ? input.target_date : data.target_date;
      const allocType = (input.allocation_type ?? data.allocation_type ?? 'monthly') as 'monthly' | 'date' | 'ponctuel';

      // 2. Supprimer les échéances À REFAIRE.
      //  • 'spend' : les dépenses sont validées d'emblée ; le PASSÉ est un fait acquis (on n'y touche
      //    pas), seules les dépenses à VENIR (date > aujourd'hui, non encore portées au solde) sont
      //    régénérées.
      //  • 'transfer' / 'reserve' : on ne supprime que les BROUILLONS. Les transactions validées ne
      //    sont jamais touchées par une mise à jour (elles ne se modifient qu'à la main).
      let delQuery = supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', input.id)
        .eq('profile_id', profileId);
      if (mode === 'spend') {
        delQuery = delQuery.gt('date', today);
      } else {
        delQuery = delQuery.eq('is_draft', true);
        if (allocType === 'ponctuel') {
          // Ponctuel : on ne régénère que le mois courant + futurs → préserver aussi les brouillons
          // des mois PASSÉS (affichés « figés · passé » dans le formulaire).
          const nowDel = new Date();
          const currentMonthStart = `${nowDel.getFullYear()}-${String(nowDel.getMonth() + 1).padStart(2, '0')}-01`;
          delQuery = delQuery.gte('date', currentMonthStart);
        }
      }
      const { data: toDelete } = await delQuery;
      await reverseBalanceAndDeleteTransactions(profileId, (toDelete ?? []) as any);

      // Mois qui possèdent déjà une transaction VALIDÉE : en mensuel/date, on n'y recrée pas de
      // brouillon (sinon doublon avec la validée). En ponctuel, plusieurs virements/mois sont permis,
      // donc on n'applique PAS ce filtre (les entrées fournies font foi). En mode 'spend', le passé
      // est déjà protégé par `afterDate` → pas de filtre par mois (sinon on perdrait le mois courant).
      let skipMonths: Set<string> | undefined;
      if (mode !== 'spend' && allocType !== 'ponctuel') {
        const { data: validatedTxns, error: vErr } = await supabase
          .from('transactions')
          .select('date')
          .eq('project_id', input.id)
          .eq('profile_id', profileId)
          .eq('is_draft', false)
          .lt('amount', 0);
        if (vErr) throw vErr;
        skipMonths = new Set((validatedTxns ?? []).map((t: any) => String(t.date).slice(0, 7)));
      }

      // 3. Point de départ de l'échéancier (mensuel / date cible).
      const paymentDay = input.transaction_day ?? data.transaction_day ?? new Date().getDate();
      let startDate: string;
      if (input.first_payment_date) {
        startDate = input.first_payment_date;
      } else {
        const { data: firstTxn, error: fErr } = await supabase
          .from('transactions')
          .select('date')
          .eq('project_id', input.id)
          .eq('profile_id', profileId)
          .order('date', { ascending: true })
          .limit(1);
        if (fErr) throw fErr;
        startDate = firstTxn?.[0]?.date ?? (() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`;
        })();
      }

      const txnsToInsert = buildScheduleRows({
        profileId,
        projectId: input.id,
        projectName,
        mode,
        allocationType: allocType,
        monthlyAllocation: input.monthly_allocation !== undefined ? input.monthly_allocation : Number(data.monthly_allocation),
        startDate,
        targetDate: endDate || null,
        ponctuelEntries: input.ponctuel_entries,
        sourceId,
        linkedId,
        projetsCategoryId: mode === 'reserve' ? await fetchProjetsCategoryId(profileId) : null,
        expenseCategoryId,
        // Mode « Dépenser » : ne jamais recréer une dépense déjà passée (elle a réellement eu lieu).
        afterDate: mode === 'spend' ? today : null,
        skipMonths,
      });

      if (txnsToInsert.length > 0) {
        const { error: insErr } = await supabase.from('transactions').insert(txnsToInsert);
        if (insErr) console.warn('Erreur régénération txns projet:', insErr);
      }
      if (mode === 'spend') await recomputeBalances([sourceId]);

      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useCheckProjectTransactions(profileId: string | undefined) {
  return {
    check: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = todayISO();
      const { data: all, error } = await supabase
        .from('transactions')
        .select('id, date, is_draft')
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      const rows = (all ?? []) as { id: string; date: string; is_draft: boolean | null }[];
      // past/future conservés pour la compatibilité (sélecteur de date « supprimer à partir de »).
      const past = rows.filter((t) => t.date <= today);
      const future = rows.filter((t) => t.date > today);
      // validées (is_draft=false) = conservées+dissociées à la suppression ; brouillons = supprimés.
      const validated = rows.filter((t) => t.is_draft === false);
      const drafts = rows.filter((t) => t.is_draft !== false);
      // Mode « Dépenser » : tout est validé → ce qui est conservé/supprimé se joue sur la DATE.
      const pastValidated = validated.filter((t) => t.date <= today);
      const futureValidated = validated.filter((t) => t.date > today);
      return { past, future, validated, drafts, pastValidated, futureValidated };
    },
  };
}

/**
 * Suppression « douce » du projet (comportement par défaut) :
 *  - ce qui a RÉELLEMENT eu lieu est DÉTACHÉ (project_id → null) et conservé dans les comptes :
 *    virements validés (→ virements classiques) et, en mode « Dépenser », dépenses déjà passées ;
 *  - le reste est supprimé : brouillons jamais validés + dépenses à venir (jamais réalisées) ;
 *  - le projet est supprimé.
 */
export function useDeleteProjectDissociating(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = todayISO();

      /* Le MODE décide de ce qu'on garde ou détruit (cf. `projectMode`). Son erreur n'était pas
         lue : sur une lecture ratée, `proj` valait `undefined` et le mode retombait sur son défaut
         — donc une règle de conservation potentiellement autre que celle du projet, appliquée à des
         transactions réelles. */
      const { data: proj, error: projErr } = await supabase
        .from('projects')
        .select('mode, source_account_id, linked_account_id')
        .eq('id', projectId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (projErr) throw projErr;
      const mode = projectMode(proj);

      // 1. Détacher ce qui est conservé (les 2 jambes d'un virement portent project_id).
      //    Mode « Dépenser » : seules les dépenses DÉJÀ PASSÉES sont conservées — celles à venir
      //    n'ont pas eu lieu, elles disparaissent avec le projet.
      let unlink = supabase
        .from('transactions')
        .update({ project_id: null })
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .eq('is_draft', false);
      if (mode === 'spend') unlink = unlink.lte('date', today);
      const { error: unlinkErr } = await unlink;
      if (unlinkErr) throw unlinkErr;

      // 2. Supprimer tout ce qui reste rattaché au projet (brouillons + dépenses à venir).
      const { data: rest, error: restErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
      if (restErr) throw restErr;
      await reverseBalanceAndDeleteTransactions(profileId, (rest ?? []) as any);
      if (mode === 'spend') await recomputeBalances([(proj as any)?.source_account_id]);

      // 3. Supprimer le projet.
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteProjectFull(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      /* ⚠️ LA LECTURE DOIT RÉUSSIR AVANT DE SUPPRIMER LE PROJET. Son erreur n'était pas lue : une
         lecture ratée rendait `undefined`, donc « aucune transaction à défaire », et on supprimait
         le projet quand même. Ses transactions restaient alors sur les comptes, sans plus rien pour
         les rattacher — impossibles à retrouver, et le solde définitivement faux. */
      const { data: toDelete, error: readErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
      if (readErr) throw readErr;
      await reverseBalanceAndDeleteTransactions(profileId, (toDelete ?? []) as any);
      // Delete the project
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * Supprime le projet en conservant les transactions d'une période clôturée.
 * Les transactions clôturées sont détachées (project_id → null), les autres sont supprimées.
 */
export function useDeleteProjectKeepingLocked(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, lockDate }: { projectId: string; lockDate: string }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');

      const { error: unlinkErr } = await supabase
        .from('transactions')
        .update({ project_id: null })
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .lte('date', lockDate);
      if (unlinkErr) throw unlinkErr;

      // Erreur LUE (cf. `useDeleteProjectFull`) : sans ce contrôle, une lecture ratée supprimerait
      // le projet en laissant ses transactions futures sur les comptes, orphelines.
      const { data: toDelete, error: readErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', lockDate);
      if (readErr) throw readErr;
      // Réverse le solde des lignes validées (posted) au-delà de la date de clôture.
      await reverseBalanceAndDeleteTransactions(profileId, (toDelete ?? []) as any);

      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useArchiveProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = todayISO();
      // Delete future transactions only
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', today);
      if (txErr) throw txErr;
      // Archive the project with end date = today
      const { error } = await supabase
        .from('projects')
        .update({ status: 'archived', target_date: today })
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteProject(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * Supprime les transactions à partir d'une date donnée (incluse) et
 * recalcule le target_amount du projet = somme des transactions restantes (en valeur absolue du débit).
 * Le projet reste actif ; il sera auto-archivé quand il atteint 100 %.
 */
export function useDeleteProjectFromDate(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, fromDate }: { projectId: string; fromDate: string }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');

      // 1. Supprimer les transactions >= fromDate en RÉVERSANT le solde des lignes validées.
      //    Erreur LUE : « je n'ai rien pu lire » ne doit pas se traduire par « il n'y a rien ».
      const { data: toDelete, error: readErr } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gte('date', fromDate);
      if (readErr) throw readErr;
      await reverseBalanceAndDeleteTransactions(profileId, (toDelete ?? []) as any);

      // 2. Calculer la somme des transactions restantes (débits = montants négatifs)
      const { data: remaining, error: sumErr } = await supabase
        .from('transactions')
        .select('amount')
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .lt('amount', 0);
      if (sumErr) throw sumErr;

      const newTarget = (remaining ?? []).reduce((s, t) => s + Math.abs(t.amount), 0);

      // 3. Mettre à jour le target_amount du projet
      const { error: upErr } = await supabase
        .from('projects')
        .update({ target_amount: newTarget })
        .eq('id', projectId)
        .eq('profile_id', profileId);
      if (upErr) throw upErr;

      return { newTarget };
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

/**
 * Archive automatiquement les projets actifs dont l'OBJECTIF est atteint (avancement ≥ 100 %),
 * calculé à partir des transactions réelles (progressById issu du Pilotage), pas du champ
 * current_accumulated (qui peut être obsolète). Appelé à l'ouverture de la page Projets.
 * Les transactions futures du projet sont supprimées (plus de versement après l'objectif).
 */
export function useAutoArchiveProjects(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ projects, progressById }: { projects: Project[]; progressById: Record<string, number> }) => {
      if (!supabase || !profileId) return;
      const today = todayISO();

      const toArchive = projects.filter((p) => {
        if (p.status !== 'active' && p.status !== 'completed') return false;
        const target = Number(p.target_amount);
        if (target <= 0) return false;
        const pct = progressById[p.id] ?? (Number(p.current_accumulated || 0) / target) * 100;
        // Tolérance d'arrondi : 999,99/1000 = 99,999 % doit compter comme atteint.
        return pct >= 99.5;
      });

      for (const project of toArchive) {
        // Stopper les versements futurs
        await supabase.from('transactions').delete()
          .eq('project_id', project.id).eq('profile_id', profileId).gt('date', today);
        await supabase.from('projects')
          .update({ status: 'archived' })
          .eq('id', project.id).eq('profile_id', profileId);
      }
      return toArchive.length;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
