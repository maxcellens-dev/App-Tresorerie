/**
 * Financial Runway - Safe-to-Spend & Future Impact
 * Philosophy: Inform, don't restrict.
 * Safe-to-Spend = Current Liquidity - Sum of "Committed" future expenses
 */

import { useMemo } from 'react';

export type FinancialHealthStatus = 'safe' | 'warning' | 'danger';

export interface TransactionInput {
  amount: number;
  date: string; // YYYY-MM-DD
  is_forecast?: boolean;
  is_reconciled?: boolean;
  type?: 'income' | 'expense';
}

export interface FinancialHealthResult {
  /** Safe-to-Spend amount (can be negative) */
  safeToSpend: number;
  /** Current liquidity (sum of account balances or passed value) */
  currentLiquidity: number;
  /** Sum of committed future expenses (negative outflows) */
  committedFutureExpenses: number;
  status: FinancialHealthStatus;
  /** Human message for "Future Impact Warning" when status is not safe */
  futureImpactMessage: string | null;
}

const DEFAULT_SAFETY_THRESHOLD = 0;
const WARNING_MULTIPLIER = 0.5; // Orange when below 50% of threshold

/**
 * Compute status from safeToSpend and optional safety threshold.
 * Green (safe): safeToSpend >= threshold
 * Orange (warning): safeToSpend in (threshold * factor, threshold)
 * Red (danger): safeToSpend < threshold * factor or negative
 */
export function getStatusFromSafeToSpend(
  safeToSpend: number,
  safetyThreshold: number = DEFAULT_SAFETY_THRESHOLD
): FinancialHealthStatus {
  if (safeToSpend >= safetyThreshold) return 'safe';
  const warningLevel = safetyThreshold * WARNING_MULTIPLIER;
  if (safeToSpend >= warningLevel && safeToSpend < safetyThreshold) return 'warning';
  return 'danger';
}

export function getFutureImpactMessage(
  status: FinancialHealthStatus,
  safeToSpend: number,
  localeMonth?: string
): string | null {
  if (status === 'safe') return null;
  const month = localeMonth ?? 'prochain mois';
  if (status === 'danger') {
    return `Attention : vos dépenses prévues feront passer votre solde projeté en ${month} sous votre seuil de sécurité.`;
  }
  return `Note : cette dépense réduira votre solde projeté en ${month} sous votre seuil de confort.`;
}

/**
 * Sum of committed future expenses (today exclusive): only negative outflows
 * that are not reconciled (or we consider all future expenses as "committed").
 */
function sumCommittedFutureExpenses(
  transactions: TransactionInput[],
  today: string
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.date <= today) continue;
    const amount = Number(t.amount);
    const isOutflow = amount < 0 || t.type === 'expense';
    if (isOutflow && amount !== 0) {
      sum += Math.abs(amount);
    }
  }
  return -sum; // negative = outflow
}

export interface UseFinancialHealthParams {
  /** Current liquidity (e.g. sum of account balances) */
  currentLiquidity: number;
  /** Future transactions (expenses/income) */
  transactions: TransactionInput[];
  /** User's safety threshold (min desired balance) */
  safetyThreshold?: number;
  /** Reference date YYYY-MM-DD (default: today) */
  referenceDate?: string;
}

/**
 * Hook: computes Safe-to-Spend and status.
 * Use for badge (Green / Orange / Red) and optional Future Impact Warning.
 */
export function useFinancialHealth({
  currentLiquidity,
  transactions,
  safetyThreshold = DEFAULT_SAFETY_THRESHOLD,
  referenceDate = new Date().toISOString().slice(0, 10),
}: UseFinancialHealthParams): FinancialHealthResult {
  return useMemo(() => {
    const committed = sumCommittedFutureExpenses(transactions, referenceDate);
    const safeToSpend = currentLiquidity + committed; // committed is negative
    const status = getStatusFromSafeToSpend(safeToSpend, safetyThreshold);
    const futureImpactMessage = getFutureImpactMessage(status, safeToSpend);

    return {
      safeToSpend,
      currentLiquidity,
      committedFutureExpenses: committed,
      status,
      futureImpactMessage,
    };
  }, [
    currentLiquidity,
    transactions,
    safetyThreshold,
    referenceDate,
  ]);
}
