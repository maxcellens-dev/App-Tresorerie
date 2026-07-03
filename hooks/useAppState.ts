// Assemble les signaux de l'app → LA prochaine action utile (via appStateEngine).
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from './usePilotageData';
import { useAllAccounts } from './useAccounts';
import { useTransactions } from './useTransactions';
import { useMonthlyClosure } from './useMonthlyClosure';
import { useSharedContribution } from './useSharedContribution';
import { useReliabilityConfig, deriveRelykaConfidence } from './useReliability';
import { isRegul } from '../lib/regul';
import { getCurrentAction, type AppAction } from '../lib/appStateEngine';
import { CURRENCY_SYMBOL } from '../lib/currency';

export function useAppState(): AppAction | null {
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const { data: sharedContrib } = useSharedContribution(user?.id);
  const { data: relCfg } = useReliabilityConfig();

  return useMemo(() => {
    if (!pilotage) return null;
    const relyka = Math.max(0, pilotage.safe_to_spend);
    const conf = relCfg ? deriveRelykaConfidence(pilotage, relyka, relCfg) : null;

    const txs = transactions as any[];
    const hasBalance =
      (accounts as any[]).some((a) => a.type === 'checking' && Number(a.balance) !== 0) || txs.some(isRegul);
    const hasIncome =
      pilotage.expected_income_source !== 'none' ||
      txs.some((t) => Number(t.amount) > 0 && t.is_recurring && !t.linked_account_id);
    const hasFixed = txs.some(
      (t) => Number(t.amount) < 0 && t.is_recurring && !t.linked_account_id && !t.project_id,
    );

    // Compte partagé/joint sans mode défini (à qualifier une fois ; on ignore les comptes en consultation).
    const sharedNoMode = (accounts as any[]).find(
      (a) =>
        (a.is_joint || (a.profile_id && a.profile_id !== user?.id)) &&
        a.shared_mode == null &&
        a._role !== 'read',
    );
    const sharedModePrompt = sharedNoMode ? { accountId: sharedNoMode.id, name: sharedNoMode.name } : null;

    // Surveillance de niveau (mode Contribution) : le solde prévisionnel du joint passe-t-il < 0 ?
    // Soldes et flux sont pondérés par le même facteur → le SIGNE du prévisionnel est préservé.
    let jointLow: { accountId: string; name: string } | null = null;
    const perMonth = (rule: string, amt: number) =>
      rule === 'weekly' ? amt * 4.33 : rule === 'monthly' ? amt : rule === 'quarterly' ? amt / 3 : rule === 'yearly' ? amt / 12 : 0;
    for (const a of (sharedContrib?.accounts ?? []) as any[]) {
      if (sharedContrib?.modeByAccount?.[a.id] !== 'contribution') continue;
      let net = 0;
      for (const t of (sharedContrib?.transactions ?? []) as any[]) {
        if (t.account_id !== a.id || !t.is_recurring || !t.recurrence_rule) continue;
        net += perMonth(t.recurrence_rule, Number(t.amount));
      }
      if (Number(a.balance) + net < 0) { jointLow = { accountId: a.id, name: a.name }; break; }
    }

    return getCurrentAction({
      hasBalance,
      hasIncome,
      hasFixed,
      pendingClosureMonth: pendingMonths[0] ?? null,
      sharedModePrompt,
      confidenceLow: conf?.result.level === 'low',
      daysSinceVerification: conf?.result.daysSinceVerification ?? 0,
      jointLow,
      relykaText: `~${Math.round(relyka).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`,
      closureEnabled,
    });
  }, [pilotage, accounts, transactions, pendingMonths, relCfg, closureEnabled, sharedContrib, user?.id]);
}
