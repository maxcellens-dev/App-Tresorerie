/**
 * usePilotageCore — les DONNÉES du tableau de bord, sans son interface : lectures, périmètre,
 * état « prêt à peindre » et modèle de vue (usePilotageViewModel).
 *
 * Le Jardin affiche les MÊMES chiffres que le Pilotage (Relyka, recommandations, dépensé, reste à
 * dépenser, marge, point bas). Ce hook reprend donc à l'identique le câblage de
 * `app/(tabs)/pilotage.tsx` — mêmes requêtes, même périmètre quotidien, mêmes entrées du modèle de
 * vue — sans les états d'écran (modales, guide de démarrage, défilement).
 *
 * ⚠️ DOUBLON TEMPORAIRE ASSUMÉ. Le Pilotage garde son propre câblage tant que le Jardin est derrière
 * son interrupteur : toucher à l'écran actuel pendant la construction, c'était risquer l'app de
 * tous les utilisateurs. À la bascule (phase 9), le Pilotage disparaît et ce hook devient la seule
 * source. D'ici là, toute modification du câblage du Pilotage doit être reportée ici.
 */
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useAppColors } from '../theme/useAppColors';
import { usePilotageData } from '../pilotage/usePilotageData';
import { useReliabilityConfig } from '../pilotage/useReliability';
import { usePilotageReadiness } from '../pilotage/usePilotageReadiness';
import { usePilotageViewModel } from '../pilotage/usePilotageViewModel';
import { useRecoThresholds } from '../pilotage/useRecoThresholds';
import { useFinancialProfile, useProfileAllocations } from '../pilotage/useFinancialProfile';
import { useTransactions } from '../data/useTransactions';
import { useSharedContribution } from '../data/useSharedContribution';
import { useCreditPilotTemplates } from '../data/useCreditFlows';
import { useAccounts, useAllAccounts } from '../data/useAccounts';
import { usePreSavings } from '../data/usePreSavings';
import { useReservations } from '../data/useReservations';
import { useProfile } from '../data/useProfile';
import { useCurrencyRates } from '../data/useCurrencyRates';
import { useBudgetData } from '../data/useBudgetData';
import { composeBudgetMessage } from '../../lib/finance/recoMessages';
import { buildPerimeterCtx, transformFluxTransactions, splitPerimeterAccounts } from '../../lib/finance/perimeter';
import { convertAmount } from '../../lib/finance/currency';
import { reportError } from '../../lib/platform/errorReporting';

