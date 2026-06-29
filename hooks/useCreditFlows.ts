// Module Crédit — Lot C3 : FLUX DÉRIVÉ des mensualités, injecté dans tréso/projection.
//
// Décision produit : on ne crée PAS de vraies transactions récurrentes. On dérive du tableau
// d'amortissement une transaction VIRTUELLE par échéance (sur le compte de prélèvement), que la
// trésorerie et la projection fusionnent comme une sortie mensuelle. Le montant peut varier par année
// (mensualité + assurance). Inclut les crédits actifs (réels + simulations ACTIVÉES via is_active).
import { useMemo } from 'react';
import { useCredits } from './useCredits';
import { useAllAccounts } from './useAccounts';
import { useAllCreditEvents, type CreditEventRow } from './useCreditEvents';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import type { Credit } from '../types/database';

/**
 * Représentation du crédit pour le PILOTAGE : UNE transaction récurrente mensuelle synthétique (dépense
 * fixe « Crédit »), bornée par la durée. Montant = mensualité du mois courant (capital+intérêts+assurance).
 * Renvoie null si le crédit n'impacte pas (inactif, sans compte, soldé). Pure → réutilisable client+fetch.
 */
export function buildCreditPilotTx(c: Credit, events: CreditEventRow[] | undefined, currency: string): any | null {
  if (!c.is_active || !c.account_id) return null;
  const amort = computeAmortization({ ...c, events: events ?? null });
  if (!amort.schedule.length) return null;
  const firstDate = amort.schedule[0].date;
  const lastDate = amort.schedule[amort.schedule.length - 1].date;
  const horizon = todayISO().slice(0, 8) + '01';
  const cur = amort.schedule.find((r) => r.date >= horizon) ?? amort.schedule[amort.schedule.length - 1];
  const out = cur.payment + cur.insurance;
  if (out <= 0) return null;
  return {
    id: `creditpilot-${c.id}`,
    account_id: c.account_id,
    amount: -out,
    date: firstDate,
    is_recurring: true,
    recurrence_rule: 'monthly',
    recurrence_end_date: lastDate,
    category: { name: 'Crédit', type: 'expense', is_variable: false },
    is_credit_flow: true,
    credit_id: c.id,
    account: { currency },
  };
}

/** Templates récurrents de crédit pour le PILOTAGE (cursors + modaux). */
export function useCreditPilotTemplates(profileId: string | undefined) {
  const { data: credits = [] } = useCredits(profileId);
  const { data: accounts = [] } = useAllAccounts(profileId);
  const { data: eventsByCredit = {} } = useAllCreditEvents(profileId);
  return useMemo(() => {
    const curByAcct: Record<string, string> = {};
    accounts.forEach((a) => { curByAcct[a.id] = a.currency; });
    return credits
      .map((c) => buildCreditPilotTx(c, eventsByCredit[c.id], curByAcct[c.account_id ?? ''] || 'EUR'))
      .filter(Boolean);
  }, [credits, accounts, eventsByCredit]);
}

/** Transactions virtuelles (sorties) des mensualités de crédit, sur un horizon raisonnable. */
export function useCreditFlows(profileId: string | undefined) {
  const { data: credits = [] } = useCredits(profileId);
  const { data: accounts = [] } = useAllAccounts(profileId);
  const { data: eventsByCredit = {} } = useAllCreditEvents(profileId);

  return useMemo(() => {
    const curByAcct: Record<string, string> = {};
    accounts.forEach((a) => { curByAcct[a.id] = a.currency; });

    // À partir du 1er du mois courant : le PASSÉ est couvert par les vraies transactions (anti double-compte).
    const horizonStart = todayISO().slice(0, 8) + '01';
    const flows: any[] = [];
    for (const c of credits) {
      if (!c.is_active) continue;           // simulation non activée / crédit soldé → ignoré
      if (!c.account_id) continue;          // sans compte de prélèvement, pas d'impact trésorerie
      const amort = computeAmortization({ ...c, events: eventsByCredit[c.id] ?? null });
      for (const r of amort.schedule) {
        if (r.date < horizonStart) continue; // passé → géré par les vraies transactions
        const out = r.payment + r.insurance; // mensualité (capital+intérêts) + assurance
        if (out <= 0) continue;
        flows.push({
          id: `credit-${c.id}-${r.period}`,
          account_id: c.account_id,
          amount: -out,
          date: r.date,
          note: `Crédit — ${c.label}`,
          category: { name: 'Crédit', type: 'expense', is_variable: false },
          is_draft: false,
          is_recurring: false,
          is_credit_flow: true,
          credit_id: c.id,
          account: { currency: curByAcct[c.account_id] || 'EUR' },
        });
      }
    }
    return flows;
  }, [credits, accounts, eventsByCredit]);
}
