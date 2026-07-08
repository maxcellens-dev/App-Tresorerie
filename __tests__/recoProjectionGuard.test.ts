import { computeRecommendations } from '../lib/recommendationEngine';

/**
 * Garde-fou MARGE × PROJECTION 6 MOIS des recommandations :
 * Épargner/Investir plafonnés pour que le point bas des soldes projetés reste au-dessus
 * de la marge (invest réduit en premier, excédent → Conserver, Σ recos = budget préservé).
 */

// Palier « below_optimal » (épargne 8000 entre min 5000 et optimal 10000) :
// save 40 % / invest 10 % / enjoy 20 % / keep 30 %. Budget 1000 → 400/100/200/300.
const base: any = {
  safe_to_spend: 1000,
  safety_margin_amount: 2000,
  projection_in_danger: false,
  current_savings: 8000,
  safety_threshold_min: 5000,
  safety_threshold_optimal: 10000,
  safety_threshold_comfort: 20000,
  variable_trend_percentage: 100,
  committed_allocations: 0,
  remaining_fixed_expenses: 0,
  current_checking_balance: 2600,
  total_checking: 2600,
  total_savings: 8000,
  total_invested: 5000,
  avg_monthly_income: 2500,
};

const byType = (recos: any[]) => Object.fromEntries(recos.map((r) => [r.type, r]));

describe('computeRecommendations — garde-fou marge × projection', () => {
  it('sans garde-fou : répartition du palier intacte', () => {
    const r = byType(computeRecommendations(base, {}));
    expect(r.save.amount).toBe(400);
    expect(r.invest.amount).toBe(100);
    expect(r.enjoy.amount).toBe(200);
    expect(r.keep.amount).toBe(300);
  });

  it('headroom large : montants intacts + conseil « virement récurrent tenable »', () => {
    const recos = computeRecommendations(base, {
      projectionGuard: { balances: [5000, 5000, 5000, 5000, 5000, 5000], margin: 2000 },
    });
    const r = byType(recos);
    // headroom = 3000 ≥ save+invest (500) → rien ne bouge.
    expect(r.save.amount).toBe(400);
    expect(r.invest.amount).toBe(100);
    expect(r.save.guardNote).toBeUndefined();
    // Tenable en récurrent : min((5000−2000)/(k+1)) = 500 ≥ 400.
    expect(r.save.recurringNote).toContain('Tenable chaque mois');
    expect(r.invest.recurringNote).toContain('Tenable chaque mois');
  });

  it('headroom insuffisant : invest réduit en premier, excédent vers Conserver', () => {
    const recos = computeRecommendations(base, {
      // point bas = 2300 → headroom 300 ; save+invest = 500 → excédent 200.
      projectionGuard: { balances: [2600, 2300, 2400, 2500, 2600, 2700], margin: 2000 },
    });
    const r = byType(recos);
    // invest (100) consommé en entier et disparaît ; save réduit de 100 → 300 ; keep 300+200 = 500.
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(300);
    expect(r.save.guardNote).toContain('Réduit de');
    expect(r.keep.amount).toBe(500);
    expect(r.keep.guardNote).toContain('mis en réserve');
    // Σ recos = budget (invariant de la jauge Relyka).
    const sum = recos.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBe(1000);
  });

  it('réduction sous le seuil d’affichage : tout le reste part en réserve (rien ne disparaît)', () => {
    const recos = computeRecommendations(base, {
      // headroom = 450 → excédent 50 → invest passerait à 50 < seuil 100 → tout invest (100) en réserve.
      projectionGuard: { balances: [2450, 2500, 2600, 2700, 2800, 2900], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(400); // l'excédent était couvert par invest seul
    expect(r.keep.amount).toBe(400); // 300 + 100
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(1000);
  });

  it('récurrent non tenable : conseil avec plafond mensuel', () => {
    const recos = computeRecommendations(base, {
      // headroom = 600 (pas de réduction 1×), mais 400/mois répétés cassent la marge :
      // min((solde_k − 2000)/(k+1)) = (2600−2000)/6 = 100 → « reste sous 100 €/mois ».
      projectionGuard: { balances: [2600, 2600, 2600, 2600, 2600, 2600], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.save.amount).toBe(400);
    expect(r.save.recurringNote).toContain('reste sous 100');
    // invest 100 ≤ 100 → tenable.
    expect(r.invest.recurringNote).toContain('Tenable chaque mois');
  });

  it('point bas déjà sous la marge : tout en réserve (frein complet)', () => {
    const recos = computeRecommendations(base, {
      projectionGuard: { balances: [2600, 1900, 2200, 2400, 2600, 2800], margin: 2000 },
    });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(1000);
    expect(recos[0].guardNote).toContain('marge de sécurité');
  });

  it('marge à 0 : garde-fou inactif', () => {
    const recos = computeRecommendations(base, {
      projectionGuard: { balances: [100, 100, 100, 100, 100, 100], margin: 0 },
    });
    const r = byType(recos);
    expect(r.save.amount).toBe(400);
    expect(r.save.guardNote).toBeUndefined();
    expect(r.save.recurringNote).toBeUndefined();
  });
});
