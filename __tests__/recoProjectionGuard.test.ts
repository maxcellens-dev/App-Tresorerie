import { computeRecommendations } from '../lib/finance/recommendationEngine';

/**
 * Garde-fou MARGE × PROJECTION 6 MOIS des recommandations :
 * Épargner/Investir plafonnés pour que le point bas des soldes projetés reste au-dessus
 * de la marge (invest réduit en premier, excédent → Conserver, Σ recos = budget préservé).
 */

/**
 * Répartition explicite 40 / 10 / 20 / 30 → budget 1000 = 400/100/200/300.
 * Ces cas mesurent le GARDE-FOU, pas les pourcentages : ils les posent donc à la main plutôt que de
 * les tirer d'un palier (cf. la même note dans recoActionAmounts.test.ts).
 */
const ALLOC = { save: 40, invest: 10, enjoy: 20, keep: 30 };
const reco = (data: any, opts: any = {}) =>
  computeRecommendations(data, { manualAllocation: ALLOC, ...opts });

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
    const r = byType(reco(base, {}));
    expect(r.save.amount).toBe(400);
    expect(r.invest.amount).toBe(100);
    expect(r.enjoy.amount).toBe(200);
    expect(r.keep.amount).toBe(300);
  });

  it('headroom large + solde qui MONTE : montants intacts, récurrent tenable', () => {
    const recos = reco(base, {
      // Le solde progresse de 500 €/mois → surplus structurel 500, et le point bas reste
      // largement au-dessus de la marge.
      projectionGuard: { balances: [5000, 5000, 5500, 6000, 6500, 7000], margin: 2000 },
    });
    const r = byType(recos);
    // headroom = 3000 ≥ save+invest (500) → rien ne bouge.
    expect(r.save.amount).toBe(400);
    expect(r.invest.amount).toBe(100);
    expect(r.save.guard).toBeUndefined();
    // Tenable : 400 ≤ min(horizon 500, surplus 500).
    expect(r.save.recurringFit).toEqual({ kind: 'sustainable', monthly: 400 });
    expect(r.invest.recurringFit).toEqual({ kind: 'sustainable', monthly: 100 });
  });

  it("solde PLAT : rien n'est tenable en récurrent, même très au-dessus de la marge", () => {
    const recos = reco(base, {
      // 5 000 € stables, marge 2 000 : l'ancien test d'horizon concluait « tenable 400 €/mois »…
      // alors qu'un solde plat signifie ZÉRO surplus : 400 €/mois de plus, et le compte perd
      // 400 € par mois — il touche la marge au 8ᵉ mois et zéro au 13ᵉ.
      projectionGuard: { balances: [5000, 5000, 5000, 5000, 5000, 5000], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.save.amount).toBe(400); // le montant ponctuel du mois reste bon
    expect(r.save.recurringFit).toEqual({ kind: 'month_only' });
    expect(r.invest.recurringFit).toEqual({ kind: 'month_only' });
  });

  it('surplus plus petit que le disponible : plafonné au surplus mensuel', () => {
    const recos = reco(base, {
      // +150 €/mois de surplus, point bas très haut → c'est le surplus qui borne, pas la marge.
      projectionGuard: { balances: [9000, 9000, 9150, 9300, 9450, 9600], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.save.recurringFit).toEqual({ kind: 'capped', monthly: 150 });
    // invest (100) tient sous le surplus → durable.
    expect(r.invest.recurringFit).toEqual({ kind: 'sustainable', monthly: 100 });
  });

  it('headroom insuffisant : invest réduit en premier, excédent vers Conserver', () => {
    const recos = reco(base, {
      // point bas = 2300 → headroom 300 ; save+invest = 500 → excédent 200.
      projectionGuard: { balances: [2600, 2300, 2400, 2500, 2600, 2700], margin: 2000 },
    });
    const r = byType(recos);
    // invest (100) consommé en entier et disparaît ; save réduit de 100 → 300 ; keep 300+200 = 500.
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(300);
    // Garde-fou STRUCTURÉ : on pourrait ajouter 100 € (total possible 400 €). Texte composé côté écran.
    expect(r.save.guard).toEqual({ addMore: 100, total: 400 });
    expect(r.keep.amount).toBe(500);
    // Pas de garde-fou sur Conserver (la mise en réserve est déjà reflétée par le montant).
    expect(r.keep.guard).toBeUndefined();
    // Σ recos = budget (invariant de la jauge Relyka).
    const sum = recos.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBe(1000);
  });

  it('réduction sous le seuil d’affichage : tout le reste part en réserve (rien ne disparaît)', () => {
    const recos = reco(base, {
      // headroom = 450 → excédent 50 → invest passerait à 50 < seuil 100 → tout invest (100) en réserve.
      projectionGuard: { balances: [2450, 2500, 2600, 2700, 2800, 2900], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.invest).toBeUndefined();
    expect(r.save.amount).toBe(400); // l'excédent était couvert par invest seul
    expect(r.keep.amount).toBe(400); // 300 + 100
    expect(recos.reduce((s, x) => s + x.amount, 0)).toBe(1000);
  });

  it('récurrent non tenable : plafonné par la MARGE quand elle mord avant le surplus', () => {
    const recos = reco(base, {
      // Surplus confortable (+300 €/mois) mais on démarre juste au-dessus de la marge :
      // min((solde_k − 2000)/(k+1)) = (2600−2000)/1 = 600 au mois 0… et (4100−2000)/6 = 350 au
      // mois 5 → l'horizon borne à 350, sous le surplus de 300 ? non : le surplus (300) est plus
      // petit → c'est lui qui gagne.
      projectionGuard: { balances: [2600, 2900, 3200, 3500, 3800, 4100], margin: 2000 },
    });
    const r = byType(recos);
    expect(r.save.amount).toBe(400);
    // min(horizon, surplus 300) = 300 < 400 → plafonné à 300.
    expect(r.save.recurringFit).toEqual({ kind: 'capped', monthly: 300 });
    // invest 100 ≤ 300 → tenable.
    expect(r.invest.recurringFit).toEqual({ kind: 'sustainable', monthly: 100 });
  });

  it('point bas déjà sous la marge : tout en réserve (frein complet)', () => {
    const recos = reco(base, {
      projectionGuard: { balances: [2600, 1900, 2200, 2400, 2600, 2800], margin: 2000 },
    });
    expect(recos).toHaveLength(1);
    expect(recos[0].type).toBe('keep');
    expect(recos[0].amount).toBe(1000);
    expect(recos[0].guardNote).toContain('marge de sécurité');
  });

  it('marge à 0 : garde-fou inactif', () => {
    const recos = reco(base, {
      projectionGuard: { balances: [100, 100, 100, 100, 100, 100], margin: 0 },
    });
    const r = byType(recos);
    expect(r.save.amount).toBe(400);
    expect(r.save.guardNote).toBeUndefined();
    expect(r.save.recurringFit).toBeUndefined();
  });
});
