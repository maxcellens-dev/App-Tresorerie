/**
 * useProfileReliability — « à quel point Relyka sait-il de quoi il parle ? », branché aux données.
 *
 * Le calcul est PUR et vit dans lib/finance/profileReliability : ce hook ne fait que rassembler ses
 * entrées depuis les sources déjà chargées (aucun aller-retour réseau supplémentaire) et mémoïser
 * le résultat.
 *
 * ⚠️ Il lit le matelas avec EXACTEMENT les mêmes règles que le moteur de profil — même fonction,
 * même garde sur les charges connues. Sinon l'écran annoncerait « profil fiable » sur une base que
 * le classement, lui, aurait jugée trop incomplète pour s'en servir.
 */
import { useMemo } from 'react';
import { usePilotageData } from './usePilotageData';
import { useProfile } from '../data/useProfile';
import { computeSecurityCushion } from '../../lib/finance/securityCushion';
import {
  computeProfileReliability,
  monthsOfHistorySince,
  type ProfileReliability,
} from '../../lib/finance/profileReliability';

/** Jours écoulés depuis une date ISO, ou `null` si elle est absente/illisible. */
function daysSince(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400000));
}

export function useProfileReliability(userId: string | undefined): ProfileReliability | null {
  const { data: pilotage } = usePilotageData(userId);
  const { data: profile } = useProfile(userId);

  return useMemo(() => {
    if (!pilotage) return null;
    const hasRecurringExpenses = !!pilotage.has_recurring_expenses;
    const cushion = computeSecurityCushion({
      availableSavings: pilotage.current_savings ?? 0,
      monthlyEssentialExpenses: pilotage.monthly_essential_expenses ?? 0,
      recurringExpensesKnown: hasRecurringExpenses,
      avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
    });
    const today = new Date();
    return computeProfileReliability({
      avgMonthlyIncome: pilotage.avg_monthly_income ?? 0,
      incomeSource: pilotage.expected_income_source ?? 'none',
      hasSavingsAccount: !!pilotage.has_savings_account,
      hasRecurringExpenses,
      cushionBase: cushion.base,
      variableEnvelopeSource: pilotage.variable_envelope_source ?? 'none',
      monthsOfHistory: monthsOfHistorySince((profile as any)?.created_at, today),
      daysSinceVerification: daysSince(pilotage.confidence_inputs?.lastVerifiedAt, today),
    });
  }, [pilotage, profile]);
}
