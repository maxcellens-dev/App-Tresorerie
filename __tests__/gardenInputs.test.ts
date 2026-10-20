/**
 * Des données réelles (pilotage_data, crédits, gains, série) aux entrées de l'arbre.
 * Le matelas doit être EXACTEMENT celui du profil financier : même fonction, mêmes entrées.
 */
import { buildGardenInputs, creditKind, EXPENSIVE_CREDIT_RATE } from '../lib/garden/gardenInputs';
import { computeSecurityCushion } from '../lib/finance/securityCushion';
import { computeTreeState } from '../lib/garden/treeState';

const pilotage = {
  current_checking_balance: 1653, safety_margin_amount: 200, current_savings: 3420,
  monthly_essential_expenses: 1900, has_recurring_expenses: true, avg_monthly_income: 2600,
  total_invested: 0, monthly_savings_planned: 300, monthly_invest_planned: 0,
};

describe('buildGardenInputs', () => {
  it('reprend le matelas du profil financier (même fonction, mêmes entrées)', () => {
    const inputs = buildGardenInputs({ pilotage, investmentGains: 0, enjoyAmount: 96, streakWeeks: 6, credits: [] });
    const cushion = computeSecurityCushion({ availableSavings: 3420, monthlyEssentialExpenses: 1900, recurringExpensesKnown: true, avgMonthlyIncome: 2600 });
    expect(inputs.securityMonths).toBeCloseTo(cushion.months!, 6);
    expect(inputs.monthlyReference).toBe(cushion.reference);
    expect(inputs.currentBalance).toBe(1653);
    expect(inputs.minimumToKeep).toBe(200);
    expect(inputs.enjoyThisMonth).toBe(96);
    expect(inputs.recurringSavingsMonthly).toBe(300);
  });

  it('sans charges récurrentes, retombe sur le revenu (repli prudent du moteur existant)', () => {
    const inputs = buildGardenInputs({ pilotage: { ...pilotage, has_recurring_expenses: false }, investmentGains: 0, enjoyAmount: 0, streakWeeks: 0, credits: [] });
    expect(inputs.monthlyReference).toBe(2600);
  });

  it('les gains des placements deviennent des fruits', () => {
    const inputs = buildGardenInputs({ pilotage: { ...pilotage, total_invested: 12000 }, investmentGains: 2000, enjoyAmount: 0, streakWeeks: 0, credits: [] });
    expect(inputs.investedValue - inputs.investedContributed).toBe(2000);
    expect(computeTreeState(inputs).fruits).toBeGreaterThan(0);
  });

  it('un crédit cher (taux élevé) donne des ronces, un crédit sain une cabane', () => {
    expect(creditKind(EXPENSIVE_CREDIT_RATE)).toBe('expensive');
    expect(creditKind(3.9)).toBe('healthy');
    const inputs = buildGardenInputs({ pilotage, investmentGains: 0, enjoyAmount: 0, streakWeeks: 0, credits: [
      { id: 'auto', rateAnnual: 3.9, principal: 10000, remaining: 4300 },
      { id: 'revo', rateAnnual: 19, principal: 3000, remaining: 3000 },
    ] });
    const tree = computeTreeState(inputs);
    expect(tree.cabin?.count).toBe(1);
    expect(tree.cabin?.progress).toBeCloseTo(0.57, 2);
    expect(tree.brambles).toBeGreaterThan(0);
  });

  it('tolère des données incomplètes (compte neuf)', () => {
    const inputs = buildGardenInputs({ pilotage: {}, investmentGains: NaN, enjoyAmount: NaN, streakWeeks: NaN, credits: [] });
    const tree = computeTreeState(inputs);
    expect(JSON.stringify(tree).replace(/"cabin":null/, "")).not.toMatch(/NaN|Infinity|null/);
    expect(tree.stage).toBe('sprout');
  });
});
