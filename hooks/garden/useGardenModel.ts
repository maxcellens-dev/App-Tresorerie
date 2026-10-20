/**
 * useGardenModel — tout ce que l'accueil du Jardin affiche, à partir des VRAIES données :
 * l'état de l'arbre, les choix de Pico, les chiffres de l'arrosoir.
 *
 * Il ne calcule rien de financier : il assemble des valeurs produites par les moteurs existants
 * (via usePilotageCore, les crédits et la gamification) et les passe aux fonctions pures du Jardin.
 */
import { useMemo } from 'react';
import { usePilotageCore } from './usePilotageCore';
import { useCredits } from '../data/useCredits';
import { useAllCreditEvents } from '../data/useCreditEvents';
import { useGamification } from '../engagement/useGamification';
import { computeAmortization } from '../../lib/finance/amortization';
import { computeInvestmentGains } from '../../lib/finance/investment';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import { todayISO } from '../../lib/dateUtils';
import { buildGardenInputs } from '../../lib/garden/gardenInputs';
import { computeTreeState } from '../../lib/garden/treeState';
import { buildPicoChoices } from '../../lib/garden/picoChoices';

export function useGardenModel() {
  const core = usePilotageCore();
  const { userId, pilotageData: p, vm } = core;
  const creditsQuery = useCredits(userId);
  const { data: eventsByCredit = {} } = useAllCreditEvents(userId);
  const gamification = useGamification(userId);

  const credits = useMemo(() => {
    const today = todayISO();
    return ((creditsQuery.data ?? []) as any[]).map((cr) => {
      let remaining = Number(cr.principal) || 0;
      try { remaining = computeAmortization({ ...cr, events: (eventsByCredit as any)[cr.id] ?? null }).crdAtDate(today); } catch { /* paramètres incomplets : le capital emprunté sert de repli */ }
      return { id: cr.id as string, label: cr.label as string, rateAnnual: Number(cr.rate_annual) || 0, principal: Number(cr.principal) || 0, remaining };
    });
  }, [creditsQuery.data, eventsByCredit]);

  const recoList = vm.recoList ?? [];
  const enjoyAmount = recoList.find((r) => r.type === 'enjoy')?.actionAmount ?? 0;
  const investmentGains = useMemo(() => computeInvestmentGains(core.txPerso as any).gains, [core.txPerso]);
  /** Placements = comptes d'investissement non archivés (un fruit chacun dès qu'ils ont une valeur). */
  const investments = useMemo(() => ((core.allAccounts ?? []) as any[])
    .filter((a) => a.type === 'investment' && !a.is_archived)
    .map((a) => ({ id: a.id as string, name: a.name as string, balance: Number(a.balance) || 0, currency: a.currency as string | undefined })),
  [core.allAccounts]);
  const investmentCount = investments.filter((a) => a.balance > 0).length;

  const inputs = useMemo(() => buildGardenInputs({
    pilotage: p ?? {},
    investmentGains,
    investmentCount,
    relyka: vm.relykaAffiche,
    enjoyAmount,
    streakWeeks: gamification.state?.streak ?? 0,
    credits,
  }), [p, vm.relykaAffiche, investmentGains, investmentCount, enjoyAmount, gamification.state?.streak, credits]);
  const tree = useMemo(() => computeTreeState(inputs), [inputs]);

  const accountNames = useMemo(() => {
    const list = core.accountsPerso as any[];
    return {
      from: list.find((a) => a.id === vm.mainCheckingId)?.name ?? null,
      savingsTo: list.find((a) => a.type === 'savings')?.name ?? null,
      investTo: list.find((a) => a.type === 'investment')?.name ?? null,
    };
  }, [core.accountsPerso, vm.mainCheckingId]);
  const choices = useMemo(() => buildPicoChoices(recoList as any, accountNames, CURRENCY_SYMBOL), [recoList, accountNames]);

  /** Les chiffres de la feuille de l'arrosoir — mêmes valeurs que les lignes du Pilotage. */
  const can = p ? {
    checking: p.current_checking_balance ?? 0,
    spent: vm.monthExpensesPast,
    // « Reste à dépenser » = variables estimées + variables déjà saisies à venir + récurrentes à venir.
    leftToSpend: Math.max(0, p.variable_envelope_remaining ?? 0) + Math.max(0, p.variable_envelope_planned ?? 0) + Math.max(0, vm.recurUpcoming.amount),
    variableSource: p.variable_envelope_source,
    minimum: p.safety_margin_amount ?? 0,
    lowest: vm.cashflowTrough,
    lowestDate: vm.troughDate,
    nextIncomeDate: vm.nextIncomeDate,
  } : null;

  return { core, tree, inputs, choices, can, credits, gamification, investments };
}