export function usePilotageCore() {
  const { user } = useAuth();
  const userId = user?.id;
  const COLORS = useAppColors();
  const queryClient = useQueryClient();

  const pilotageQuery = usePilotageData(userId);
  const reliabilityQuery = useReliabilityConfig();
  const txPersoQuery = useTransactions(userId);
  const sharedQuery = useSharedContribution(userId);
  const creditPilotTx = useCreditPilotTemplates(userId);
  const accountsQuery = useAccounts(userId);
  const allAccountsQuery = useAllAccounts(userId);
  const preSavingsQuery = usePreSavings(userId);
  const reservationsQuery = useReservations(userId);
  const profileQuery = useProfile(userId);
  const ratesQuery = useCurrencyRates();
  const { data: financialProfile } = useFinancialProfile(userId);
  const { data: profileAllocations } = useProfileAllocations();
  const { data: recoThresholds } = useRecoThresholds();
  const budget = useBudgetData(userId);

  const txPerso = (txPersoQuery.data ?? []) as any[];
  const sharedContrib = sharedQuery.data;
  const accountsPerso = (accountsQuery.data ?? []) as any[];
  const preSavings = preSavingsQuery.data;
  const reservations = (reservationsQuery.data ?? []) as any[];
  const profile = profileQuery.data;
  const rates = ratesQuery.data ?? { EUR: 1 };

  // Échéances de crédit MATÉRIALISÉES exclues : la charge crédit est déjà portée par les
  // synthétiques `creditPilotTx` (même règle que le Pilotage, sinon double compte).
  const txForConseils = useMemo(
    () => [
      ...txPerso.filter((t: any) => !t.credit_kind),
      ...((sharedContrib?.transactions ?? []) as any[]).filter((t: any) => !t.credit_kind),
      ...creditPilotTx,
    ],
    [txPerso, sharedContrib, creditPilotTx],
  );
  const accounts = useMemo(() => [...accountsPerso, ...((sharedContrib?.accounts ?? []) as any[])], [accountsPerso, sharedContrib]);
  const perimeterCtx = useMemo(
    () => buildPerimeterCtx(accounts.map((a: any) => ({
      id: a.id,
      isShared: !!(sharedContrib?.factorByAccount && a.id in sharedContrib.factorByAccount),
      shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
      factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
      type: a.type,
    }))),
    [accounts, sharedContrib],
  );
  const txForSuivi = useMemo(() => transformFluxTransactions(txForConseils as any[], perimeterCtx), [txForConseils, perimeterCtx]);
  const accountsForSuivi = useMemo(() => splitPerimeterAccounts(accounts, perimeterCtx).perimeter, [accounts, perimeterCtx]);

  const isOffline = [pilotageQuery, accountsQuery, allAccountsQuery, txPersoQuery, reservationsQuery, preSavingsQuery, profileQuery, ratesQuery, reliabilityQuery, sharedQuery]
    .some((q) => q.fetchStatus === 'paused');

  const readiness = usePilotageReadiness(userId, isOffline, pilotageQuery, [
    accountsQuery, allAccountsQuery, txPersoQuery, sharedQuery,
    { ...reservationsQuery, afterFinancialSync: false },
    { ...preSavingsQuery, afterFinancialSync: false },
    { ...profileQuery, afterFinancialSync: false },
    { ...ratesQuery, afterFinancialSync: false },
    { ...reliabilityQuery, afterFinancialSync: false },
  ], (error, stage) => {
    const e = error as { message?: string; code?: string; stack?: string };
    void reportError('error', `Chargement Jardin : ${e?.message ?? 'échec'}`, e?.stack, { where: 'usePilotageCore', stage, code: e?.code });
  }, queryClient);

  const budgetMessage = useMemo(() => composeBudgetMessage({
    budget: budget.result.total.budget,
    spent: budget.result.total.spent,
    pace: budget.result.pace,
  }), [budget.result]);

  const vm = usePilotageViewModel({
    pilotageData: pilotageQuery.data,
    accounts,
    accountsForSuivi,
    txForSuivi,
    txPerso,
    reservations,
    preSavings,
    profile,
    rates,
    reliabilityCfg: reliabilityQuery.data,
    financialProfile,
    recoThresholds,
    profileAllocations,
    colors: COLORS,
    baseDataReady: readiness.ready,
    // Le guide de démarrage de l'ancienne interface ne s'applique pas au Jardin.
    guideIs: () => false,
    budgetMessage,
  });

  /** URL de l'écran de saisie unique, pré-rempli pour un virement conseillé (même règle que le Pilotage). */
  const buildTransferUrl = (opts: { dest: 'savings' | 'investment'; amount: number; label: string; resetPreSaving?: 'epargne' | 'invest'; origin?: string }) => {
    const refCode = (profile as any)?.currency_code ?? 'EUR';
    const srcCur = accounts.find((a: any) => a.id === vm.mainCheckingId)?.currency || refCode;
    const amountSrc = convertAmount(opts.amount, refCode, srcCur, rates) ?? opts.amount;
    const q = new URLSearchParams({
      type: 'transfer',
      account: vm.mainCheckingId ?? '',
      destType: opts.dest,
      amount: String(Math.round(amountSrc)),
      label: opts.label,
      origin: opts.origin ?? '/(tabs)/jardin',
      ...(opts.resetPreSaving ? { resetPreSaving: opts.resetPreSaving } : {}),
    });
    return `/(tabs)/transactions/add?${q.toString()}`;
  };

  const closureAccounts = useMemo(() => ((allAccountsQuery.data ?? []) as any[])
    .filter((a) => a.type === 'checking' && (a._role === 'owner' || a._role === 'write'))
    .map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance), currency: a.currency, joint: !!a.is_joint || a._role !== 'owner', isOwner: a._role === 'owner' })),
  [allAccountsQuery.data]);

  return {
    userId,
    ready: readiness.ready && !!pilotageQuery.data,
    failed: readiness.failed,
    isOffline,
    pilotageQuery,
    pilotageData: pilotageQuery.data,
    vm,
    accounts,
    accountsPerso,
    allAccounts: (allAccountsQuery.data ?? []) as any[],
    txPerso,
    /** Opérations et comptes du PÉRIMÈTRE quotidien — ceux du suivi du mois (dépensé, à venir). */
    txForSuivi,
    accountsForSuivi,
    preSavings,
    reservations,
    profile,
    rates,
    budget,
    buildTransferUrl,
    closureAccounts,
  };
}

export type PilotageCore = ReturnType<typeof usePilotageCore>;
