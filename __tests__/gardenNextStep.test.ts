/**
 * « Prochain pas » du Jardin : un seul geste, le plus utile d'abord — et toujours quelque chose à
 * proposer, y compris au-delà de 6 mois d'épargne.
 */
import { computeTreeState, type GardenInputs } from '../lib/garden/treeState';
import { computeNextStep } from '../lib/garden/nextStep';

const base: GardenInputs = {
  currentBalance: 2000, minimumToKeep: 300, monthlyReference: 2000, securityMonths: 7, relyka: 500,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 0, recurringInvestMonthly: 0,
  streakWeeks: 0, credits: [],
};
const step = (over: Partial<GardenInputs>) => {
  const i = { ...base, ...over };
  return computeNextStep(computeTreeState(i), i.monthlyReference, i.investedValue, i.recurringInvestMonthly);
};

describe('computeNextStep', () => {
  it('les ronces passent avant tout le reste', () => {
    expect(step({ securityMonths: 0.5, credits: [{ id: 'r', kind: 'expensive', remaining: 1500 }] }).kind).toBe('brambles');
  });

  it('sous 6 mois : le trait de racines suivant, avec sa progression', () => {
    const s = step({ securityMonths: 1.8 });
    expect(s.kind).toBe('roots');
    expect(s.progress).toEqual({ value: 1.8, target: 3 });
  });

  it('au-delà de 6 mois sans placement : planter un premier fruit, avec ce qui dépasse', () => {
    const s = step({ securityMonths: 7 });
    expect(s.kind).toBe('firstFruit');
    // les milliers sont séparés par une espace insécable (toLocaleString fr-FR)
    expect(s.text.replace(/\s/g, ' ')).toContain('2 000 €');
  });

  it('des placements sans versement mensuel : arroser ses fruits', () => {
    expect(step({ investedValue: 5000, investedContributed: 5000, investmentCount: 1 }).kind).toBe('dripFruits');
  });

  it('tout en place : les paliers de fruits, puis le grand arbre', () => {
    const grow = step({ investedValue: 16000, investedContributed: 15000, investmentCount: 2, recurringInvestMonthly: 200 });
    expect(grow.kind).toBe('growFruits');
    expect(grow.progress).toEqual({ value: 8, target: 12 });
    expect(step({ investedValue: 60000, investedContributed: 50000, investmentCount: 3, recurringInvestMonthly: 200 }).kind).toBe('grand');
  });
});
