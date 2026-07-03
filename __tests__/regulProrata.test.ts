import { prorateClosureGap } from '../lib/regul';

describe('prorateClosureGap — répartition par jours calendaires', () => {
  it('intervalle entièrement DANS le mois qui se ferme → tout au mois', () => {
    // Du 1er au 30 juin, mois qui se ferme = juin.
    const r = prorateClosureGap(-100, '2026-06-01', '2026-06-30', '2026-06');
    expect(r.closingShare).toBeCloseTo(-100, 5);
    expect(r.currentShare).toBeCloseTo(0, 5);
    expect(r.closingDate).toBe('2026-06-30');
  });

  it('intervalle à cheval sur deux mois → prorata', () => {
    // Dernière vérif le 24 juin, réconciliation le 8 juillet : 6 j en juin (24→30), 14 j au total.
    const r = prorateClosureGap(-140, '2026-06-24', '2026-07-08', '2026-06');
    expect(r.totalDays).toBe(14);
    expect(r.daysInClosing).toBe(6);
    expect(r.closingShare).toBeCloseTo(-60, 5); // -140 × 6/14
    expect(r.currentShare).toBeCloseTo(-80, 5);
    expect(r.closingDate).toBe('2026-06-30');
  });

  it('cas limite : vérif le 1er du mois courant → rien au mois qui se ferme', () => {
    // Dernière vérif le 1er juillet, réconciliation le 8 juillet : 0 j en juin.
    const r = prorateClosureGap(-70, '2026-07-01', '2026-07-08', '2026-06');
    expect(r.daysInClosing).toBe(0);
    expect(r.closingShare).toBeCloseTo(0, 5);
    expect(r.currentShare).toBeCloseTo(-70, 5);
  });

  it('écart 0 → parts nulles, pas de division invalide', () => {
    const r = prorateClosureGap(0, '2026-06-24', '2026-07-08', '2026-06');
    expect(r.closingShare).toBe(0);
    expect(r.currentShare).toBe(0);
  });
});
