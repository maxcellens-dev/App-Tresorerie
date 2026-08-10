/**
 * L'ÉTAT DES LIEUX — assemblage des données réelles → moteur pur (lib/pulseEngine).
 *
 * Ne calcule rien de neuf : tout vient de sources qui existent déjà (usePilotageData, profil P1–P5,
 * comptes, projets, moteur de confiance). Une seule règle : ce hook LIT, le moteur MET EN FORME.
 */
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from './usePilotageData';
import { useTransactions } from './useTransactions';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { usePreSavings } from './usePreSavings';
import { useReservations } from './useReservations';
import { useFinancialProfile, useQuestionnaireAnswers } from './useFinancialProfile';
import { usePulseConfig } from './usePulseConfig';
import { useReliabilityConfig, deriveRelykaConfidence } from './useReliability';
import { isRegul } from '../lib/regul';
import { usePulseSnapshots } from './usePulseState';
import { computePulse, monthKey, type PulseInputs, type PulseResult } from '../lib/pulseEngine';
import { computeRelyka } from '../lib/relyka';
import type { FinancialProfileId } from '../types/database';

/** Dernier jour du mois « YYYY-MM » au format ISO. */
function lastDayOf(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 0);
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Décale une clé de mois de `n` mois. */
function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
}

/**
 * Mois PASSÉS consécutifs terminés avec un compte courant dans le vert.
 * Le solde de fin de mois M est reconstruit depuis le solde actuel, en retirant tout ce qui est
 * arrivé APRÈS M (on n'historise pas les soldes : on les rejoue à l'envers, comme le détail de compte).
 */
function computeMonthsWithoutOverdraft(
  checkingBalance: number,
  transactions: any[],
  checkingIds: Set<string>,
  today: Date,
  maxMonths = 12,
): number {
  const real = transactions.filter(
    (t) => checkingIds.has(t.account_id) && !t.is_draft && !t.is_recurring,
  );
  let streak = 0;
  for (let back = 1; back <= maxMonths; back++) {
    const key = monthKey(new Date(today.getFullYear(), today.getMonth() - back, 1));
    const cutoff = lastDayOf(key);
    const after = real
      .filter((t) => String(t.date) > cutoff)
      .reduce((s, t) => s + Number(t.amount), 0);
    const balanceAtEnd = checkingBalance - after;
    // Aucun mouvement avant ce mois → l'utilisateur n'existait pas encore : on arrête la série.
    const hadActivity = real.some((t) => String(t.date) <= cutoff);
    if (!hadActivity) break;
    if (balanceAtEnd < 0) break;
    streak++;
  }
  return streak;
}

export interface PulseData {
  /** L'ÉTAT DES LIEUX du mois écoulé (le seul rendez-vous). */
  monthly: PulseResult;
  /**
   * Anneau + légende du bilan : ce qui a été mis de côté, placé, et conservé PENDANT le mois écoulé.
   */
  monthlyStats: { saved: number; invested: number; kept: number };
  profileId: FinancialProfileId;
  /** Relyka du jour — sert à la carte de confirmation de saisie. */
  relyka: number;
  /** Patrimoine du jour — persisté dans le snapshot pour l'évolution à 3 mois. */
  wealth: number;
  /**
   * L'utilisateur a-t-il vécu le mois précédent dans l'app ? Sans ça, on lui servirait un « état des
   * lieux » d'un mois où il n'existait pas — le pire premier contact possible.
   */
  hadActivityLastMonth: boolean;
  /**
   * Solde COURANT projeté au 1er du mois suivant, et marge de sécurité. Exposés bruts (et pas
   * seulement à travers le signal « Fin de mois ») parce que la carte de confirmation de saisie les
   * recalcule PAR ARITHMÉTIQUE, sans attendre un recalcul complet (cf. lib/pulseDelta).
   */
  endOfMonthBalance: number;
  safetyMargin: number;
  /**
   * Enveloppe variable RESTANTE du mois — exposée pour la même raison : le solde projeté la déduit
   * déjà, donc une dépense du quotidien qui la consomme ne le déplace pas. Sans ce chiffre, la carte
   * de confirmation annonçait une fin de mois amputée à chaque course (cf. lib/pulseDelta).
   */
  variableEnvelopeRemaining: number;
  /**
   * Enveloppe variable TOTALE du mois. Le restant seul ne veut rien dire (« 340 € » : sur combien ?) :
   * la carte de confirmation montre les deux, c'est ce qui rend visible l'effet d'une dépense du
   * quotidien qui, par construction, ne déplace ni le Relyka ni la fin de mois.
   */
  variableEnvelopeInitial: number;
}

