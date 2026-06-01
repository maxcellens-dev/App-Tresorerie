import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';
import { CURRENCY_SYMBOL } from '../lib/currency';

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
    });
  } else {
    // Seul le débit est créé ; le crédit est généré à la validation dans l'écran Transactions
    if (sourceAccountId) {
      txns.push({
        profile_id: profileId,
        account_id: sourceAccountId,
        category_id: projetsCategoryId,
        amount: -monthlyAllocation,
        date,
        note: projectName,
        is_forecast: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: projectId,
        is_draft: true,
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

      // Simple changement de statut → pas de sync des transactions
      if (input.status && !input.name && input.monthly_allocation === undefined) return data;

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

      // 2. Supprimer les transactions du projet à régénérer.
      //    Ponctuel : préserver les mois PASSÉS (avant le mois courant) — on ne supprime
      //    que le mois courant et les mois futurs. Mensuel / date : régénération complète.
      const nowDel = new Date();
      const currentMonthStart = `${nowDel.getFullYear()}-${String(nowDel.getMonth() + 1).padStart(2, '0')}-01`;
      let delQuery = supabase
        .from('transactions')
        .delete()
        .eq('project_id', input.id)
        .eq('profile_id', profileId);
      if (allocType === 'ponctuel') {
        delQuery = delQuery.gte('date', currentMonthStart);
      }
      const { error: delErr } = await delQuery;
      if (delErr) console.warn('Erreur suppression txns projet:', delErr);

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
      const { data: pastTxns, error: e1 } = await supabase
        .from('transactions')
        .select('id, date')
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .lte('date', today);
      if (e1) throw e1;
      const { data: futureTxns, error: e2 } = await supabase
        .from('transactions')
        .select('id, date')
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gt('date', today);
      if (e2) throw e2;
      return { past: pastTxns ?? [], future: futureTxns ?? [] };
    },
  };
}

export function useDeleteProjectFull(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      // Delete all linked transactions first
      const { error: txErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', projectId)
        .eq('profile_id', profileId);
      if (txErr) throw txErr;
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

      // 1. Supprimer les transactions >= fromDate
      const { error: delErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', projectId)
        .eq('profile_id', profileId)
        .gte('date', fromDate);
      if (delErr) throw delErr;

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
 * Vérifie les projets actifs et archive automatiquement ceux qui sont à 100 %
 * et dont la dernière transaction liée est dans le passé (>= 72h / 3 jours).
 */
export function useAutoArchiveProjects(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projects: Project[]) => {
      if (!supabase || !profileId) return;

      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 3); // 72h
      const cutoffStr = cutoff.toISOString().split('T')[0];

      const activeProjects = projects.filter(
        (p) => p.status === 'active' || p.status === 'completed'
      );

      for (const project of activeProjects) {
        const target = Number(project.target_amount);
        const accumulated = Number(project.current_accumulated || 0);
        if (target <= 0 || accumulated < target) continue; // pas encore 100%

        // Vérifier la dernière transaction
        const { data: lastTxn } = await supabase
          .from('transactions')
          .select('date')
          .eq('project_id', project.id)
          .eq('profile_id', profileId)
          .order('date', { ascending: false })
          .limit(1);

        const lastDate = lastTxn?.[0]?.date;
        if (!lastDate || lastDate <= cutoffStr) {
          // Archiver automatiquement
          await supabase
            .from('projects')
            .update({ status: 'archived' })
            .eq('id', project.id)
            .eq('profile_id', profileId);
        }
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [PROJECTS_KEY, profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}
