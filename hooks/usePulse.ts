/**
 * LE POULS — assemblage des données réelles → moteur pur (lib/pulseEngine).
 *
 * Ne calcule rien de neuf : tout vient de sources qui existent déjà (usePilotageData, profil P1–P5,
 * comptes, projets, moteur de confiance). Une seule règle : ce hook LIT, le moteur JUGE.
 */
import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePilotageData } from './usePilotageData';
import { useTransactions } from './useTransactions';
import { useAllAccounts } from './useAccounts';
import { useProjects } from './useProjects';
import { useProfile } from './useProfile';
import { usePreSavings } from './usePreSavings';
import { useReservations } from './useReservations';
import { useFinancialProfile, useQuestionnaireAnswers } from './useFinancialProfile';
import { usePulseConfig } from './usePulseConfig';
import { useReliabilityConfig, deriveRelykaConfidence } from './useReliability';
import { usePulseSnapshots } from './usePulseState';
import { computePulse, monthKey, type PulseInputs, type PulseResult } from '../lib/pulseEngine';
import { computeInvestmentGains } from '../lib/investment';
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
  /** L'état des lieux COMPLET (tous les signaux du profil) — mensuel + consultation à la demande. */
  result: PulseResult;
  /** Le pouls HEBDO, léger (3 signaux max) — la carte de la semaine. */
  weekly: PulseResult;
  profileId: FinancialProfileId;
  /** Relyka du jour — sert aux delta chips (avant / après une saisie). */
  relyka: number;
  /** Patrimoine du jour — persisté dans le snapshot pour l'évolution à 3 mois. */
  wealth: number;
  /**
   * L'utilisateur a-t-il vécu le mois précédent dans l'app ? Sans ça, on lui servirait un « état des
   * lieux » d'un mois où il n'existait pas — le pire premier contact possible.
   */
  hadActivityLastMonth: boolean;
}

