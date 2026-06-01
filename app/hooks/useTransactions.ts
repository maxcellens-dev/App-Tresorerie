import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Transaction, TransactionWithDetails, RecurrenceRule } from '../types/database';

const KEY = 'transactions';

export function useTransactions(profileId: string | undefined) {
  const query = useQuery({
    queryKey: [KEY, profileId],
    queryFn: async (): Promise<TransactionWithDetails[]> => {
      if (!supabase || !profileId) return [];
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          account:accounts!account_id(name, type),
          category:categories!category_id(name, type),
          linked_account:accounts!linked_account_id(name, type)
        `)
        .eq('profile_id', profileId)
        .order('date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        amount: Number(r.amount),
        account: r.account ?? null,
        category: r.category ?? null,
        linked_account: r.linked_account ?? null,
      })) as TransactionWithDetails[];
    },
    enabled: !!profileId,
  });

  return query;
}

export function useAddTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      account_id: string;
      category_id: string | null;
      amount: number;
      date: string;
      note?: string;
      is_forecast?: boolean;
      is_draft?: boolean;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
      project_id?: string | null;
      linked_account_id?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          profile_id: profileId,
          account_id: input.account_id,
          category_id: input.category_id || null,
          amount: input.amount,
          date: input.date,
          note: input.note || null,
          is_forecast: input.is_forecast ?? false,
          is_draft: input.is_draft ?? false,
          is_recurring: input.is_recurring ?? false,
          recurrence_rule: input.recurrence_rule ?? null,
          recurrence_end_date: input.recurrence_end_date ?? null,
          project_id: input.project_id ?? null,
          linked_account_id: input.linked_account_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      // Les brouillons n'affectent pas le solde du compte
      if (!input.is_draft) {
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', input.account_id).single();
        if (acc) {
          await supabase.from('accounts').update({ balance: Number(acc.balance) + input.amount }).eq('id', input.account_id);
        }
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useUpdateTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      account_id?: string;
      category_id?: string | null;
      amount?: number;
      date?: string;
      note?: string | null;
      is_draft?: boolean;
      is_recurring?: boolean;
      recurrence_rule?: RecurrenceRule | null;
      recurrence_end_date?: string | null;
    }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: existing, error: fetchErr } = await supabase.from('transactions').select('account_id, amount, is_draft').eq('id', input.id).eq('profile_id', profileId).single();
      if (fetchErr || !existing) throw fetchErr || new Error('Transaction introuvable');
      const oldAccId = (existing as { account_id: string }).account_id;
      const oldAmount = Number((existing as { amount: number }).amount);
      const wasInDraft = Boolean((existing as { is_draft?: boolean }).is_draft);
      const isNowDraft = input.is_draft !== undefined ? input.is_draft : wasInDraft;

      // Soustraire l'ancienne valeur du solde seulement si la transaction n'était pas un brouillon
      const amountOrAccountChanged = input.amount !== undefined || input.account_id !== undefined;
      const shouldSubtractOld = !wasInDraft && amountOrAccountChanged && !isNowDraft;
      if (shouldSubtractOld) {
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', oldAccId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) - oldAmount }).eq('id', oldAccId);
      }

      const updates: Record<string, unknown> = {};
      if (input.account_id !== undefined) updates.account_id = input.account_id;
      if (input.category_id !== undefined) updates.category_id = input.category_id;
      if (input.amount !== undefined) updates.amount = input.amount;
      if (input.date !== undefined) updates.date = input.date;
      if (input.note !== undefined) updates.note = input.note;
      if (input.is_draft !== undefined) updates.is_draft = input.is_draft;
      if (input.is_recurring !== undefined) updates.is_recurring = input.is_recurring;
      if (input.recurrence_rule !== undefined) updates.recurrence_rule = input.recurrence_rule;
      if (input.recurrence_end_date !== undefined) updates.recurrence_end_date = input.recurrence_end_date;
      const { data, error } = await supabase.from('transactions').update(updates).eq('id', input.id).eq('profile_id', profileId).select().single();
      if (error) throw error;

      // Ajouter le nouveau montant au solde si :
      // - Mise à jour normale (non-brouillon → non-brouillon, montant/compte changé)
      // - OU validation d'un brouillon (brouillon → réel)
      const draftValidated = wasInDraft && !isNowDraft;
      const shouldAddNew = (!wasInDraft && !isNowDraft && amountOrAccountChanged) || draftValidated;
      if (shouldAddNew) {
        const newAccId = (input.account_id !== undefined ? input.account_id : oldAccId) as string;
        const newAmount = input.amount !== undefined ? input.amount : oldAmount;
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', newAccId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) + newAmount }).eq('id', newAccId);
      }
      return data;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    },
  });
}

export function useDeleteTransaction(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase || !profileId) throw new Error('Non connecté');
      const { data: row, error: fetchErr } = await supabase
        .from('transactions')
        .select('account_id, amount, is_draft, project_id, date, linked_account_id, note, category_id')
        .eq('id', id)
        .eq('profile_id', profileId)
        .single();
      if (fetchErr) throw fetchErr;

      const isDraft = !!(row as any).is_draft;
      const projectId = (row as any).project_id as string | null;
      const txDate = (row as any).date as string;
      const txAmount = Number((row as any).amount);
      const linkedAccountId = (row as any).linked_account_id as string | null;
      const txNote = (row as any).note as string | null;
      const txCategoryId = (row as any).category_id as string | null;
      const txAccountId = (row as { account_id: string }).account_id;

      // Chercher la transaction symétrique (l'autre côté d'un virement)
      // Priorité 1 : via linked_account_id (virements via transfer.tsx)
      let pairedId: string | null = null;
      if (linkedAccountId) {
        const { data: paired } = await supabase
          .from('transactions')
          .select('id, amount, is_draft')
          .eq('profile_id', profileId)
          .eq('account_id', linkedAccountId)
          .eq('linked_account_id', txAccountId)
          .eq('date', txDate)
          .eq('amount', -txAmount)
          .maybeSingle();
        pairedId = paired?.id ?? null;
      }
      // Priorité 2 : via note "Virement" + montant opposé + même date (virements via add.tsx)
      if (!pairedId && txCategoryId === null && txNote && /virement/i.test(txNote)) {
        const { data: paired } = await supabase
          .from('transactions')
          .select('id, amount, is_draft')
          .eq('profile_id', profileId)
          .eq('date', txDate)
          .eq('amount', -txAmount)
          .is('category_id', null)
          .neq('account_id', txAccountId)
          .maybeSingle();
        pairedId = paired?.id ?? null;
      }

      // Supprimer la transaction principale
      const { error: delErr } = await supabase.from('transactions').delete().eq('id', id).eq('profile_id', profileId);
      if (delErr) throw delErr;

      // Les brouillons n'ont jamais affecté le solde → ne pas l'ajuster à la suppression
      if (!isDraft) {
        const { data: acc } = await supabase.from('accounts').select('balance').eq('id', txAccountId).single();
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance) - txAmount }).eq('id', txAccountId);
      }

      // Supprimer le côté symétrique si trouvé
      if (pairedId) {
        const { data: pairedRow } = await supabase
          .from('transactions')
          .select('account_id, amount, is_draft')
          .eq('id', pairedId)
          .eq('profile_id', profileId)
          .maybeSingle();
        if (pairedRow) {
          await supabase.from('transactions').delete().eq('id', pairedId).eq('profile_id', profileId);
          if (!(pairedRow as any).is_draft) {
            const pairedAmt = Number((pairedRow as any).amount);
            const pairedAccId = (pairedRow as any).account_id as string;
            const { data: pairedAcc } = await supabase.from('accounts').select('balance').eq('id', pairedAccId).single();
            if (pairedAcc) await supabase.from('accounts').update({ balance: Number(pairedAcc.balance) - pairedAmt }).eq('id', pairedAccId);
          }
        }
      }

      // Recalcul de l'allocation mensuelle en mode "Date cible" si suppression d'un débit projet
      if (projectId && txAmount < 0) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: project } = await supabase
          .from('projects')
          .select('allocation_type, target_date, target_amount, source_account_id, linked_account_id, transaction_day, name')
          .eq('id', projectId)
          .eq('profile_id', profileId)
          .single();

        const isDateMode = project && project.target_date &&
          (project.allocation_type === 'date' || !project.allocation_type);
        if (isDateMode) {
          // Somme des débits passés et validés restants
          const { data: remainingTxns } = await supabase
            .from('transactions')
            .select('amount')
            .eq('project_id', projectId)
            .eq('profile_id', profileId)
            .eq('is_draft', false)
            .lt('amount', 0)
            .lte('date', today);

          const accumulated = (remainingTxns ?? []).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
          const remaining = Math.max(0, Number(project!.target_amount) - accumulated);
          const nowDate = new Date();

          // Cursor for generation: first payment day after today
          const paymentDay = project!.transaction_day ?? nowDate.getDate();
          const cursor = new Date(nowDate.getFullYear(), nowDate.getMonth(), paymentDay);
          if (cursor <= nowDate) cursor.setMonth(cursor.getMonth() + 1);
          const endLimit = new Date(project!.target_date! + 'T23:59:59');

          // Count months exactly as the generation loop would produce
          let monthsLeft = 0;
          const countCursor = new Date(cursor);
          while (countCursor <= endLimit) {
            monthsLeft++;
            countCursor.setMonth(countCursor.getMonth() + 1);
          }
          monthsLeft = Math.max(1, monthsLeft);
          const newMonthly = remaining / monthsLeft;

          const newFirstPaymentDate = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
          await supabase.from('projects').update({ monthly_allocation: newMonthly, first_payment_date: newFirstPaymentDate }).eq('id', projectId);

          // Supprimer les transactions futures brouillon du projet
          await supabase.from('transactions').delete()
            .eq('project_id', projectId).eq('profile_id', profileId)
            .eq('is_draft', true).gt('date', today);

          const { data: projetsCat } = await supabase.from('categories').select('id')
            .eq('profile_id', profileId).eq('name', 'Projets').eq('type', 'expense').maybeSingle();
          const projetsCategoryId = projetsCat?.id ?? null;
          const sameAccount = project!.source_account_id && project!.linked_account_id &&
            project!.source_account_id === project!.linked_account_id;
          const txnsToInsert: any[] = [];

          while (cursor <= endLimit) {
            const d = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            if (sameAccount) {
              txnsToInsert.push({
                profile_id: profileId, account_id: project!.source_account_id,
                category_id: projetsCategoryId, amount: 0, date: d,
                note: project!.name ?? null, is_forecast: false, is_recurring: false,
                recurrence_rule: null, recurrence_end_date: null,
                project_id: projectId, is_draft: true,
              });
            } else if (project!.source_account_id) {
              txnsToInsert.push({
                profile_id: profileId, account_id: project!.source_account_id,
                category_id: projetsCategoryId, amount: -newMonthly, date: d,
                note: project!.name ?? null, is_forecast: false, is_recurring: false,
                recurrence_rule: null, recurrence_end_date: null,
                project_id: projectId, is_draft: true,
              });
            }
            cursor.setMonth(cursor.getMonth() + 1);
          }
          if (txnsToInsert.length > 0) {
            await supabase.from('transactions').insert(txnsToInsert);
          }
        }
      }
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}

/**
 * Valider un brouillon lié à un projet → le transforme en virement réel entre les
 * deux comptes du projet (source → destination), en validant aussi le crédit associé.
 */
export function useValidateProjectDraft(profileId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (debitTx: { id: string; project_id: string; amount: number; date: string; account_id: string }) => {
      if (!supabase || !profileId) throw new Error('Non connecté');

      // Récupérer le projet pour avoir source et destination
      const { data: project, error: projErr } = await supabase
        .from('projects')
        .select('source_account_id, linked_account_id, name')
        .eq('id', debitTx.project_id)
        .eq('profile_id', profileId)
        .single();
      if (projErr || !project) throw new Error('Projet introuvable');

      const sourceId = project.source_account_id as string;
      const linkedId = project.linked_account_id as string;
      const debitAmt = Number(debitTx.amount); // négatif

      // 1. Valider le débit et le transformer en virement (linked_account_id = destination)
      await supabase
        .from('transactions')
        .update({ is_draft: false, linked_account_id: linkedId })
        .eq('id', debitTx.id)
        .eq('profile_id', profileId);

      // Mettre à jour le solde du compte source
      const { data: srcAcc } = await supabase.from('accounts').select('balance').eq('id', sourceId).single();
      if (srcAcc) await supabase.from('accounts').update({ balance: Number(srcAcc.balance) + debitAmt }).eq('id', sourceId);

      // 2. Créer le crédit sur le compte de destination
      const creditAmt = Math.abs(debitAmt);
      await supabase.from('transactions').insert({
        profile_id: profileId,
        account_id: linkedId,
        category_id: null,
        amount: creditAmt,
        date: debitTx.date,
        note: project.name,
        is_draft: false,
        is_recurring: false,
        recurrence_rule: null,
        recurrence_end_date: null,
        project_id: debitTx.project_id,
        linked_account_id: sourceId,
      });

      // Mettre à jour le solde du compte destination
      const { data: dstAcc } = await supabase.from('accounts').select('balance').eq('id', linkedId).single();
      if (dstAcc) await supabase.from('accounts').update({ balance: Number(dstAcc.balance) + creditAmt }).eq('id', linkedId);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [KEY, profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
      client.invalidateQueries({ queryKey: ['projects', profileId] });
    },
  });
}
