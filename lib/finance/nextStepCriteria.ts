/**
 * LE PROCHAIN PALIER — ce qu'il faut pour passer à l'étape suivante du parcours, critère par
 * critère, avec où tu en es. Fonction PURE, testée (__tests__/nextStepCriteria.test.ts).
 *
 * Les critères sont EXACTEMENT ceux du classement (financialProfileEngine › classifyProfile, sens
 * « montée ») et les seuils viennent de la base (`thresholdsFromMatrix`) : on n'invente aucune règle,
 * on dit seulement, en clair, ce que le moteur exige.
 *   P1 → P2 : ce qui rentre couvre ce qui sort (pas de chiffre : c'est la trajectoire qui décide) ;
 *   P2 → P5 : des mois d'épargne de secours ;
 *   P5 → P6 : en plus, un montant placé qui compte ;
 *   P6 → P9 : un patrimoine (épargne + placements), la réserve pleine, et une part placée.
 */
import type { ProfileThresholds } from './financialProfileEngine';

export type StepId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9';
const ORDER: StepId[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'];

export interface StepCriterion {
  key: 'viable' | 'months' | 'invested' | 'wealth' | 'share';
  label: string;
  /** null : critère qualitatif (pas de jauge). */
  current: number | null;
  target: number | null;
  unit: 'months' | 'money' | 'pct' | null;
  met: boolean;
}

export interface NextStep {
  next: StepId;
  criteria: StepCriterion[];
}

export interface StepInputs {
  /** Matelas de sécurité, en mois de dépenses (computeSecurityCushion) ; null = inconnu. */
  months: number | null;
  /** Épargne disponible. */
  savings: number;
  /** Valeur des placements. */
  invested: number;
}

/** `null` : étape inconnue (P0), ou déjà la plus haute. */
export function nextStepCriteria(current: string | null, T: ProfileThresholds, i: StepInputs): NextStep | null {
  const idx = ORDER.indexOf(current as StepId);
  if (idx < 0 || idx === ORDER.length - 1) return null;
  const next = ORDER[idx + 1];
  const months = Math.max(0, i.months ?? 0);
  const invested = Math.max(0, i.invested);
  const wealth = Math.max(0, i.savings) + invested;

  const monthsCrit = (target: number): StepCriterion => ({
    key: 'months', label: "Mois d'épargne de secours", current: months, target, unit: 'months', met: months >= target,
  });
  const investedCrit: StepCriterion = {
    key: 'invested', label: 'Montant placé', current: invested, target: T.investedMinUp, unit: 'money', met: invested > 0 && invested >= T.investedMinUp,
  };

  if (next === 'P2') {
    return { next, criteria: [{ key: 'viable', label: 'Ce qui rentre chaque mois couvre ce qui sort', current: null, target: null, unit: null, met: false }] };
  }
  if (next === 'P3' || next === 'P4' || next === 'P5') return { next, criteria: [monthsCrit(T.monthsUp[next])] };
  if (next === 'P6') return { next, criteria: [monthsCrit(T.monthsUp.P6), investedCrit] };

  const top = next as 'P7' | 'P8' | 'P9';
  const share = wealth > 0 ? invested / wealth : 0;
  return {
    next,
    criteria: [
      { key: 'wealth', label: 'Patrimoine (épargne + placements)', current: wealth, target: T.wealthUp[top], unit: 'money', met: wealth >= T.wealthUp[top] },
      monthsCrit(T.wealthMinMonths[top]),
      investedCrit,
      { key: 'share', label: 'Part de ton patrimoine placée', current: Math.round(share * 100), target: Math.round(T.wealthInvestedShareUp * 100), unit: 'pct', met: share >= T.wealthInvestedShareUp },
    ],
  };
}
