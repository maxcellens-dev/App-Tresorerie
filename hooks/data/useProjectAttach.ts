/**
 * Rattachement d'une transaction MANUELLE à un projet (écran de saisie) — étapes POST-insertion :
 *
 *  1. Mode « date cible » + saisie VALIDÉE : le restant change → la MENSUALITÉ est recalculée et
 *     l'échéancier régénéré via useUpdateProject (qui préserve les mois déjà pourvus d'une
 *     transaction validée — skipMonths — dont celui de la saisie qu'on vient de faire).
 *
 *  2. ABSORPTION de l'échéance PLANIFIÉE du même mois (allocations 'monthly'/'date') : la saisie
 *     manuelle remplace l'échéance prévue, sinon le mois serait compté deux fois (tréso/projection
 *     verraient l'échéance générée + la saisie). En 'ponctuel', plusieurs versements par mois sont
 *     normaux → pas d'absorption.
 *     • mode 'transfer' : on supprime le BROUILLON du mois (les validées ne sont jamais touchées) ;
 *     • mode 'spend'    : on supprime la dépense générée FUTURE du mois (le passé est un fait acquis).
 *
 * La PROGRESSION du projet, elle, est dérivée des transactions (pilotage) → à jour automatiquement.
 * La suppression ultérieure de la saisie fait donc reculer l'avancement tout seul (2 sens).
 */
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/platform/supabase';
import { todayISO } from '../../lib/dateUtils';
import { projectMode } from '../../lib/finance/projectTx';
import { nextMonthlyAllocation } from '../../lib/finance/projectMatch';
import { useUpdateProject } from './useProjects';
import { reverseBalanceAndDeleteTransactions, recomputeBalances, TX_REVERSAL_COLS } from './useTransactions';
import type { Project } from '../../types/database';

/** Bornes (incluses) du mois d'une date ISO. */
function monthBounds(dateISO: string): { start: string; end: string } {
  const [y, m] = dateISO.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export function useProjectAttach(profileId: string | undefined) {
  const updateProject = useUpdateProject(profileId);
  const client = useQueryClient();

  /**
   * @param project            projet rattaché (la transaction vient d'être insérée avec son project_id)
   * @param amount             montant POSITIF de la saisie
   * @param date               date de la saisie
   * @param accumulatedBefore  € validés du projet AVANT cette saisie (pilotage : % × cible)
   * @param validated          la saisie est-elle VALIDÉE (false = brouillon d'échéance à valider)
   * @param insertedIds        id(s) des lignes qu'on vient d'insérer — jamais absorbées
   */
  return async function attachProject(o: {
    project: Project;
    amount: number;
    date: string;
    accumulatedBefore: number;
    validated: boolean;
    insertedIds: string[];
  }): Promise<void> {
    if (!supabase || !profileId) return;
    const p = o.project;
    const mode = projectMode(p);
    const today = todayISO();
    const allocType = ((p as any).allocation_type ?? 'monthly') as 'monthly' | 'date' | 'ponctuel';
    const inserted = new Set(o.insertedIds);

    // ── 1. Mensualité recalculée (mode « date cible », apport validé). La régénération de
    // l'échéancier qui en découle absorbe déjà les brouillons du mois (skipMonths).
    if (o.validated && allocType === 'date') {
      const newMonthly = nextMonthlyAllocation(p as any, o.accumulatedBefore + Math.abs(o.amount), today);
      if (newMonthly != null) {
        await updateProject.mutateAsync({ id: p.id, monthly_allocation: newMonthly });
      }
    }

    // ── 2. Absorption de l'échéance planifiée du même mois (hors 'ponctuel').
    let absorbed = false;
    if (allocType !== 'ponctuel') {
      const { start, end } = monthBounds(o.date);
      if (mode === 'transfer' || mode === 'reserve') {
        const { data: drafts } = await supabase
          .from('transactions').select(TX_REVERSAL_COLS)
          .eq('project_id', p.id).eq('profile_id', profileId).eq('is_draft', true)
          .gte('date', start).lte('date', end);
        const rows = ((drafts ?? []) as any[]).filter((t) => !inserted.has(t.id));
        if (rows.length > 0) { await reverseBalanceAndDeleteTransactions(profileId, rows as any); absorbed = true; }
      } else if (mode === 'spend') {
        // Seules les dépenses générées FUTURES sont remplaçables (le passé a réellement eu lieu).
        const { data: future } = await supabase
          .from('transactions').select(TX_REVERSAL_COLS)
          .eq('project_id', p.id).eq('profile_id', profileId).eq('is_draft', false)
          .is('linked_account_id', null).lt('amount', 0)
          .gt('date', today).gte('date', start).lte('date', end);
        const rows = ((future ?? []) as any[]).filter((t) => !inserted.has(t.id));
        if (rows.length > 0) {
          await reverseBalanceAndDeleteTransactions(profileId, rows as any);
          if (p.source_account_id) await recomputeBalances([p.source_account_id]);
          absorbed = true;
        }
      }
    }

    // Ce rattachement tourne EN ARRIÈRE-PLAN (la saisie a déjà rendu la main) → si une échéance a
    // été absorbée, on rafraîchit les caches nous-mêmes, sinon la liste garderait la ligne supprimée.
    if (absorbed) {
      client.invalidateQueries({ queryKey: ['transactions', profileId] });
      client.invalidateQueries({ queryKey: ['accounts', profileId] });
      client.invalidateQueries({ queryKey: ['pilotage_data', profileId] });
    }
  };
}