export function usePulse(): PulseData | null {
  const { user } = useAuth();
  const { data: pilotage } = usePilotageData(user?.id);
  const { data: profile } = useProfile(user?.id);
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

  return useMemo<PulseData | null>(() => {
    if (!pilotage || !config?.enabled) return null;
    const profileId = (financialProfile?.profile_id as FinancialProfileId) ?? 'P3';
    const today = new Date();

    // ── Relyka (budget réellement libre) : même formule que la carte du Pilotage.
    const currentMonth = monthKey(today);
    const reservationsTotal = (reservations as any[])
      .filter((r) => String(r.created_at ?? '').slice(0, 7) === currentMonth)
      .reduce((s, r) => s + Number(r.montant), 0);
    const cumulsTotal = (preSavings?.epargne.total_cumule ?? 0) + (preSavings?.invest.total_cumule ?? 0);
    const relyka = computeRelyka({
      cashflowTrough: pilotage.cashflow_trough ?? pilotage.current_checking_balance ?? 0,
      savingsFuture: pilotage.month_savings_future ?? 0,
      investFuture: pilotage.month_invest_future ?? 0,
      reservePlanned: pilotage.monthly_reserve_planned ?? 0,
      reservationsTotal,
      cumulsTotal,
      variableEnvelopeRemaining: pilotage.variable_envelope_remaining ?? 0,
      safetyMargin: pilotage.safety_margin_amount ?? 0,
    });

    // ── Confiance : chiffres douteux → le Pouls ne juge pas (tout passe en « estimé »).
    const confidence = relCfg ? deriveRelykaConfidence(pilotage, relyka, relCfg) : null;
    const lowConfidence = confidence?.result.level === 'low';

    // ── Capacité d'investissement du mois : ce qu'il POUVAIT placer (budget libre + déjà placé),
    // à hauteur de l'allocation de son profil. Sans ça, la capacité tomberait à 0 en fin de mois.
    const investPct = Number((profile as any)?.allocation_invest_percent ?? 25);
    const investedThisMonth = Math.max(0, pilotage.real_invest ?? 0);
    const investCapacity = Math.max(0, (relyka + investedThisMonth) * (investPct / 100));

    // ── Investissement : ce que ça a rapporté (plus/moins-values saisies sur les comptes d'invest).
    const { gains } = computeInvestmentGains(transactions as any[]);

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
    const snap3m = snapshots.find((s) => s.period_kind === 'month' && s.period_key === key3mAgo);
    const wealth3mAgo = snap3m ? Number(snap3m.wealth) : null;

    // ── Projets PERSO (les projets partagés ne sont pas le sujet du Pouls).
    const progressById = new Map(
      (pilotage.projects_with_progress ?? []).map((p) => [p.id, p]),
    );
    const pulseProjects = (projects as any[])
      .filter((p) => p.profile_id === user?.id && p.status === 'active')
      .map((p) => {
        const progress = progressById.get(p.id);
        const target = Number(p.target_amount) || 0;
        const progressPct = progress?.progress_percentage ?? 0;
        const saved = (progressPct / 100) * target;
        return {
          id: p.id,
          name: p.name as string,
          target,
          saved,
          progressPct,
          onTrack: isProjectOnTrack(p, saved, target, today),
        };
      });

    const inputs: PulseInputs = {
      profileId,
      today,
      endOfMonthBalance: pilotage.projection_balances_6m?.[0] ?? pilotage.cashflow_trough ?? 0,
      safetyMargin: pilotage.safety_margin_amount ?? 0,
      spendingBudget: pilotage.variable_envelope_initial ?? 0,
      spendingSoFar: pilotage.variable_envelope_spent ?? 0,
      savingsBalance: pilotage.total_savings,
      // Ce qui est RÉELLEMENT parti à l'épargne ce mois-ci (hors projets : ils ont leur propre signal).
      savedThisMonth: Math.max(0, pilotage.real_savings_excl_projects ?? 0),
      avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
      questionnaireQ3: (answers as any)?.q3 ?? null,
      investedBalance: pilotage.total_invested,
      investedThisMonth,
      investmentGains: gains,
      investCapacity,
      totalWealth: wealth,
      wealth3mAgo,
      monthsWithoutOverdraft,
      projects: pulseProjects,
      lowConfidence,
    };

    const lastMonth = shiftMonth(currentMonth, -1);
    const hadActivityLastMonth = (transactions as any[]).some(
      (t) => !t.is_draft && String(t.date ?? '').slice(0, 7) === lastMonth,
    );

    return {
      result: computePulse(inputs, config, 'full'),
      weekly: computePulse(inputs, config, 'week'),
      profileId,
      relyka,
      wealth,
      hadActivityLastMonth,
    };
  }, [
    pilotage, profile, transactions, accounts, projects, preSavings, reservations,
    financialProfile, answers, config, relCfg, snapshots, user?.id,
  ]);
}

/**
 * Le projet suit-il son plan ? On compare ce qui est mis de côté à ce qui aurait dû l'être :
 *  • versement mensuel prévu → mois écoulés × versement ;
 *  • sinon échéance → part du temps écoulé × montant cible ;
 *  • ni l'un ni l'autre (projet ponctuel) → rien à juger, il est « dans les temps ».
 * Tolérance de 10 % : un mois de décalage ne doit pas afficher « en retard ».
 */
function isProjectOnTrack(project: any, saved: number, target: number, today: Date): boolean {
  const start = String(project.first_payment_date ?? project.created_at ?? '').slice(0, 10);
  if (!start) return true;
  const startDate = new Date(start + 'T00:00:00');
  if (Number.isNaN(startDate.getTime()) || startDate > today) return true;

  const monthsElapsed =
    (today.getFullYear() - startDate.getFullYear()) * 12 + (today.getMonth() - startDate.getMonth());

  const monthly = Number(project.monthly_allocation) || 0;
  if (monthly > 0) {
    const expected = Math.max(0, monthsElapsed) * monthly;
    return saved >= expected * 0.9;
  }

  const targetDate = project.target_date ? new Date(String(project.target_date) + 'T00:00:00') : null;
  if (targetDate && !Number.isNaN(targetDate.getTime()) && targetDate > startDate && target > 0) {
    const total = targetDate.getTime() - startDate.getTime();
    const done = Math.min(total, Math.max(0, today.getTime() - startDate.getTime()));
    const expected = (done / total) * target;
    return saved >= expected * 0.9;
  }

  return true;
}
