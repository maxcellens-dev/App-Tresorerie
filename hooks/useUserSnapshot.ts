// Construit l'instantané financier ANONYMISÉ d'un utilisateur (le même que celui envoyé à l'IA).
// Réutilisé par la page Conseils IA (utilisateur courant) ET par l'onglet Snapshot admin (user choisi,
// lecture autorisée par les policies admin — migrations 101/102/104/110/119).
//
// V2 : en plus des agrégats pilotage, on dérive des transactions l'HISTORIQUE des mois COMPLETS,
// les moyennes/tendances par grande catégorie, les charges & revenus RÉCURRENTS actifs, les grosses
// dépenses ponctuelles récentes et la PROJECTION du solde courant (moteur lib/forecast) — toujours
// anonymisé (catégories + montants, jamais de libellé).
//
// PÉRIMÈTRE du train de vie (historique, tendances, ponctuelles) : comptes COURANTS uniquement, hors
// virements internes ET hors régularisations de solde (regul_target). Sinon les mouvements des comptes
// épargne/investissement (grosses régularisations de valorisation, dépôts) gonflent les « revenus »
// et faussent totalement les soldes mensuels vus par l'IA.
//
// SOURCE : requête DÉDIÉE (pas useTransactions et sa limite de 500 lignes) — 6 mois complets de
// transactions + TOUS les templates récurrents (même anciens), pour qu'un utilisateur avec 2 ans
// d'historique ait un vrai historique 6 mois et que son loyer créé il y a 2 ans reste vu.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePilotageData } from './usePilotageData';
import { useTransactionMonthOverrides } from './useTransactionMonthOverrides';
import { useCategories } from './useCategories';
import { useCredits } from './useCredits';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { useSharedContribution } from './useSharedContribution';
import { computeAmortization, addMonthsISO } from '../lib/amortization';
import { todayISO } from '../lib/dateUtils';
import { buildSnapshot, type SnapshotMonth, type SnapshotCategoryTrend, type SnapshotRecurring, type SnapshotOneOff, type SnapshotForecastMonth, type SnapshotVariableDetail, type SnapshotSharedAccount, type SnapshotIncomeRef, type SnapshotUpcoming } from '../lib/aiSnapshot';
import { detectUpcomingChanges, type UpcomingTx } from '../lib/aiUpcoming';
import { deriveEngaged, computeHealthScore } from '../lib/aiScore';
import { usePreviousBilanMetrics, type BilanMetricsRow } from './useAi';
import { CURRENCY_SYMBOL } from '../lib/currency';

const SNAPSHOT_TX_LIMIT = 4000;

/** Transactions pour l'instantané : 6 derniers mois complets + mois courant + tous les templates
 *  récurrents, sur MES comptes non joints. Champs minimaux (pas de libellés inutiles en mémoire). */
function useSnapshotTransactions(profileId: string | undefined) {
  return useQuery({
    queryKey: ['snapshot_txs', profileId],
    enabled: !!profileId && !!supabase,
    queryFn: async (): Promise<any[]> => {
      const since = addMonthsISO(todayISO().slice(0, 8) + '01', -6);
      const { data, error } = await supabase!
        .from('transactions')
        .select('id, account_id, amount, date, category_id, linked_account_id, is_draft, regul_target, is_recurring, recurrence_rule, recurrence_end_date, materialized_from, project_id, note, account:accounts!account_id(type, profile_id, is_joint)')
        .eq('profile_id', profileId!)
        .or(`date.gte.${since},is_recurring.eq.true`)
        .order('date', { ascending: false })
        .limit(SNAPSHOT_TX_LIMIT);
      if (error) throw error;
      return (data ?? [])
        .filter((r: any) => r.account && r.account.profile_id === profileId && !r.account.is_joint)
        .map((r: any) => ({ ...r, amount: Number(r.amount) }));
    },
  });
}

export interface UserSnapshot {
  text: string | null;
  ready: boolean;
  build: () => string;
  /** Métriques top-line du bilan courant — à persister après un bilan global réussi (évolution). */
  currentBilanMetrics: BilanMetricsRow | null;
}

