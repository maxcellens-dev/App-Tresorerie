// Module Crédit — FLUX des mensualités (visibles + catégorisés), injectés dans tréso/projection/pilotage
// et la liste des transactions.
//
// Chaque mensualité produit DEUX écritures : remboursement (catégorie « Crédits ») et assurance
// (catégorie « Assurance Crédit »). Montants dérivés du tableau d'amortissement (variations annuelles +
// événements inclus). Si le compte de prélèvement est PARTAGÉ/JOINT, on applique le % d'impact de l'user.
import { useMemo } from 'react';
import { useCredits } from './useCredits';
import { useAllAccounts } from './useAccounts';
import { useAllCreditEvents, type CreditEventRow } from './useCreditEvents';
import { computeAmortization } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import type { Credit } from '../types/database';

const CAT_REPAY = { name: 'Crédits', type: 'expense', is_variable: false };
const CAT_INSURANCE = { name: 'Assurance Crédit', type: 'expense', is_variable: false };

/** Facteur d'impact d'un compte (1 = perso/100%, sinon _impact_pct/100 pour un compte partagé). */
function accountFactor(a: any): number {
  return a && a._impact_pct != null ? a._impact_pct / 100 : 1;
}

/** Transactions virtuelles (sorties mensuelles) des crédits, à partir du mois courant. */
export function useCreditFlows(profileId: string | undefined) {
  const { data: credits = [] } = useCredits(profileId);
  const { data: accounts = [] } = useAllAccounts(profileId);
  const { data: eventsByCredit = {} } = useAllCreditEvents(profileId);

  return useMemo(() => {
    const acctById: Record<string, any> = {};
    accounts.forEach((a) => { acctById[a.id] = a; });
    const horizonStart = todayISO().slice(0, 8) + '01'; // passé = vraies transactions (anti double-compte)
    const flows: any[] = [];
    for (const c of credits) {
      if (!c.is_active || !c.account_id) continue;
      const acc = acctById[c.account_id];
      const f = accountFactor(acc);
      if (f <= 0) continue;
      const cur = acc?.currency || 'EUR';
      const amort = computeAmortization({ ...c, events: eventsByCredit[c.id] ?? null });
      for (const r of amort.schedule) {
        if (r.date < horizonStart) continue;
        if (r.payment > 0) flows.push(mkFlow(c, r.period, 'pay', -(r.payment * f), r.date, CAT_REPAY, cur));
        if (r.insurance > 0) flows.push(mkFlow(c, r.period, 'ins', -(r.insurance * f), r.date, CAT_INSURANCE, cur));
      }
    }
    return flows;
  }, [credits, accounts, eventsByCredit]);
}

function mkFlow(c: Credit, period: number, kind: string, amount: number, date: string, category: any, currency: string) {
  return {
    id: `credit-${c.id}-${period}-${kind}`,
    account_id: c.account_id,
    amount,
    date,
    note: `${category.name} — ${c.label}`,
    category,
    is_draft: false,
    is_recurring: false,
    is_credit_flow: true,
    credit_id: c.id,
    account: { currency },
  };
}

/**
 * Représentation PILOTAGE : 2 récurrentes synthétiques mensuelles par crédit (remboursement + assurance,
 * catégorisées), montant du mois courant, bornées par la durée, pondérées par le % d'impact du compte.
 * Pure → réutilisable client + fetch pilotage.
 */
export function buildCreditPilotTxs(c: Credit, events: CreditEventRow[] | undefined, account: any): any[] {
  if (!c.is_active || !c.account_id) return [];
  const f = accountFactor(account);
  if (f <= 0) return [];
  const currency = account?.currency || 'EUR';
  const amort = computeAmortization({ ...c, events: events ?? null });
  if (!amort.schedule.length) return [];
  const firstDate = amort.schedule[0].date;
  const lastDate = amort.schedule[amort.schedule.length - 1].date;
  const horizon = todayISO().slice(0, 8) + '01';
  const cur = amort.schedule.find((r) => r.date >= horizon) ?? amort.schedule[amort.schedule.length - 1];
  const mk = (kind: string, amt: number, category: any) => ({
    id: `creditpilot-${c.id}-${kind}`, account_id: c.account_id, amount: -(amt * f), date: firstDate,
    is_recurring: true, recurrence_rule: 'monthly', recurrence_end_date: lastDate,
    category, is_credit_flow: true, credit_id: c.id, note: `${category.name} — ${c.label}`, account: { currency: cur },
  });
  const out: any[] = [];
  if (cur.payment > 0) out.push(mk('pay', cur.payment, CAT_REPAY));
  if (cur.insurance > 0) out.push(mk('ins', cur.insurance, CAT_INSURANCE));
  return out;
}

/** Templates récurrents de crédit pour le PILOTAGE (cursors + modaux). */
export function useCreditPilotTemplates(profileId: string | undefined) {
  const { data: credits = [] } = useCredits(profileId);
  const { data: accounts = [] } = useAllAccounts(profileId);
  const { data: eventsByCredit = {} } = useAllCreditEvents(profileId);
  return useMemo(() => {
    const acctById: Record<string, any> = {};
    accounts.forEach((a) => { acctById[a.id] = a; });
    return credits.flatMap((c) => buildCreditPilotTxs(c, eventsByCredit[c.id], acctById[c.account_id ?? '']));
  }, [credits, accounts, eventsByCredit]);
}
