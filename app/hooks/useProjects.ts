import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Project } from '../types/database';

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
}): any[] {
  const { profileId, projectId, projectName, monthlyAllocation, sourceAccountId, linkedAccountId, date, endDate } = opts;
  const sameAccount = sourceAccountId && linkedAccountId && sourceAccountId === linkedAccountId;
  const txns: any[] = [];

  if (sameAccount) {
    // Même compte → 1 seule écriture "réservation" (amount=0, note descriptive)
    txns.push({
      profile_id: profileId,
      account_id: sourceAccountId,
      category_id: null,
      amount: 0,
      date,
      note: `🔒 ${projectName} · ${monthlyAllocation.toFixed(0)} €/mois`,
      is_forecast: false,
      is_recurring: false,
      recurrence_rule: null,
      recurrence_end_date: null,
      project_id: projectId,
    });
  } else {
    // Comptes différents → débit + crédit
    if (sourceAccountId) {
      txns.push({
        profile_id: profileId,
        account_id: sourceAccountId,
        category_id: null,
        amount: -monthlyAllocation,
        date,
        note: projectName,
        is_forecast: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: projectId,
      });
    }
    if (linkedAccountId) {
      txns.push({
        profile_id: profileId,
        account_id: linkedAccountId,
        category_id: null,
        amount: monthlyAllocation,
        date,
        note: projectName,
        is_forecast: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: projectId,
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
      target_date?: string;
      current_accumulated?: number;
      source_account_id?: string;
      linked_account_id?: string;
      transaction_day?: number;
      first_payment_date?: string;
    }) => {
      if (!supabase || !profileId) throw new Error('Not authenticated');
      const payload = {
        profile_id: profileId,
        name: input.name,
        description: input.description || null,
        target_amount: input.target_amount,
        monthly_allocation: input.monthly_allocation,
        target_date: input.target_date || null,
        current_accumulated: input.current_accumulated || 0,
        source_account_id: input.source_account_id || null,
        linked_account_id: input.linked_account_id || null,
        transaction_day: input.transaction_day || null,
        status: 'active',
      };
      console.log('Inserting project:', payload);
      const { data, error } = await supabase
        .from('projects')
        .insert(payload)
        .select()
        .single();
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      // Créer les transactions mensuelles du projet
      if (data && input.monthly_allocation > 0) {
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
      target_date?: string | null;
      current_accumulated?: number;
      source_account_id?: string | null;
      linked_account_id?: string | null;
      transaction_day?: number | null;
      first_payment_date?: string;
      status?: string;
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
          ...(input.target_date !== undefined && { target_date: input.target_date }),
          ...(input.current_accumulated !== undefined && { current_accumulated: input.current_accumulated }),
          ...(input.source_account_id !== undefined && { source_account_id: input.source_account_id }),
          ...(input.linked_account_id !== undefined && { linked_account_id: input.linked_account_id }),
          ...(input.transaction_day !== undefined && { transaction_day: input.transaction_day }),
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
      const monthlyAlloc = input.monthly_allocation !== undefined ? input.monthly_allocation : Number(data.monthly_allocation);
      const sourceId = input.source_account_id !== undefined ? input.source_account_id : data.source_account_id;
      const linkedId = input.linked_account_id !== undefined ? input.linked_account_id : data.linked_account_id;
      const endDate = input.target_date !== undefined ? input.target_date : data.target_date;

      // 2. Récupérer la date de la première transaction existante (= date de début réelle)
      const { data: firstTxn } = await supabase
        .from('transactions')
        .select('date')
        .eq('project_id', input.id)
        .eq('profile_id', profileId)
        .order('date', { ascending: true })
        .limit(1);
      const existingStartDate = firstTxn?.[0]?.date ?? null;

      // 3. Supprimer TOUTES les transactions du projet (passées + futures)
      const { error: delErr } = await supabase
        .from('transactions')
        .delete()
        .eq('project_id', input.id)
        .eq('profile_id', profileId);
      if (delErr) console.warn('Erreur suppression txns projet:', delErr);

      // 4. Régénérer toutes les transactions depuis la date de début
      if (!monthlyAlloc || monthlyAlloc <= 0) return data;

      const paymentDay = input.transaction_day ?? data.transaction_day ?? new Date().getDate();

      // Déterminer la date de début
      let startDate: string;
      if (input.first_payment_date) {
        startDate = input.first_payment_date;
      } else if (existingStartDate) {
        startDate = existingStartDate;
      } else {
        const now = new Date();
        startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(paymentDay).padStart(2, '0')}`;
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
 * et dont la dernière transaction liée est dans le passé (>= 1 jour).
 */
export function useAutoArchiveProjects(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (projects: Project[]) => {
      if (!supabase || !profileId) return;

      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

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
        if (!lastDate || lastDate <= yesterdayStr) {
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
