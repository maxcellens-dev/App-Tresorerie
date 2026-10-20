/**
 * Mise en page de la scène 3D : chaque donnée choisit la bonne image, et rien ne sort du cadre.
 */
import { computeTreeState, type GardenInputs } from '../lib/garden/treeState';
import { FRAME_H, FRAME_W, layoutScene, pepinLayers, rootLevel, skyStops, treeSize, VEIL } from '../lib/garden/scene3dLayout';
import { SCENE3D, SCENE3D_IMG } from '../lib/garden/scene3dAssets';

const inputs: GardenInputs = {
  currentBalance: 1653, minimumToKeep: 200, monthlyReference: 1900, securityMonths: 1.8,
  investedValue: 0, investedContributed: 0, enjoyThisMonth: 96,
  recurringSavingsMonthly: 0, recurringInvestMonthly: 0, consecutiveSavingMonths: 3, streakWeeks: 6,
  credits: [{ id: 'auto', kind: 'healthy', remaining: 4300, borrowed: 10000 }],
};
const opts = { season: 'summer' as const, moment: 'day' as const };
const all = (s: ReturnType<typeof layoutScene>) => [...s.back, ...s.front];

describe('scene3dLayout', () => {
  it('les racines suivent les mois de secours, la nappe au-delà de 6 mois', () => {
    expect(rootLevel(0, false)).toBe('r0');
    expect(rootLevel(0.5, false)).toBe('r1');
    expect(rootLevel(1, false)).toBe('r2');
    expect(rootLevel(3.2, false)).toBe('r4');
    expect(rootLevel(6, false)).toBe('r6');
    expect(rootLevel(9, true)).toBe('aquifer');
    // les repères sont posés sur les pointes réelles des racines, de haut en bas
    expect(SCENE3D.marks.one).toBeLessThan(SCENE3D.marks.three);
    expect(SCENE3D.marks.three).toBeLessThan(SCENE3D.marks.six);
  });

  it("l'arbre grandit par paliers, de la pousse au grand arbre", () => {
    expect(treeSize(0.16)).toBe(1);
    expect(treeSize(0.3)).toBe(3);
    expect(treeSize(1)).toBe(7);
  });

  it('toutes les images utilisées existent, et tout reste dans le cadre', () => {
    for (const growth of [0.16, 0.3, 0.6, 1]) {
      const s = layoutScene({ ...computeTreeState(inputs), growth, brambles: 1, flowers: 5, fruits: 10, fruitTier: 10 }, { ...opts, decor: ['lantern', 'birdhouse', 'bench', 'mushrooms', 'fence', 'pond'] });
      for (const l of all(s)) {
        expect(SCENE3D_IMG[l.img]).toBeDefined();
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.x + l.w).toBeLessThanOrEqual(FRAME_W);
        expect(l.y + l.h).toBeLessThanOrEqual(FRAME_H + 1);
      }
    }
  });

  it("l'arrosoir n'a pas d'eau quand tout est prévu, et la cabane se construit", () => {
    const st = computeTreeState(inputs);
    expect(all(layoutScene({ ...st, water: 0 }, opts)).some((l) => l.img === 'can_water')).toBe(false);
    const half = all(layoutScene({ ...st, water: 0.5 }, opts)).find((l) => l.img === 'can_water')!;
    const full = all(layoutScene({ ...st, water: 1 }, opts)).find((l) => l.img === 'can_water')!;
    expect(half.showBottom!).toBeLessThan(full.showBottom!);
    const cabin = all(layoutScene({ ...st, cabin: { progress: 0, count: 1 } }, opts)).find((l) => l.img === 'cabin')!;
    expect(cabin.showBottom).toBeCloseTo(0.25);
  });

  it('sans cabane, le grand arbre perd sa branche nue', () => {
    const st = { ...computeTreeState(inputs), growth: 1 };
    expect(all(layoutScene({ ...st, cabin: null }, opts)).find((l) => l.key === 'tree')!.img).toBe('tree_adultBare_summer');
    expect(all(layoutScene(st, opts)).find((l) => l.key === 'tree')!.img).toBe('tree_adult_summer');
  });

  it('Pépin dort la nuit, et son écharpe rouge passe par-dessus les bottes', () => {
    const st = computeTreeState(inputs);
    expect(all(layoutScene(st, { ...opts, moment: 'night' })).some((l) => l.img === 'pepin_sleep')).toBe(true);
    expect(pepinLayers('joy', { neck: 'scarf_red', feet: 'boots', head: 'straw_hat', eyes: 'sunglasses' }))
      .toEqual(['pepin_joy', 'pepin_acc_boots', 'pepin_acc_sunglasses', 'pepin_acc_hat', 'pepin_scarf_red_joy']);
  });

  it('le ciel sous le voile retrouve la teinte voulue une fois voilé', () => {
    const veil = VEIL.night!, top = skyStops('summer', 'night')[0];
    const pre = [1, 3, 5].map((i) => parseInt(top.slice(i, i + 2), 16));
    const seen = pre.map((v, c) => Math.round(v * (1 - veil.a) + veil.rgb[c] * veil.a));
    expect(seen.map((v) => v.toString(16).padStart(2, '0')).join('')).toBe('0c1530');
  });
});
