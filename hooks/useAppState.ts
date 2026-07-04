// Assemble les signaux de l'app → LA prochaine action utile (via appStateEngine).
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from './usePilotageData';
import { useAllAccounts } from './useAccounts';
import { useTransactions } from './useTransactions';
import { useMonthlyClosure } from './useMonthlyClosure';
import { useSharedContribution } from './useSharedContribution';
import { usePreSavings } from './usePreSavings';
import { useReservations } from './useReservations';
import { useOnboarding } from './useOnboarding';
import { useReliabilityConfig, deriveRelykaConfidence } from './useReliability';
import { isRegul } from '../lib/regul';
import { getCurrentAction, type AppAction } from '../lib/appStateEngine';
import { CURRENCY_SYMBOL, floorToTen } from '../lib/currency';

export function useAppState(): AppAction | null {
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const { enabled: closureEnabled, pendingMonths } = useMonthlyClosure(user?.id);
  const { data: sharedContrib } = useSharedContribution(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: relCfg } = useReliabilityConfig();
  const { allDone: onboardingDone } = useOnboarding(user?.id);

  return useMemo(() => {
    if (!pilotage) return null;
    // Relyka AFFICHÉ = même formule que le Pilotage (« Ton Relyka » / budget libre) — pas safe_to_spend,
    // qui est un agrégat différent : le bandeau doit annoncer le MÊME montant que la carte.
    const monthKey = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; })();
    const reservationsTotal = (reservations as any[])
      .filter((r) => (r.created_at ?? '').slice(0, 7) === monthKey)
      .reduce((s, r) => s + Number(r.montant), 0);
    const cumulsTotal = (preSavings?.epargne.total_cumule ?? 0) + (preSavings?.invest.total_cumule ?? 0);
    const cashflowTrough = pilotage.cashflow_trough ?? pilotage.current_checking_balance ?? 0;
    const relyka = Math.max(0,
      cashflowTrough
      - (pilotage.month_savings_future ?? 0)
      - (pilotage.month_invest_future ?? 0)
      - (pilotage.monthly_reserve_planned ?? 0)
      - reservationsTotal
      - cumulsTotal
      - (pilotage.variable_envelope_remaining ?? 0)
      - (pilotage.safety_margin_amount ?? 0)
    );
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

    // Compte courant principal (perso, solde le plus élevé) → deeplinks « solde » pré-remplis.
    const mainCheckingId = (accounts as any[])
      .filter((a) => a.type === 'checking' && a._role === 'owner' && !a.is_joint)
      .sort((a, b) => Number(b.balance) - Number(a.balance))[0]?.id ?? null;

    const action = getCurrentAction({
      hasBalance,
      hasIncome,
      hasFixed,
      pendingClosureMonth: pendingMonths[0] ?? null,
      sharedModePrompt,
      // Overlay « Vérifie ton solde » : confiance BASSE uniquement (en moyenne, le bandeau ambre de
      // la carte Relyka suffit — pas de doublon de messages).
      confidenceLow: conf?.result.level === 'low',
      daysSinceVerification: conf?.result.daysSinceVerification ?? 0,
      jointLow,
      // Même arrondi que la carte (dizaine inférieure) → le bandeau annonce le même chiffre.
      relykaText: `${floorToTen(relyka).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`,
      closureEnabled,
      mainCheckingId,
    });
    // Jamais « tout est à jour » quand les chiffres sont en fourchette (confiance non haute).
    if (action.type === 'ok' && conf && conf.result.level !== 'high') return null;
    // Pendant le guide « Pour bien démarrer », les étapes de setup sont déjà raillées par le guide
    // → pas de double sollicitation (le bandeau reprendra pour le quotidien une fois le guide fini).
    if (action.type === 'setup' && !onboardingDone) return null;
    return action;
  }, [pilotage, accounts, transactions, pendingMonths, relCfg, closureEnabled, sharedContrib, preSavings, reservations, onboardingDone, user?.id]);
}