/**
 * Les entrées du calcul, regroupées : elles servent aussi de clé au cache partagé.
 * Types DÉRIVÉS des hooks source — le calcul reste typé de bout en bout.
 */
type QueryData<T extends (...args: any) => any> = ReturnType<T> extends { data: infer D } ? D : never;
type PulseDeps = {
  pilotage: QueryData<typeof usePilotageData>;
  transactions: NonNullable<QueryData<typeof useTransactions>>;
  accounts: NonNullable<QueryData<typeof useAllAccounts>>;
  projects: NonNullable<QueryData<typeof useProjects>>;
  preSavings: QueryData<typeof usePreSavings>;
  reservations: NonNullable<QueryData<typeof useReservations>>;
  financialProfile: QueryData<typeof useFinancialProfile>;
  answers: QueryData<typeof useQuestionnaireAnswers>;
  config: QueryData<typeof usePulseConfig>;
  relCfg: QueryData<typeof useReliabilityConfig>;
  snapshots: NonNullable<QueryData<typeof usePulseSnapshots>>;
  userId: string | undefined;
};

/**
 * PERF — CACHE PARTAGÉ ENTRE COMPOSANTS.
 *
 * `usePulse()` est appelé par DEUX hosts montés à la racine (PulseHost et PulseDeltaHost) : sans
 * cache, tout le pipeline — le moteur et un balayage des transactions sur 12 mois — tournait DEUX
 * FOIS à chaque rendu déclenché par une navigation.
 * Un `useMemo` ne peut rien y faire : il est local à une instance de composant.
 *
 * Même schéma que la palette de couleurs (hooks/useAppColors) : on mémorise le dernier couple
 * (entrées, résultat) au niveau du MODULE et on le réutilise tant que les entrées sont
 * identiques — comparaison par référence, les données viennent de react-query qui garantit une
 * référence stable tant que rien n'a changé.
 */
let pulseCache: { deps: PulseDeps; value: PulseData | null } | null = null;

function sameDeps(a: PulseDeps, b: PulseDeps): boolean {
  return a.pilotage === b.pilotage && a.transactions === b.transactions
    && a.accounts === b.accounts && a.projects === b.projects && a.preSavings === b.preSavings
    && a.reservations === b.reservations && a.financialProfile === b.financialProfile
    && a.answers === b.answers && a.config === b.config && a.relCfg === b.relCfg
    && a.snapshots === b.snapshots && a.userId === b.userId;
}

function sharedPulse(deps: PulseDeps): PulseData | null {
  const cached = pulseCache;
  if (cached && sameDeps(cached.deps, deps)) return cached.value;
  const value = buildPulse(deps);
  pulseCache = { deps, value };
  return value;
}

export function usePulse(): PulseData | null {
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: transactions = [] } = useTransactions(user?.id);
  const { data: accounts = [] } = useAllAccounts(user?.id);
  const { data: projects = [] } = useProjects(user?.id);
  const { data: preSavings } = usePreSavings(user?.id);
  const { data: reservations = [] } = useReservations(user?.id);
  const { data: financialProfile } = useFinancialProfile(user?.id);
  const { data: answers } = useQuestionnaireAnswers(user?.id);
  const { data: config } = usePulseConfig();
  const { data: relCfg } = useReliabilityConfig();
  const { data: snapshots = [] } = usePulseSnapshots(user?.id);

  return useMemo<PulseData | null>(
    () => sharedPulse({
      pilotage, transactions, accounts, projects, preSavings, reservations,
      financialProfile, answers, config, relCfg, snapshots, userId: user?.id,
    }),
    [
      pilotage, transactions, accounts, projects, preSavings, reservations,
      financialProfile, answers, config, relCfg, snapshots, user?.id,
    ],
  );
}

