/**
 * Règles du jardin : réglables en admin, jamais cassantes. La taille de l'arbre suit l'étape du profil.
 */
import { DEFAULT_GARDEN_RULES, mergeGardenRules } from '../lib/garden/gardenRules';
import { computeTreeState, type GardenInputs } from '../lib/garden/treeState';
import { treeSize } from '../lib/garden/scene3dLayout';

const base: GardenInputs = {
  currentBalance: 1000, minimumToKeep: 100, monthlyReference: 2000, securityMonths: 2,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 0, recurringInvestMonthly: 0, streakWeeks: 0, credits: [],
};

describe('mergeGardenRules', () => {
  it('rien en base → les valeurs par défaut', () => {
    expect(mergeGardenRules(undefined)).toEqual(DEFAULT_GARDEN_RULES);
    expect(mergeGardenRules('n’importe quoi')).toEqual(DEFAULT_GARDEN_RULES);
  });

  it('reprend une valeur valide, refuse une liste qui ne monte pas', () => {
    const r = mergeGardenRules({ rootsMarks: [2, 4, 8], cabinSteps: [50, 40, 60, 80], flowersFullPct: '30' });
    expect(r.rootsMarks).toEqual([2, 4, 8]);
    expect(r.cabinSteps).toEqual(DEFAULT_GARDEN_RULES.cabinSteps);
    expect(r.flowersFullPct).toBe(30);
  });

  it('borne les valeurs absurdes', () => {
    const r = mergeGardenRules({ growthByProfile: { P4: 7 }, bramblesMinPct: -10 });
    expect(r.growthByProfile.P4).toBe(1);
    expect(r.bramblesMinPct).toBe(0);
  });
});

describe('taille de l’arbre et profil financier', () => {
  it('l’arbre grandit avec l’étape du profil, du plus petit au plus grand', () => {
    const sizes = (['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'] as const).map((p) => treeSize(computeTreeState({ ...base, profileId: p }).growth));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(sizes[0]).toBe(1);
    expect(sizes[8]).toBe(7);
  });

  it('sans étape connue (P0), la taille se calcule sur l’épargne et les placements', () => {
    const calc = computeTreeState({ ...base, profileId: 'P0' }).growth;
    expect(calc).toBe(computeTreeState(base).growth);
    expect(calc).toBeGreaterThan(0.16);
  });

  it('les traits des racines suivent les règles', () => {
    const t = computeTreeState({ ...base, securityMonths: 5 }, mergeGardenRules({ rootsMarks: [2, 4, 8] }));
    expect(t.roots.markMonths).toEqual([2, 4, 8]);
    expect(t.roots.marks).toEqual({ one: true, three: true, six: false });
  });

  it('les étapes de la cabane suivent les règles', () => {
    const at = (remaining: number) => computeTreeState({ ...base, credits: [{ id: 'c', kind: 'healthy', remaining, borrowed: 1000 }] }, mergeGardenRules({ cabinSteps: [10, 20, 30, 40] })).cabin!.stage;
    expect([950, 850, 750, 650, 500].map(at)).toEqual([1, 2, 3, 4, 5]);
  });
});
