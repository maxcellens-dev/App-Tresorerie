/**
 * useBudgetData — LE point d'entrée unique des écrans qui affichent un budget.
 *
 * Il assemble ce dont `lib/finance/budgetEngine` a besoin, et surtout il le fait UNE SEULE FOIS,
 * de la même manière que le Pilotage et le Reporting : comptes perso + parts de comptes partagés,
 * conversion en devise de référence, puis périmètre FLUX. Chaque écran qui reconstruirait ça dans
 * son coin finirait par diverger — le projet a déjà payé ce prix entre le Pilotage et le Pouls.
 *
 * Tout vient du cache react-query déjà chargé par les autres écrans : ouvrir la page Budget ou
 * l'étape 2 de la saisie ne déclenche donc aucune requête supplémentaire dans le cas courant.
 */
import { useMemo } from 'react';
import { useTransactions } from './useTransactions';
import { useAllAccounts } from './useAccounts';
import { useCategories } from './useCategories';
import { useSharedContribution } from './useSharedContribution';
import { useCurrencyRates } from './useCurrencyRates';
import { useCurrency } from './useCurrency';
import { useBudgets } from './useBudgets';
import { convertAmount } from '../../lib/finance/currency';
import { buildPerimeterCtx, transformFluxTransactions } from '../../lib/finance/perimeter';
import { todayISO } from '../../lib/dateUtils';
import { computeBudgets, monthKeyOf, type BudgetCategory, type ComputeBudgetsResult } from '../../lib/finance/budgetEngine';

export interface BudgetContext {
  /** Transactions de la vue FLUX, en devise de référence. */
  fluxTx: any[];
  accountTypeById: Record<string, string>;
  categories: BudgetCategory[];
  budgets: ReturnType<typeof useBudgets>['data'];
  today: string;
  isLoading: boolean;
  /** Les lectures ont toutes abouti — condition pour afficher, jamais `isFetched`. */
  isReady: boolean;
  /**
   * Une lecture a ÉCHOUÉ. Sans ce drapeau, `isReady` restait faux indéfiniment et l'écran tournait
   * sans fin : l'utilisateur attendait une page qui n'arriverait jamais, sans savoir pourquoi ni
   * quoi faire. Un échec de lecture doit se DIRE — c'est aussi ce qui distingue « tu n'as pas de
   * budget » de « je n'ai pas réussi à les lire ».
   */
  isError: boolean;
}

/** Le contexte brut, sans calcul : pour la saisie, qui appelle `resolveBudgetFor` elle-même. */
export function useBudgetContext(profileId: string | undefined): BudgetContext {
  const { data: rawTx, isSuccess: txOk, isLoading: txLoading, isError: txErr } = useTransactions(profileId);
  const { data: rawAcc, isSuccess: accOk, isLoading: accLoading, isError: accErr } = useAllAccounts(profileId);
  const { data: categories, isSuccess: catOk, isError: catErr } = useCategories(profileId);
  const { data: sharedContrib } = useSharedContribution(profileId);
  const { data: budgets, isSuccess: budOk, isLoading: budLoading, isError: budErr } = useBudgets(profileId);
  const { data: rates } = useCurrencyRates();
  const { code: refCode } = useCurrency();

  const allAccounts = useMemo(() => rawAcc ?? [], [rawAcc]);

  /* Comptes partagés : leurs transactions arrivent DÉJÀ multipliées par le facteur d'impact. On les
     fusionne comme le fait le Reporting, puis on convertit tout en devise de référence — un budget
     n'appartient à aucun compte, il n'a donc qu'une seule devise possible. */
  const allTx = useMemo(() => {
    const merged = [...(rawTx ?? []), ...((sharedContrib?.transactions ?? []) as any[])];
    return merged.map((t: any) => ({
      ...t,
      amount: convertAmount(Number(t.amount), t.account?.currency || refCode, refCode, rates ?? {}) ?? Number(t.amount),
    }));
  }, [rawTx, sharedContrib, rates, refCode]);

  const perimeterCtx = useMemo(() => buildPerimeterCtx([
    ...allAccounts.map((a: any) => ({
      id: a.id,
      isShared: !!(sharedContrib?.factorByAccount && a.id in sharedContrib.factorByAccount),
      shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
      factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
      type: a.type,
    })),
    ...((sharedContrib?.accounts ?? []) as any[]).map((a: any) => ({
      id: a.id,
      isShared: true,
      shared_mode: sharedContrib?.modeByAccount?.[a.id] ?? null,
      factor: sharedContrib?.factorByAccount?.[a.id] ?? 1,
      type: a.type,
    })),
  ]), [allAccounts, sharedContrib]);

  const fluxTx = useMemo(
    () => transformFluxTransactions(allTx as any[], perimeterCtx) as any[],
    [allTx, perimeterCtx],
  );

  const accountTypeById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of allAccounts) m[(a as any).id] = (a as any).type;
    for (const a of (sharedContrib?.accounts ?? []) as any[]) m[a.id] = a.type;
    return m;
  }, [allAccounts, sharedContrib]);

  const cats = useMemo<BudgetCategory[]>(
    () => (categories ?? []).map((c: any) => ({
      id: c.id, name: c.name, parent_id: c.parent_id ?? null, type: c.type, icon: c.icon ?? null,
    })),
    [categories],
  );

  return {
    fluxTx,
    accountTypeById,
    categories: cats,
    budgets,
    today: todayISO(),
    isLoading: txLoading || accLoading || budLoading,
    isReady: txOk && accOk && catOk && budOk,
    isError: txErr || accErr || catErr || budErr,
  };
}

/** Le contexte PLUS le calcul du mois demandé — pour la page Budget et le détail « Dépensé ce mois ». */
export function useBudgetData(profileId: string | undefined, monthKey?: string): BudgetContext & { result: ComputeBudgetsResult } {
  const ctx = useBudgetContext(profileId);
  const mk = monthKey ?? monthKeyOf(ctx.today);
  const result = useMemo(() => computeBudgets({
    fluxTx: ctx.fluxTx,
    accountTypeById: ctx.accountTypeById,
    categories: ctx.categories,
    budgets: ctx.budgets ?? [],
    monthKey: mk,
    today: ctx.today,
  }), [ctx.fluxTx, ctx.accountTypeById, ctx.categories, ctx.budgets, mk, ctx.today]);
  return { ...ctx, result };
}
