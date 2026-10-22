/**
 * Enregistrement d'une saisie (dépense, recette, virement — récurrente ou non) : garde-fous
 * communs — consultation admin en lecture seule, verrou synchrone contre le double appui, mois
 * clôturé, question « déjà comptée dans ce solde ? » posée AVANT de rendre la main — puis écriture
 * en arrière-plan (navigation optimiste, échec signalé par une alerte globale).
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { createTransferLegs, useAddTransaction, useAskRegulCoverage, useDeleteTransaction } from './useTransactions';
import { useMonthlyClosure } from '../pilotage/useMonthlyClosure';
import { useSubmitLock } from '../platform/useSubmitLock';
import { useReadOnlyGuard } from '../platform/useReadOnlyGuard';
import { parseUsageLimitError } from '../../lib/finance/usageLimits';
import { formatDateFrench } from '../../lib/dateUtils';
import { appAlert } from '../../lib/ui/appDialog';
import type { RecurrenceRule } from '../../types/database';

export interface QuickTx {
  accountId: string;
  /** Virement : le compte crédité (pas de catégorie). */
  toAccountId?: string;
  categoryId?: string | null;
  /** Montant SIGNÉ : négatif pour une dépense, positif pour une recette ou un remboursement ;
   *  virement : montant POSITIF débité de la source. */
  amount: number;
  /** Virement entre deux devises : montant POSITIF réellement crédité sur la destination. */
  amountTo?: number;
  date: string;
  note?: string;
  /** Virement : libellés par défaut de chaque jambe (« Virement vers … » / « … depuis … »). */
  noteFrom?: string;
  noteTo?: string;
  recurrence?: RecurrenceRule | null;
  recurrenceEndDate?: string | null;
  isDraft?: boolean;
  projectId?: string | null;
  /** Virement futur rattaché à un projet : UNE jambe en brouillon (échéance à valider du projet). */
  projectDraft?: boolean;
  onBehalfMemberId?: string | null;
  /** Suites à jouer une fois l'écriture réussie (ids des lignes insérées hors virement). */
  after?: (insertedIds: string[]) => Promise<unknown> | void;
}

export function useQuickSave() {
  const { user } = useAuth();
  const client = useQueryClient();
  const addTransaction = useAddTransaction(user?.id);
  const deleteTransaction = useDeleteTransaction(user?.id);
  const askRegulCoverage = useAskRegulCoverage(user?.id);
  const { lockDate } = useMonthlyClosure(user?.id);
  const submitLock = useSubmitLock();
  const roGuard = useReadOnlyGuard();
  /* L'écran reste MONTÉ entre deux saisies (on en sort par un `replace` vers un autre onglet) : le
     verrou, gardé posé après un succès pour fermer la fenêtre de double appui pendant la sortie, se
     relâche au RETOUR sur l'écran. Dépendance `release` (stable), jamais l'objet entier. */
  useFocusEffect(useCallback(() => { submitLock.release(); }, [submitLock.release]));

  /**
   * Lance l'enregistrement. Renvoie `true` dès que l'écriture est partie (l'appelant quitte alors
   * l'écran), `false` si elle a été refusée sur place (message déjà affiché).
   */
  return useCallback(async (tx: QuickTx): Promise<boolean> => {
    if (lockDate && tx.date <= lockDate) {
      void appAlert({ title: 'Mois clôturé', message: `Impossible de saisir une opération au ${formatDateFrench(tx.date)} ou avant.` });
      return false;
    }
    if (roGuard.blocked()) return false;
    if (!submitLock.acquire()) return false;
    const isTransfer = !!tx.toAccountId;
    const signed = isTransfer ? -Math.abs(tx.amount) : tx.amount;
    const regulCoveredAnswer = tx.recurrence ? undefined : await askRegulCoverage(tx.accountId, tx.date, tx.note ?? null, signed);
    const recurring = !!tx.recurrence;

    const write = async (): Promise<string[]> => {
      if (isTransfer && tx.projectDraft) {
        const row = await addTransaction.mutateAsync({
          account_id: tx.accountId, category_id: null, amount: -Math.abs(tx.amount), date: tx.date,
          note: tx.note || tx.noteFrom || undefined, linked_account_id: tx.toAccountId!, is_draft: true,
          is_recurring: false, recurrence_rule: null, recurrence_end_date: null, project_id: tx.projectId ?? null,
          checkRegulConflict: false, on_behalf_member_id: tx.onBehalfMemberId ?? null,
        });
        return (row as any)?.id ? [(row as any).id] : [];
      }
      if (isTransfer) {
        await createTransferLegs(addTransaction, deleteTransaction, {
          fromAccountId: tx.accountId,
          toAccountId: tx.toAccountId!,
          amount: Math.abs(tx.amount),
          amountTo: tx.amountTo,
          date: tx.date,
          noteFrom: tx.note || tx.noteFrom || 'Virement',
          noteTo: tx.note || tx.noteTo || 'Virement',
          isDraft: !!tx.isDraft,
          isRecurring: recurring,
          recurrenceRule: tx.recurrence ?? null,
          recurrenceEndDate: recurring ? tx.recurrenceEndDate ?? null : null,
          projectId: tx.projectId ?? null,
          checkRegulConflict: false,
          regulCoveredAnswer,
          onBehalfMemberId: tx.onBehalfMemberId ?? null,
        });
        return [];
      }
      const row = await addTransaction.mutateAsync({
        account_id: tx.accountId,
        category_id: tx.categoryId ?? null,
        amount: tx.amount,
        date: tx.date,
        note: tx.note || undefined,
        linked_account_id: null,
        is_draft: !!tx.isDraft,
        is_recurring: recurring,
        recurrence_rule: tx.recurrence ?? null,
        recurrence_end_date: recurring ? tx.recurrenceEndDate ?? null : null,
        project_id: tx.projectId ?? null,
        checkRegulConflict: false,
        regulCoveredAnswer,
        on_behalf_member_id: tx.onBehalfMemberId ?? null,
      });
      return (row as any)?.id ? [(row as any).id] : [];
    };

    write().then(
      async (ids) => {
        if (recurring) void client.invalidateQueries({ queryKey: ['recurring_transactions'] });
        await tx.after?.(ids);
      },
      (e: unknown) => {
        // L'écriture a échoué APRÈS le retour à l'écran d'origine : on relâche le verrou pour
        // permettre un nouvel essai depuis une nouvelle saisie.
        submitLock.release();
        if (parseUsageLimitError(e)) return; // le filet global affiche déjà le message convivial
        void appAlert({ title: 'Enregistrement impossible', message: e instanceof Error ? e.message : "L'opération n'a pas pu être enregistrée. Réessaie." });
      },
    ).catch(() => {});
    return true;
  }, [lockDate, roGuard, submitLock, askRegulCoverage, addTransaction, deleteTransaction, client]);
}
