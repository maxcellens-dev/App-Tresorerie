import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { reverseBalanceAndDeleteTransactions, TX_REVERSAL_COLS } from './useTransactions';

const PROJECTS_KEY = 'projects';
const TRANSACTIONS_KEY = 'transactions';

/**
 * Helper: crée les transactions initiales d'un projet (1 seule entrée si même compte, 2 sinon).
 * Retourne les objets à insérer (sans effectuer l'insertion).
 */
function buildProjectTransactions(opts: {
  profileId: string;
  projectId: string;
  projectName: string;
  monthlyAllocation: number;
  sourceAccountId: string | null;
  linkedAccountId: string | null;
  date: string;
  endDate: string | null;
  projetsCategoryId: string | null;
}): any[] {
  const { profileId, projectId, projectName, monthlyAllocation, sourceAccountId, linkedAccountId, date, projetsCategoryId } = opts;
  const sameAccount = sourceAccountId && linkedAccountId && sourceAccountId === linkedAccountId;
  const txns: any[] = [];

  if (sameAccount) {
    // Même compte : brouillon « Conservé » d'office (réservation pure sur le compte).
    txns.push({
      profile_id: profileId,
      account_id: sourceAccountId,
      category_id: projetsCategoryId,
      amount: -monthlyAllocation,
      date,
      note: `🔒 ${projectName}`,
      is_forecast: false,
      is_recurring: false,
      recurrence_rule: null,
      recurrence_end_date: null,
      project_id: projectId,
      is_draft: true,
      is_reserved: true,
      posted: false, // brouillon → jamais porté au solde (cohérence du drapeau)
    });
  } else {
    // Virement vers un autre compte (épargne / investissement) : le brouillon est un VIREMENT
    // (linked_account_id renseigné), pas une dépense. Le crédit de destination est créé à la validation.
    if (sourceAccountId) {
      txns.push({
        profile_id: profileId,
        account_id: sourceAccountId,
        category_id: null,                 // un virement n'a pas de catégorie de dépense
        linked_account_id: linkedAccountId, // ← en fait un virement (et non une dépense)
        amount: -monthlyAllocation,
        date,
        note: projectName,
        is_forecast: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: projectId,
        is_draft: true,
        posted: false, // brouillon → jamais porté au solde (cohérence du drapeau)
      });
    }
  }
  return txns;
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
      source_account_id?: string;
      linked_account_id?: string;
      transaction_day?: number;
      first_payment_date?: string;
      ponctuel_entries?: { date: string; amount: number }[];
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const payload = {
        profile_id: profileId,
        name: input.name,
        description: input.description || null,
        target_amount: input.target_amount,
        monthly_allocation: input.monthly_allocation,
        allocation_type: input.allocation_type || 'monthly',
        target_date: input.target_date || null,
        current_accumulated: input.current_accumulated || 0,
        source_account_id: input.source_account_id || null,
        linked_account_id: input.linked_account_id || null,
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

      // Récupérer la catégorie "Projets" du profil
      const { data: projetsCat } = await supabase
        .from('categories')
        .select('id')
        .eq('profile_id', profileId)
        .eq('name', 'Projets')
        .eq('type', 'expense')
        .maybeSingle();
      const projetsCategoryId = projetsCat?.id ?? null;

      if (input.allocation_type === 'ponctuel' && input.ponctuel_entries && input.ponctuel_entries.length > 0) {
        // Apport ponctuel : une transaction par entrée saisie
        const txnsToInsert: any[] = [];
        for (const entry of input.ponctuel_entries) {
          const monthTxns = buildProjectTransactions({
            profileId,
            projectId: data.id,
            projectName: input.name,
            monthlyAllocation: entry.amount,
            sourceAccountId: input.source_account_id || null,
            linkedAccountId: input.linked_account_id || null,
            date: entry.date,
            endDate: null,
            projetsCategoryId,
          });
          txnsToInsert.push(...monthTxns);
        }
        if (txnsToInsert.length > 0) {
          const { error: txErr } = await supabase.from('transactions').insert(txnsToInsert);
          if (txErr) console.warn('Transaction(s) non créée(s):', txErr);
        }
      } else if (data && input.monthly_allocation > 0) {
        const startDate = input.first_payment_date || (() => {
          const now = new Date();
          const day = input.transaction_day || now.getDate();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        })();

        const cursor = new Date(startDate + 'T00:00:00');
        const endLimit = input.target_date ? new Date(input.target_date + 'T23:59:59') : null;
        const maxMonths = 24;
        const txnsToInsert: any[] = [];

        for (let i = 0; i < maxMonths; i++) {
          if (endLimit && cursor > endLimit) break;
          const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
          const monthTxns = buildProjectTransactions({
            profileId,
            projectId: data.id,
            projectName: input.name,
            monthlyAllocation: input.monthly_allocation,
            sourceAccountId: input.source_account_id || null,
            linkedAccountId: input.linked_account_id || null,
            date: d,
            endDate: input.target_date || null,
            projetsCategoryId,
          });
          txnsToInsert.push(...monthTxns);
          cursor.setMonth(cursor.getMonth() + 1);
        }

        if (txnsToInsert.length > 0) {
          const { error: txErr } = await supabase.from('transactions').insert(txnsToInsert);
          if (txErr) console.warn('Transaction(s) non créée(s):', txErr);
        }
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
      source_account_id?: string | null;
      linked_account_id?: string | null;
      transaction_day?: number | null;
      first_payment_date?: string;
      status?: string;
      ponctuel_entries?: { date: string; amount: number }[];
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');

      // État AVANT pour détecter si l'ÉCHÉANCIER change réellement (sinon : pas de
      // régénération, on préserve les transactions déjà validées — cf. renommage).
      const { data: before } = await supabase
        .from('projects')
        .select('monthly_allocation, allocation_type, target_date, source_account_id, linked_account_id, transaction_day, first_payment_date')
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .maybeSingle();

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
          ...(input.source_account_id !== undefined && { source_account_id: input.source_account_id }),
          ...(input.linked_account_id !== undefined && { linked_account_id: input.linked_account_id }),
          ...(input.transaction_day !== undefined && { transaction_day: input.transaction_day }),
          ...(input.first_payment_date !== undefined && { first_payment_date: input.first_payment_date || null }),
          ...(input.status && { status: input.status }),
        })
        .eq('id', input.id)
        .eq('profile_id', profileId)
        .select()
        .single();
      if (error) throw error;

      // Régénérer les transactions UNIQUEMENT si un champ d'échéancier change réellement.
      // Un simple renommage / changement de description / statut ne doit PAS nuker + recréer
      // les transactions (ce qui dé-validait les paiements passés et brassait les soldes).
      const changed = (field: keyof NonNullable<typeof before>, val: unknown) =>
        val !== undefined && String((before as any)?.[field] ?? '') !== String((val as any) ?? '');
      const scheduleChanged =
        changed('monthly_allocation', input.monthly_allocation) ||
        changed('allocation_type', input.allocation_type) ||
        changed('target_date', input.target_date) ||
        changed('source_account_id', input.source_account_id) ||
        changed('linked_account_id', input.linked_account_id) ||
        changed('transaction_day', input.transaction_day) ||
        changed('first_payment_date', input.first_payment_date) ||
        input.ponctuel_entries !== undefined;
      if (!scheduleChanged) return data;

      const projectName = input.name ?? data.name;
      const sourceId = input.source_account_id !== undefined ? input.source_account_id : data.source_account_id;
      const linkedId = input.linked_account_id !== undefined ? input.linked_account_id : data.linked_account_id;
      const endDate = input.target_date !== undefined ? input.target_date : data.target_date;
      const allocType = input.allocation_type ?? data.allocation_type ?? 'monthly';

      // Récupérer la catégorie "Projets" du profil
      const { data: projetsCat } = await supabase
        .from('categories')
        .select('id')
        .eq('profile_id', profileId)
        .eq('name', 'Projets')
        .eq('type', 'expense')
        .maybeSingle();
      const projetsCategoryId = projetsCat?.id ?? null;

      // 2. Supprimer UNIQUEMENT les brouillons (is_draft=true) du projet à régénérer.
      //    Les transactions VALIDÉES (is_draft=false) ne sont JAMAIS touchées par une mise à jour :
      //    elles ne peuvent être modifiées que manuellement (page Transactions). On les préserve donc
      //    et on régénère seulement les brouillons à venir.
      let delQuery = supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', input.id)
        .eq('profile_id', profileId)
        .eq('is_draft', true);
      if (allocType === 'ponctuel') {
        // Ponctuel : on ne régénère que le mois courant + futurs → préserver aussi les brouillons
        // des mois PASSÉS (affichés « figés · passé » dans le formulaire).
        const nowDel = new Date();
        const currentMonthStart = `${nowDel.getFullYear()}-${String(nowDel.getMonth() + 1).padStart(2, '0')}-01`;
        delQuery = delQuery.gte('date', currentMonthStart);
      }
      const { data: toDelete } = await delQuery;
      // (brouillons → posted=false : aucune réversion de solde, simple suppression.)
      await reverseBalanceAndDeleteTransactions(profileId, (toDelete ?? []) as any);

      // Mois qui possèdent déjà une transaction VALIDÉE : en mensuel/date, on n'y recrée pas de
      // brouillon (sinon doublon avec la validée). En ponctuel, plusieurs virements/mois sont permis,
      // donc on n'applique PAS ce filtre (les entrées fournies font foi).
      const { data: validatedTxns } = await supabase
        .from('transactions')
        .select('date')
        .eq('project_id', input.id)
        .eq('profile_id', profileId)
        .eq('is_draft', false)
        .lt('amount', 0);
      const validatedMonths = new Set((validatedTxns ?? []).map((t: any) => String(t.date).slice(0, 7)));

      // 3a. Ponctuel : régénérer depuis les entrées fournies
      if (allocType === 'ponctuel') {
        const entries = input.ponctuel_entries ?? [];
        if (entries.length === 0) return data;
        const txnsToInsert: any[] = [];
        for (const entry of entries) {
          const monthTxns = buildProjectTransactions({
            profileId,
            projectId: input.id,
            projectName,
            monthlyAllocation: entry.amount,
            sourceAccountId: sourceId,
            linkedAccountId: linkedId,
            date: entry.date,
            endDate: null,
            projetsCategoryId,
          });
          txnsToInsert.push(...monthTxns);
        }
        if (txnsToInsert.length > 0) {
          const { error: insErr } = await supabase.from('transactions').insert(txnsToInsert);
          if (insErr) console.warn('Erreur régénération txns ponctuel:', insErr);
        }
        return data;
      }

      // 3b. Mensuel / date cible : régénérer depuis la date de début
      const monthlyAlloc = input.monthly_allocation !== undefined ? input.monthly_allocation : Number(data.monthly_allocation);
      if (!monthlyAlloc || monthlyAlloc <= 0) return data;

      const paymentDay = input.transaction_day ?? data.transaction_day ?? new Date().getDate();
      let startDate: string;
      if (input.first_payment_date) {
        startDate = input.first_payment_date;
      } else {
        const { data: firstTxn } = await supabase
          .from('transactions')
          .select('date')
          .eq('project_id', input.id)
          .eq('profile_id', profileId)
          .order('date', { ascending: true })
          .limit(1);
        startDate = firstTxn?.[0]?.date ?? (() => {
          const now = new Date();
          return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`;
        })();
      }

      const cursor = new Date(startDate + 'T00:00:00');
      const endLimit = endDate ? new Date(endDate + 'T23:59:59') : null;
      const maxMonths = 24;
      const txnsToInsert: any[] = [];

      for (let i = 0; i < maxMonths; i++) {
        if (endLimit && cursor > endLimit) break;

        const txDate = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;

        // Ne pas recréer de brouillon sur un mois qui a déjà une transaction validée (préservée).
        if (validatedMonths.has(txDate.slice(0, 7))) { cursor.setMonth(cursor.getMonth() + 1); continue; }

        const monthTxns = buildProjectTransactions({
          profileId,
          projectId: input.id,
          projectName,
          monthlyAllocation: monthlyAlloc,
          sourceAccountId: sourceId,
          linkedAccountId: linkedId,
          date: txDate,
          endDate: endDate || null,
          projetsCategoryId,
        });
        txnsToInsert.push(...monthTxns);

        cursor.setMonth(cursor.getMonth() + 1);
      }

      if (txnsToInsert.length > 0) {
        const { error: insErr } = await supabase.from('transactions').insert(txnsToInsert);
        if (insErr) console.warn('Erreur régénération txns projet:', insErr);
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

export function useCheckProjectTransactions(profileId: string | undefined) {
  return {
    check: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const today = new Date().toISOString().split('T')[0];
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
      return { past, future, validated, drafts };
    },
  };
}

/**
 * Suppression « douce » du projet (comportement par défaut) :
 *  - les transactions VALIDÉES (is_draft=false) sont DÉTACHÉES (project_id → null) → elles
 *    deviennent de simples virements classiques (l'argent reste sur les comptes) ;
 *  - les BROUILLONS (is_draft=true, jamais validés, sans impact sur les soldes) sont supprimés ;
 *  - le projet est supprimé.
 */
export function useDeleteProjectDissociating(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');

      // 1. Détacher les validées (les 2 jambes d'un virement portent project_id) → virements classiques.
      const { error: unlinkErr } = await supabase
        .from('transactions')
        .update({ project_id: null })
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .eq('is_draft', false);
      if (unlinkErr) throw unlinkErr;

      // 2. Supprimer les brouillons restants (aucun impact solde → simple suppression via le helper).
      const { data: drafts } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .eq('is_draft', true);
      await reverseBalanceAndDeleteTransactions(profileId, (drafts ?? []) as any);

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
      // Supprimer les transactions liées en RÉVERSANT le solde des lignes validées (posted).
      const { data: toDelete } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
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

      const { data: toDelete } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', lockDate);
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
      const today = new Date().toISOString().split('T')[0];
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
      const { data: toDelete } = await supabase
        .from('transactions')
        .select(TX_REVERSAL_COLS)
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gte('date', fromDate);
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
      const today = new Date().toISOString().split('T')[0];

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