function buildPulse(deps: PulseDeps): PulseData | null {
  const {
    pilotage, transactions, accounts, projects, preSavings, reservations,
    financialProfile, answers, config, relCfg, snapshots, userId,
  } = deps;

  if (!pilotage || !config?.enabled) return null;
  const profileId = (financialProfile?.profile_id as FinancialProfileId) ?? 'P3';
  const today = new Date();

  // ── Relyka (budget réellement libre) : même formule que la carte du Pilotage.
  const currentMonth = monthKey(today);
  const reservationsTotal = (reservations as any[])
    .filter((r) => String(r.created_at ?? '').slice(0, 7) === currentMonth)
    .reduce((s, r) => s + Number(r.montant), 0);
  const cumulsTotal = (preSavings?.epargne.total_cumule ?? 0) + (preSavings?.invest.total_cumule ?? 0);
  const safetyMargin = pilotage.safety_margin_amount ?? 0;
  const relykaInputs = {
    cashflowTrough: pilotage.cashflow_trough ?? pilotage.current_checking_balance ?? 0,
    savingsFuture: pilotage.month_savings_future ?? 0,
    investFuture: pilotage.month_invest_future ?? 0,
    reservePlanned: pilotage.monthly_reserve_planned ?? 0,
    reservationsTotal,
    cumulsTotal,
    variableEnvelopeRemaining: pilotage.variable_envelope_remaining ?? 0,
    safetyMargin,
  };
  const relyka = computeRelyka(relykaInputs);

  // ── « Fin de mois » = ce qui devrait RESTER SUR LE COMPTE courant au 1er du mois prochain :
  // le point bas de trésorerie (récurrentes déjà dedans) MOINS ce qui va SORTIR du compte d'ici là
  // — virements épargne/invest à venir + dépenses variables restantes estimées.
  // On NE déduit PAS les montants RÉSERVÉS / cumulés : cet argent est mentalement mis de côté mais
  // reste PHYSIQUEMENT sur le compte (le déduire ici le compterait en double). Non clampé (peut
  // passer sous 0 = découvert prévu).
  const endOfMonthLeft =
    relykaInputs.cashflowTrough
    - relykaInputs.savingsFuture - relykaInputs.investFuture
    - relykaInputs.variableEnvelopeRemaining;

  // ── Confiance : chiffres douteux → le bilan est marqué « estimé ».
  const confidence = relCfg ? deriveRelykaConfidence(pilotage, relyka, relCfg) : null;
  const lowConfidence = confidence?.result.level === 'low';

  // ── Jamais dans le rouge : soldes de fin de mois rejoués à l'envers.
  const checkingIds = new Set(
    (accounts as any[]).filter((a) => a.type === 'checking' && !a.is_joint).map((a) => a.id),
  );
  const monthsWithoutOverdraft = computeMonthsWithoutOverdraft(
    pilotage.total_checking, transactions as any[], checkingIds, today,
  );

  // ── Patrimoine : total du jour, et celui d'il y a 3 mois (snapshot mensuel).
  const wealth = pilotage.total_checking + pilotage.total_savings + pilotage.total_invested;
  const key3mAgo = shiftMonth(currentMonth, -3);
  const snap3m = snapshots.find((s) => s.period_key === key3mAgo);
  const wealth3mAgo = snap3m ? Number(snap3m.wealth) : null;

  // ── Projets PERSO (les projets partagés ne sont pas le sujet de l'état des lieux).
  const progressById = new Map<string, any>(
    ((pilotage.projects_with_progress ?? []) as any[]).map((p) => [p.id as string, p]),
  );
  const pulseProjects = (projects as any[])
    .filter((p) => p.profile_id === userId && p.status === 'active')
    .map((p) => {
      const progress = progressById.get(p.id);
      const target = Number(p.target_amount) || 0;
      const progressPct = progress?.progress_percentage ?? 0;
      return { id: p.id, name: p.name as string, target, saved: (progressPct / 100) * target, progressPct };
    });

  const lastMonth = shiftMonth(currentMonth, -1);
  const hadActivityLastMonth = (transactions as any[]).some(
    (t) => !t.is_draft && String(t.date ?? '').slice(0, 7) === lastMonth,
  );

  /* ── CHIFFRES DU MOIS ÉCOULÉ ─────────────────────────────────────────────────────────────────
     Recalculés depuis les transactions réelles du mois concerné, pas depuis les agrégats « du
     mois en cours » du Pilotage. Mêmes définitions que celles du Suivi : les dépenses variables
     sont les sorties non récurrentes hors virements/régul ; l'épargné / l'investi sont les
     virements ARRIVÉS sur un compte d'épargne / d'investissement. */
  const typeByAccount = new Map<string, string>((accounts as any[]).map((a) => [a.id, a.type]));
  const inLastMonth = (t: any) => !t.is_draft && String(t.date ?? '').slice(0, 7) === lastMonth;
  let lastMonthVariable = 0, lastMonthSaved = 0, lastMonthInvested = 0;
  for (const t of transactions as any[]) {
    if (!inLastMonth(t)) continue;
    const amt = Number(t.amount) || 0;
    if (t.linked_account_id) {
      if (amt <= 0) continue;                                    // jambe ENTRANTE seulement
      const destType = typeByAccount.get(t.account_id);
      if (destType === 'savings') lastMonthSaved += amt;
      else if (destType === 'investment') lastMonthInvested += amt;
      continue;
    }
    /* La régularisation N'EST PLUS écartée : elle compte comme dépense variable, exactement
       comme dans le Pilotage (isBudgetExpense). L'exclure ici donnait deux totaux différents pour
       le même mois selon l'écran ouvert. */
    // Dépense variable = sortie NON récurrente (une occurrence matérialisée porte materialized_from).
    if (amt < 0 && !t.is_recurring && !t.materialized_from) lastMonthVariable += -amt;
  }
  /* CONSERVÉ du mois écoulé = ce qui a été mis en réserve PENDANT ce mois. Les réservations
     portent leur date de création : c'est la seule trace historique dont on dispose, et elle
     suffit — « conserver » est un geste daté, pas un état. */
  const lastMonthKept = (reservations as any[])
    .filter((r) => String(r.created_at ?? '').slice(0, 7) === lastMonth)
    .reduce((s, r) => s + Math.max(0, Number(r.montant) || 0), 0);

  /* Les signaux du bilan portent sur le MOIS ÉCOULÉ (dépenses variables), sauf ceux qui décrivent
     un état à date (matelas, patrimoine, fin de mois) : le bilan se lit après la clôture, donc
     souvent à la mi-septembre pour août. Servi avec les chiffres « à date », il aurait raconté
     septembre sous un titre parlant d'août — 3 jours de dépenses au lieu du mois complet. */
  const inputs: PulseInputs = {
    profileId,
    today,
    endOfMonthBalance: endOfMonthLeft,
    safetyMargin,
    // Réservé + réserve prévue + cumuls : dans le solde de fin de mois, PAS dans le Relyka.
    reservedOnAccount: relykaInputs.reservePlanned + relykaInputs.reservationsTotal + relykaInputs.cumulsTotal,
    spendingBudget: pilotage.variable_envelope_initial ?? 0,
    spendingSoFar: lastMonthVariable,
    savingsBalance: pilotage.total_savings,
    avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
    questionnaireQ3: (answers as any)?.q3 ?? null,
    totalWealth: wealth,
    wealth3mAgo,
    monthsWithoutOverdraft,
    projects: pulseProjects,
    lowConfidence,
  };

  return {
    monthly: computePulse(inputs, config),
    monthlyStats: { saved: lastMonthSaved, invested: lastMonthInvested, kept: lastMonthKept },
    profileId,
    relyka,
    wealth,
    hadActivityLastMonth,
    endOfMonthBalance: endOfMonthLeft,
    safetyMargin,
    variableEnvelopeRemaining: relykaInputs.variableEnvelopeRemaining,
    variableEnvelopeInitial: pilotage.variable_envelope_initial ?? 0,
  };
}
