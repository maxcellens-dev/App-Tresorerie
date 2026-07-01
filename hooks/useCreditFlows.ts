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
import { computeAmortization, addMonthsISO } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import type { Credit } from '../types/database';

const CAT_REPAY = { name: 'Crédits', type: 'expense', is_variable: false };
const CAT_INSURANCE = { name: 'Assurance Crédit', type: 'expense', is_variable: false };

/** Facteur d'impact d'un compte (1 = perso/100%, sinon _impact_pct/100 pour un compte partagé). */
function accountFactor(a: any): number {
  return a && a._impact_pct != null ? a._impact_pct / 100 : 1;
}

/**
 * Transactions virtuelles (sorties mensuelles) des crédits, à partir du mois courant.
 * @param scaled  true (défaut) : montants pondérés par le % d'impact du compte → vue AGRÉGATS PERSO
 *                (pilotage/projection/tréso). false : montant RÉEL complet → vue COMPTE / liste des
 *                transactions (le compte représente ce qu'il est, indépendamment de ma part d'impact).
 */
export function useCreditFlows(profileId: string | undefined, scaled: boolean = true) {
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
      if (!acc) continue; // compte non accessible → pas d'affichage possible
      // Affichage compte (non scaled) : montant complet, TOUJOURS visible (même si mon impact = 0 %).
      // Agrégats perso (scaled) : pondéré par l'impact ; impact 0 % → n'impacte pas mes agrégats.
      const f = scaled ? accountFactor(acc) : 1;
      if (scaled && f <= 0) continue;
      const cur = acc?.currency || 'EUR';
      const amort = computeAmortization({ ...c, events: eventsByCredit[c.id] ?? null });
      // L'assurance peut être prélevée à une date différente du remboursement → date dédiée.
      const insFirst = c.first_insurance_date || c.first_payment_date || c.start_date;
      for (const r of amort.schedule) {
        if (r.payment > 0 && r.date >= horizonStart) flows.push(mkFlow(c, r.period, 'pay', -(r.payment * f), r.date, CAT_REPAY, cur));
        if (r.insurance > 0) {
          const insDate = addMonthsISO(insFirst, r.period - 1);
          if (insDate >= horizonStart) flows.push(mkFlow(c, r.period, 'ins', -(r.insurance * f), insDate, CAT_INSURANCE, cur));
        }
      }
    }
    return flows;
  }, [credits, accounts, eventsByCredit, scaled]);
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
  if (!c.is_active || !c.account_id || !account) return []; // compte non accessible → pas d'impact
  const f = accountFactor(account);
  if (f <= 0) return [];
  const currency = account?.currency || 'EUR';
  const amort = computeAmortization({ ...c, events: events ?? null });
  if (!amort.schedule.length) return [];
  const n = amort.schedule.length;
  const firstDate = amort.schedule[0].date;
  const lastDate = amort.schedule[n - 1].date;
  const insFirst = c.first_insurance_date || c.first_payment_date || c.start_date;
  const insLast = addMonthsISO(insFirst, n - 1);
  const horizon = todayISO().slice(0, 8) + '01';
  const row = amort.schedule.find((r) => r.date >= horizon) ?? amort.schedule[n - 1];
  const mk = (kind: string, amt: number, category: any, date: string, end: string) => ({
    id: `creditpilot-${c.id}-${kind}`, account_id: c.account_id, amount: -(amt * f), date,
    is_recurring: true, recurrence_rule: 'monthly', recurrence_end_date: end,
    category, is_credit_flow: true, credit_id: c.id, note: `${category.name} — ${c.label}`, account: { currency },
  });
  const out: any[] = [];
  if (row.payment > 0) out.push(mk('pay', row.payment, CAT_REPAY, firstDate, lastDate));
  if (row.insurance > 0) out.push(mk('ins', row.insurance, CAT_INSURANCE, insFirst, insLast));
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