export function useUserSnapshot(userId: string | undefined): UserSnapshot {
  const { data: pilotage } = usePilotageData(userId);
  const { data: transactions } = useSnapshotTransactions(userId);
  const { data: monthOverrides } = useTransactionMonthOverrides(userId);
  const { data: categories } = useCategories(userId);
  const { data: credits } = useCredits(userId);
  const { data: allAccounts } = useAllAccounts(userId);
  const { data: projects } = useProjects(userId);
  // Mode des comptes partagés (« tracked » = quotidien / « contribution » = hors quotidien) — le
  // traitement des flux qui y transitent en dépend totalement.
  const { data: sharedContrib } = useSharedContribution(userId);
  // Dernier bilan global persisté → section ÉVOLUTION (« je vais dans le bon sens ? »).
  const { data: previousBilan } = usePreviousBilanMetrics(userId);
  // Comptes JOINTS en mode CONTRIBUTION (hors budget quotidien) : les virements récurrents qui y
  // vont sont des ENGAGEMENTS du foyer (couvrent souvent la part de crédits/charges communes).
  const jointContribAcctIds = useMemo(() => {
    const modeByAccount = sharedContrib?.modeByAccount ?? {};
    const ids = new Set<string>();
    for (const a of allAccounts ?? []) if (modeByAccount[a.id] === 'contribution') ids.add(a.id);
    return ids;
  }, [allAccounts, sharedContrib]);

  const catById = useMemo(() => {
    const m = new Map<string, { name: string; parent_id?: string | null; is_variable?: boolean; type?: string }>();
    for (const cat of categories ?? []) m.set(cat.id, { name: cat.name, parent_id: cat.parent_id, is_variable: (cat as any).is_variable, type: (cat as any).type });
    return m;
  }, [categories]);
  const grandCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    return cat.parent_id ? (catById.get(cat.parent_id)?.name ?? cat.name) : cat.name;
  };
  /** « Parent > Sous-catégorie » (taxonomie seule, jamais de libellé) pour les lignes récurrentes. */
  const fullCat = (id: string | null | undefined): string => {
    if (!id) return 'Sans catégorie';
    const cat = catById.get(id);
    if (!cat) return 'Sans catégorie';
    const parent = cat.parent_id ? catById.get(cat.parent_id)?.name : null;
    return parent && parent !== cat.name ? `${parent} > ${cat.name}` : cat.name;
  };

  // Transaction « réelle » à considérer (ni virement interne, ni brouillon, ni régularisation de solde).
  const isReal = (t: any) => !t.linked_account_id && !t.is_draft && t.regul_target == null;
  // Train de vie = flux des comptes COURANTS uniquement (les mouvements épargne/invest ne sont ni des
  // revenus ni des dépenses de vie courante).
  const isCashflow = (t: any) => isReal(t) && t.account?.type === 'checking';
  const isRecurringTpl = (t: any) => Boolean(t.is_recurring) && Boolean(t.recurrence_rule);
  // Montant positif sur une catégorie de DÉPENSE = remboursement (réduit la dépense, PAS un revenu).
  const isRefund = (t: any) => Number(t.amount) > 0 && t.category_id != null && catById.get(t.category_id)?.type === 'expense';
  // Vraie RECETTE (revenu) : positive, réelle, sur compte courant, et pas un remboursement.
  const isIncome = (t: any) => isCashflow(t) && Number(t.amount) > 0 && !isRefund(t);
  // Série récurrente encore VIVANTE. Une série « supprimée » ou « modifiée à partir de » n'est PAS
  // effacée : elle est TRONQUÉE (recurrence_end_date) et son ancre (date) a pu être avancée par la
  // matérialisation AU-DELÀ de la fin → fin passée OU fin < ancre = plus aucune échéance à venir.
  const isLiveSeries = (t: any) => {
    if (!isRecurringTpl(t)) return false;
    const end = t.recurrence_end_date as string | null;
    if (!end) return true;
    return end >= todayISO() && end >= t.date;
  };

  // Montant EFFECTIF d'un template récurrent : l'override mensuel le plus récent (≤ mois courant, sinon
  // le dernier connu) prime sur le montant de base — sinon on annonce à l'IA des montants obsolètes.
  const effectiveAmount = useMemo(() => {
    const best = new Map<string, { ym: number; amount: number }>();
    const curYm = (() => { const t = todayISO(); return Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)); })();
    for (const o of monthOverrides ?? []) {
      if (o.override_amount == null) continue;
      const ym = Number(o.year) * 12 + Number(o.month);
      const prev = best.get(o.transaction_id);
      // Priorité aux overrides passés/courants les plus récents ; un override futur ne sert que s'il n'y a rien d'autre.
      const rank = (v: number) => (v <= curYm ? v : -v);
      if (!prev || rank(ym) > rank(prev.ym)) best.set(o.transaction_id, { ym, amount: o.override_amount });
    }
    return (t: any): number => best.get(t.id)?.amount ?? Number(t.amount);
  }, [monthOverrides]);

  const expensesByCategory = useMemo(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const acc: Record<string, number> = {};
    for (const t of transactions) {
      if (!isCashflow(t)) continue;
      if (Number(t.amount) >= 0) continue;
      if (t.date.slice(0, 7) !== curYm) continue;
      const name = grandCat(t.category_id);
      acc[name] = (acc[name] ?? 0) + Math.abs(Number(t.amount));
    }
    return Object.entries(acc).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
  }, [transactions, catById]);

  // Mois COMPLETS couverts : la requête charge tout depuis le 1ᵉʳ du mois -6 → chaque mois de la
  // fenêtre (hors mois courant) est complet. Les templates récurrents plus anciens (chargés à part)
  // sont hors fenêtre → exclus d'ici. Garde-fou : si la limite de lignes est atteinte, le mois le
  // plus ancien peut être tronqué → on l'écarte.
  const completeMonths = useMemo(() => {
    if (!transactions?.length) return [] as string[];
    const curYm = todayISO().slice(0, 7);
    const sinceYm = addMonthsISO(todayISO().slice(0, 8) + '01', -6).slice(0, 7);
    let months = [...new Set(transactions.map((t) => t.date.slice(0, 7)))]
      .filter((ym) => ym < curYm && ym >= sinceYm)
      .sort();
    if (transactions.length >= SNAPSHOT_TX_LIMIT) months = months.slice(1);
    return months.slice(-6);
  }, [transactions]);

  // REVENU DE RÉFÉRENCE = moyenne des SOMMES de recettes par mois (mois AVEC recettes uniquement,
  // fenêtre ≤ 6 mois, mois courant inclus). Recettes = vraies rentrées : pas les virements internes,
  // pas les remboursements de dépenses, pas les régularisations. EN PARALLÈLE : virements ENTRANTS
  // sur les comptes courants depuis un compte « autre » (un user peut encaisser ailleurs puis virer
  // vers son courant → c'est alors son revenu de fait). Retours d'épargne/invest exclus.
  const incomeRef = useMemo<SnapshotIncomeRef>(() => {
    const curYm = todayISO().slice(0, 7);
    const sinceYm = addMonthsISO(todayISO().slice(0, 8) + '01', -5).slice(0, 7); // 6 mois, courant inclus
    const acctTypeById: Record<string, string> = {};
    for (const a of allAccounts ?? []) acctTypeById[a.id] = (a as any).type;
    const incomeByYm: Record<string, number> = {};
    const transferByYm: Record<string, number> = {};
    const activityYms = new Set<string>();
    for (const t of transactions ?? []) {
      const ym = t.date.slice(0, 7);
      if (ym < sinceYm || ym > curYm) continue;
      if (t.account?.type !== 'checking' || t.is_draft) continue;
      activityYms.add(ym);
      if (isIncome(t)) { incomeByYm[ym] = (incomeByYm[ym] ?? 0) + Number(t.amount); continue; }
      // Virement entrant depuis un compte « autre » (ou inconnu) — PAS depuis épargne/invest/courant.
      if (t.regul_target == null && t.linked_account_id && Number(t.amount) > 0) {
        const lt = acctTypeById[t.linked_account_id];
        if (lt !== 'checking' && lt !== 'savings' && lt !== 'investment') {
          transferByYm[ym] = (transferByYm[ym] ?? 0) + Number(t.amount);
        }
      }
    }
    const incomeMonths = Object.keys(incomeByYm);
    const transferMonths = Object.keys(transferByYm);
    const avgIncome = incomeMonths.length ? Object.values(incomeByYm).reduce((s, v) => s + v, 0) / incomeMonths.length : 0;
    const transfersAvg = transferMonths.length ? Object.values(transferByYm).reduce((s, v) => s + v, 0) / transferMonths.length : 0;
    const monthsWithoutIncome = [...activityYms].filter((ym) => !(ym in incomeByYm)).length;
    const source: SnapshotIncomeRef['source'] = avgIncome > 0 ? 'recettes' : transfersAvg > 0 ? 'virements' : 'none';
    return {
      avg: source === 'virements' ? transfersAvg : avgIncome,
      monthsUsed: source === 'virements' ? transferMonths.length : incomeMonths.length,
      monthsWithoutIncome,
      transfersAvg,
      source,
    };
  }, [transactions, allAccounts, catById]);

  const history = useMemo<SnapshotMonth[]>(() => {
    if (!transactions) return [];
    const by: Record<string, SnapshotMonth> = {};
    const refundByYm: Record<string, number> = {};
    for (const ym of completeMonths) by[ym] = { ym, income: 0, expenses: 0, fixed: 0, variable: 0 };
    for (const t of transactions) {
      const ym = t.date.slice(0, 7);
      const h = by[ym];
      if (!h || !isCashflow(t)) continue;
      const amt = Number(t.amount);
      if (amt > 0) {
        // Remboursement de dépense → réduit la dépense (variable), ce n'est PAS un revenu.
        if (isRefund(t)) refundByYm[ym] = (refundByYm[ym] ?? 0) + amt;
        else h.income += amt;
        continue;
      }
      const abs = Math.abs(amt);
      h.expenses += abs;
      // Fixe = récurrente OU catégorie marquée non-variable ; sinon variable.
      const cat = t.category_id ? catById.get(t.category_id) : null;
      if (isRecurringTpl(t) || cat?.is_variable === false) h.fixed += abs; else h.variable += abs;
    }
    for (const ym of completeMonths) {
      const h = by[ym]; const rb = refundByYm[ym] ?? 0;
      h.expenses = Math.max(0, h.expenses - rb);
      h.variable = Math.max(0, h.variable - rb);
    }
    return completeMonths.map((ym) => by[ym]);
  }, [transactions, completeMonths, catById]);

  // Tendances par grande catégorie : montant PAR MOIS COMPLET (pas une moyenne écrasée — une
  // catégorie apparue seulement le mois dernier ressemblait à une « dérive +100 % » alors que c'est
  // juste une réorganisation, ex. prélèvements déplacés sur un compte joint).
  const categoryTrends = useMemo<SnapshotCategoryTrend[]>(() => {
    if (!transactions || !completeMonths.length) return [];
    const byName: Record<string, Record<string, number>> = {};
    for (const t of transactions) {
      if (!isCashflow(t) || Number(t.amount) >= 0) continue;
      const ym = t.date.slice(0, 7);
      if (!completeMonths.includes(ym)) continue;
      const name = grandCat(t.category_id);
      (byName[name] ??= {})[ym] = (byName[name]?.[ym] ?? 0) + Math.abs(Number(t.amount));
    }
    return Object.entries(byName)
      .map(([name, byMonth]) => ({
        name, byMonth,
        avg: completeMonths.reduce((s, ym) => s + (byMonth[ym] ?? 0), 0) / completeMonths.length,
      }))
      .filter((x) => x.avg >= 5)
      .sort((a, b) => b.avg - a.avg);
  }, [transactions, completeMonths, catById]);

  // DÉTAIL des dépenses ponctuelles/variables PAR SOUS-CATÉGORIE (tous les comptes courants
  // confondus), mois en cours + dernier mois complet : la matière pour des conseils concrets.
  const variableDetail = useMemo<SnapshotVariableDetail[]>(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const months = [completeMonths[completeMonths.length - 1], curYm].filter(Boolean) as string[];
    return months.map((ym) => {
      const acc: Record<string, { amount: number; count: number }> = {};
      for (const t of transactions) {
        if (!isCashflow(t) || isRecurringTpl(t) || Number(t.amount) >= 0) continue;
        if (t.date.slice(0, 7) !== ym) continue;
        const name = fullCat(t.category_id);
        const cur = (acc[name] ??= { amount: 0, count: 0 });
        cur.amount += Math.abs(Number(t.amount));
        cur.count += 1;
      }
      const items = Object.entries(acc)
        .map(([category, v]) => ({ category, amount: v.amount, count: v.count }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 12);
      return { ym, isCurrent: ym === curYm, items };
    }).filter((m) => m.items.length > 0);
  }, [transactions, completeMonths, catById]);

  // Récurrentes ACTIVES (templates non terminés), dédupliquées par catégorie+montant+fréquence.
  // REVENUS récurrents : seules les occurrences RÉCENTES comptent (fenêtre ~2 mois selon la
  // fréquence) — sinon de vieux templates jamais clôturés (salaire passé de 2 500 € à 1 700 €…)
  // gonflent le « total des revenus récurrents » avec des montants qui n'existent plus.
  const recurrings = useMemo(() => {
    const today = todayISO();
    const seen = new Set<string>();
    const expenses: SnapshotRecurring[] = [];
    const incomes: SnapshotRecurring[] = [];
    const recentSinceByRule: Record<string, string> = {
      daily: addMonthsISO(today, -1), weekly: addMonthsISO(today, -1),
      monthly: addMonthsISO(today, -2), quarterly: addMonthsISO(today, -4), yearly: addMonthsISO(today, -13),
    };
    for (const t of transactions ?? []) {
      if (!isReal(t) || !isRecurringTpl(t)) continue;
      if (!isLiveSeries(t)) continue; // série tronquée (supprimée/remplacée) → morte, même si sa fin est future
      // Montant courant réel (override mensuel s'il existe — les templates gardent souvent un vieux montant).
      const amt = effectiveAmount(t);
      if (Math.round(Math.abs(amt)) === 0) continue; // occurrence « supprimée » via override à 0
      if (amt > 0) {
        const since = recentSinceByRule[String(t.recurrence_rule)] ?? addMonthsISO(today, -2);
        if (t.date < since) continue; // revenu récurrent sans occurrence récente → considéré obsolète
      }
      const key = `${t.category_id ?? 'x'}|${Math.round(Math.abs(amt) * 100)}|${t.recurrence_rule}`;
      if (seen.has(key)) continue; // transactions triées desc → on garde l'occurrence la plus récente
      seen.add(key);
      const row = { category: fullCat(t.category_id), amount: Math.abs(amt), rule: String(t.recurrence_rule) };
      (amt < 0 ? expenses : incomes).push(row);
    }
    expenses.sort((a, b) => b.amount - a.amount);
    incomes.sort((a, b) => b.amount - a.amount);
    return { expenses, incomes };
  }, [transactions, catById, effectiveAmount]);

  // Grosses dépenses PONCTUELLES récentes (dernier mois complet + mois en cours, non récurrentes).
  const topOneOff = useMemo<SnapshotOneOff[]>(() => {
    if (!transactions) return [];
    const curYm = todayISO().slice(0, 7);
    const lastYm = completeMonths[completeMonths.length - 1];
    const out: SnapshotOneOff[] = [];
    for (const t of transactions) {
      if (!isCashflow(t) || isRecurringTpl(t) || Number(t.amount) >= 0) continue;
      const ym = t.date.slice(0, 7);
      if (ym !== curYm && ym !== lastYm) continue;
      const abs = Math.abs(Number(t.amount));
      if (abs < 20) continue; // seuil bas : les petites dépenses répétées comptent aussi
      // Sous-catégorie (« Parent > Sous-catégorie ») : la grande catégorie seule ne permet aucune analyse.
      out.push({ date: t.date, category: fullCat(t.category_id), amount: abs });
    }
    return out.sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [transactions, completeMonths, catById]);

  // CHANGEMENTS DÉJÀ SAISIS À VENIR (12 mois) : fins de récurrences, NOUVELLES récurrences futures,
  // ponctuelles futures notables — pour que l'IA anticipe le train de vie de DEMAIN. Détection dans
  // lib/aiUpcoming (fonction pure testée) : compare aux occurrences MATÉRIALISÉES passées.
  const upcoming = useMemo<SnapshotUpcoming>(() => {
    const acctTypeById: Record<string, string> = {};
    for (const a of allAccounts ?? []) acctTypeById[a.id] = (a as any).type;
    const txs: UpcomingTx[] = (transactions ?? []).map((t: any) => ({ ...t, accountType: t.account?.type ?? null }));
    return detectUpcomingChanges(txs, { today: todayISO(), acctTypeById, fullCat, isRefund, jointContribAcctIds });
  }, [transactions, allAccounts, catById, jointContribAcctIds]);

  // PROJECTION du solde courant : LA trajectoire de référence (pilotage.projection_balances_12m,
  // calculée par lib/tresoProjection — la même que l'onglet Projection ET que le garde-fou marge
  // des recommandations, prolongée à 12 mois) → l'IA cite les soldes que l'utilisateur voit.
  const forecast = useMemo<SnapshotForecastMonth[]>(() => {
    const balances = pilotage?.projection_balances_12m ?? pilotage?.projection_balances_6m ?? [];
    const now = new Date();
    return balances.map((balance, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, balance };
    });
  }, [pilotage]);

  // ÉPARGNE & INVESTISSEMENT projetés à 6/12 mois — virements récurrents vivants (dans les deux
  // sens) + virements ponctuels futurs déjà saisis, cumulés mois par mois (hors rendement).
  const savingsInvestForecast = useMemo(() => {
    const today = todayISO();
    const RULE_MONTHLY: Record<string, number> = { daily: 30.4, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    const acctTypeById: Record<string, string> = {};
    for (const a of allAccounts ?? []) acctTypeById[a.id] = (a as any).type;
    // Flux net signé VERS chaque poche (savings/investment), par mois +1 … +12.
    const savingsByMonth = Array(12).fill(0);
    const investByMonth = Array(12).fill(0);
    const monthIndex = (dateISO: string): number => {
      const now = new Date(today + 'T00:00:00');
      const d = new Date(dateISO.slice(0, 10) + 'T00:00:00');
      return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
    };
    const seen = new Set<string>();
    for (const t of transactions ?? []) {
      if (t.is_draft || t.regul_target != null || !t.linked_account_id) continue;
      // Une seule jambe par virement : celle qui N'EST PAS sur la poche cible (côté courant en général).
      const legType = t.account?.type;
      if (legType === 'savings' || legType === 'investment') continue;
      const destType = acctTypeById[t.linked_account_id];
      if (destType !== 'savings' && destType !== 'investment') continue;
      const target = destType === 'savings' ? savingsByMonth : investByMonth;
      const signed = -Number(t.amount); // sortie du courant (négatif) = ENTRÉE sur la poche
      if (isRecurringTpl(t)) {
        if (!isLiveSeries(t)) continue;
        const key = `${t.linked_account_id}|${t.category_id ?? 'x'}|${Math.round(Math.abs(Number(t.amount)) * 100)}|${t.recurrence_rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const eq = signed * (RULE_MONTHLY[String(t.recurrence_rule)] ?? 1);
        const startIdx = Math.max(1, monthIndex(t.date)); // ancre future → démarre à son mois
        const endIdx = t.recurrence_end_date ? Math.min(12, monthIndex(t.recurrence_end_date)) : 12;
        for (let k = startIdx; k <= endIdx && k <= 12; k++) target[k - 1] += eq;
      } else if (t.date > today) {
        const idx = monthIndex(t.date);
        if (idx >= 1 && idx <= 12) target[idx - 1] += signed;
      }
    }
    const cum = (arr: number[], k: number) => arr.slice(0, k).reduce((s, v) => s + v, 0);
    return {
      savingsNow: pilotage?.total_savings ?? 0,
      investNow: pilotage?.total_invested ?? 0,
      savings6: (pilotage?.total_savings ?? 0) + cum(savingsByMonth, 6),
      savings12: (pilotage?.total_savings ?? 0) + cum(savingsByMonth, 12),
      invest6: (pilotage?.total_invested ?? 0) + cum(investByMonth, 6),
      invest12: (pilotage?.total_invested ?? 0) + cum(investByMonth, 12),
    };
  }, [transactions, allAccounts, pilotage]);

  // Comptes PARTAGÉS / JOINTS accessibles : type + ma part d'impact + MODE (« quotidien » = flux
  // inclus dans le budget ; « contribution » = hors quotidien, seule la contribution versée compte).
  const sharedAccounts = useMemo<SnapshotSharedAccount[]>(() => {
    const modeByAccount = sharedContrib?.modeByAccount ?? {};
    return (allAccounts ?? [])
      .filter((a: any) => a.is_joint || a._impact_pct != null)
      .map((a: any) => ({
        type: a.type,
        joint: !!a.is_joint,
        impactPct: a._impact_pct != null ? Number(a._impact_pct) : 100,
        mode: (modeByAccount[a.id] ?? null) as string | null,
      }));
  }, [allAccounts, sharedContrib]);

  // Contribution récurrente mensuelle vers les comptes joints « contribution » (équivalent mensuel).
  const jointContributionMonthly = useMemo(() => {
    const today = todayISO();
    const RULE_MONTHLY: Record<string, number> = { daily: 30.4, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    let total = 0;
    const seen = new Set<string>();
    for (const t of transactions ?? []) {
      if (t.is_draft || t.regul_target != null || !t.linked_account_id) continue;
      if (!jointContribAcctIds.has(t.linked_account_id)) continue;
      if (Number(t.amount) >= 0) continue; // sortie du courant → contribution
      if (isRecurringTpl(t)) {
        if (!isLiveSeries(t)) continue;
        const key = `${t.linked_account_id}|${Math.round(Math.abs(Number(t.amount)) * 100)}|${t.recurrence_rule}`;
        if (seen.has(key)) continue;
        seen.add(key);
        total += Math.abs(Number(t.amount)) * (RULE_MONTHLY[String(t.recurrence_rule)] ?? 1);
      }
    }
    return Math.round(total);
  }, [transactions, jointContribAcctIds]);

  // Versements cumulés sur les comptes d'INVESTISSEMENT (capital injecté) → plus-value = valeur − versé.
  const investContributed = useMemo(() => {
    let total = 0; let known = false;
    for (const a of allAccounts ?? []) {
      if ((a as any).type !== 'investment') continue;
      const c = (a as any).current_contributed ?? (a as any).initial_contributed;
      if (c != null) { total += Number(c); known = true; }
    }
    return known ? Math.round(total) : null;
  }, [allAccounts]);

  const creditsSummary = useMemo(() => {
    const today = todayISO();
    const acctById: Record<string, any> = {};
    for (const a of allAccounts ?? []) acctById[a.id] = a;
    return (credits ?? []).filter((cr) => cr.is_active && !cr.is_simulation).map((cr) => {
      const a = computeAmortization({ ...cr });
      const last = a.schedule[a.schedule.length - 1];
      const acc = cr.account_id ? acctById[cr.account_id] : null;
      const impactPct = acc && acc._impact_pct != null ? acc._impact_pct : 100;
      return {
        principal: cr.principal, ratePct: cr.rate_annual, crd: a.crdAtDate(today),
        endYM: last ? last.date.slice(0, 7) : null,
        remainingMonths: a.schedule.filter((r) => r.date > today).length,
        impactPct, monthly: a.monthlyWithInsurance * (impactPct / 100),
      };
    });
  }, [credits, allAccounts]);

  const projectsSummary = useMemo(() => {
    const byId: Record<string, any> = {};
    for (const pr of projects ?? []) byId[pr.id] = pr;
    const acctTypeById: Record<string, string> = {};
    for (const a of allAccounts ?? []) acctTypeById[a.id] = (a as any).type;
    return (pilotage?.projects_with_progress ?? []).map((pr) => {
      const src = byId[pr.id];
      // Type du compte de DESTINATION des virements du projet (toujours anonyme) : dit si le projet
      // consiste à investir, épargner, ou conserver sur le courant.
      const destType = src?.linked_account_id ? (acctTypeById[src.linked_account_id] ?? null) : null;
      return {
        target: pr.target_amount, monthly: pr.monthly_allocation, progressPct: pr.progress_percentage,
        status: pr.status,
        startISO: (src?.first_payment_date || src?.created_at || '').slice(0, 10) || null,
        destType,
      };
    });
  }, [pilotage, projects, allAccounts]);

  // Métriques top-line du bilan courant (même logique que le snapshot : deriveEngaged +
  // computeHealthScore) → persistées après un bilan global, et comparées au précédent (évolution).
  const currentBilanMetrics = useMemo<BilanMetricsRow | null>(() => {
    if (!pilotage) return null;
    const RULE_MONTHLY: Record<string, number> = { daily: 30.4, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
    const income = incomeRef?.avg || pilotage.avg_monthly_income || 0;
    const recurringIncomeMonthly = recurrings.incomes.reduce((t, r) => t + r.amount * (RULE_MONTHLY[r.rule] ?? 1), 0);
    const fixedMonthly = recurrings.expenses.reduce((t, r) => t + r.amount * (RULE_MONTHLY[r.rule] ?? 1), 0);
    const engaged = deriveEngaged(creditsSummary, fixedMonthly, jointContributionMonthly);
    const balances = pilotage.projection_balances_12m ?? [];
    const partial = history.length > 0 && history.length < 6;
    const reliable = history.filter((h, i) => !(partial && i === 0) && income > 0 && h.income <= income * 2.5 && h.income > 0);
    const avgNet = reliable.length ? reliable.reduce((t, h) => t + (h.income - h.expenses), 0) / reliable.length : null;
    const score = income > 0 ? computeHealthScore({
      income,
      realIncome: Math.max(recurringIncomeMonthly, income),
      savings: pilotage.total_savings,
      invested: pilotage.total_invested,
      engagedMonthly: engaged.total,
      setAsideMonthly: (pilotage.monthly_savings_planned || 0) + (pilotage.monthly_invest_planned || 0),
      projectionMin: balances.length ? Math.min(...balances) : null,
      margin: pilotage.safety_margin_amount || 0,
      avgNet,
      reliableMonths: reliable.length,
    }).global : 0;
    return {
      patrimoine: Math.round(pilotage.total_checking + pilotage.total_savings + pilotage.total_invested),
      checking: Math.round(pilotage.total_checking),
      savings: Math.round(pilotage.total_savings),
      invested: Math.round(pilotage.total_invested),
      engaged: Math.round(engaged.total),
      balance12: balances.length ? Math.round(balances[balances.length - 1]) : 0,
      income: Math.round(income),
      score,
    };
  }, [pilotage, incomeRef, recurrings, creditsSummary, jointContributionMonthly, history]);

  const build = () => {
    const now = new Date();
    return buildSnapshot({
      currencySymbol: CURRENCY_SYMBOL,
      today: todayISO(),
      dayOfMonth: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      pilotage: pilotage!,
      expensesByCategory,
      credits: creditsSummary,
      projects: projectsSummary,
      history,
      // 1ᵉʳ mois de la fenêtre probablement = arrivée sur l'app (moins de 6 mois complets) →
      // saisie possiblement incomplète ce mois-là, signalé à l'IA par un astérisque.
      firstMonthPartial: history.length > 0 && history.length < 6,
      categoryTrends,
      recurringExpenses: recurrings.expenses,
      recurringIncomes: recurrings.incomes,
      topOneOff,
      forecast,
      variableDetail,
      sharedAccounts,
      incomeRef,
      upcoming,
      savingsInvestForecast,
      jointContributionMonthly,
      investContributed,
      incomeByMonth: (pilotage?.projection_income_12m ?? []).slice(0, 6),
      evolution: previousBilan && currentBilanMetrics
        ? { previousDate: previousBilan.date, previous: previousBilan.metrics, current: currentBilanMetrics }
        : null,
    });
  };

  const text = useMemo(
    () => (pilotage ? build() : null),
    [pilotage, expensesByCategory, creditsSummary, projectsSummary, history, categoryTrends, recurrings, topOneOff, forecast, variableDetail, sharedAccounts, incomeRef, upcoming, savingsInvestForecast, jointContributionMonthly, investContributed, previousBilan, currentBilanMetrics],
  );
  return { text, ready: !!pilotage, build, currentBilanMetrics };
}
