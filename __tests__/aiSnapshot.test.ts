import { buildSnapshot, type SnapshotInput } from '../lib/aiSnapshot';

/** Pilotage minimal (tous les champs lus par buildSnapshot). */
const pilotage: any = {
  total_checking: 2600, total_savings: 8000, total_invested: 5000,
  safe_to_spend: 500, safety_margin_amount: 2000,
  projection_min_buffer: 2400, projection_in_danger: false,
  expected_monthly_income: 1200, expected_income_confidence: 1, expected_income_source: 'explicit',
  avg_monthly_income: 2100,
  monthly_savings_planned: 200, monthly_invest_planned: 100,
  monthly_savings_remaining: 200, monthly_invest_remaining: 100,
  real_savings_excl_projects: 0, real_invest: 0,
  projected_surplus: 0,
  month_expenses_total: 1600, month_expenses_past: 1000, month_expenses_remaining: 600,
  current_month_variable: 300, avg_variable_expenses_3m: 316,
  variable_envelope_initial: 600, variable_envelope_spent: 300, variable_envelope_remaining: 300,
  variable_envelope_source: 'history', variable_envelope_months_used: 3,
  remaining_fixed_expenses: 400,
  recommendation: 'À ÉPARGNER',
};

const base = (over: Partial<SnapshotInput> = {}): SnapshotInput => ({
  currencySymbol: '€', today: '2026-07-08', dayOfMonth: 8, daysInMonth: 31,
  pilotage, expensesByCategory: [],
  ...over,
});

// toLocaleString('fr-FR') sépare les milliers par une espace insécable étroite → on normalise.
const build = (input: SnapshotInput) => buildSnapshot(input).replace(/[  ]/g, ' ');

describe('buildSnapshot — revenu de référence & garde-fous', () => {
  it('revenu de référence = moyenne des recettes mensuelles saisies', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
    }));
    expect(txt).toContain('Revenu de référence utilisé pour ces ratios : 2 100 €/mois');
    expect(txt).toContain('moyenne des recettes mensuelles saisies (2 mois avec recettes');
    // Réserve en MOIS DE REVENUS (8000 / 2100 ≈ 3.8), pas en mois de dépenses.
    expect(txt).toContain('~3.8 mois de revenus');
  });

  it('aucune recette : pas de %, message « revenus peut-être pas saisis »', () => {
    const txt = build(base({
      incomeRef: { avg: 0, monthsUsed: 0, monthsWithoutIncome: 1, transfersAvg: 0, source: 'none' },
      pilotage: { ...pilotage, avg_monthly_income: 0 },
    }));
    expect(txt).toContain('Aucun revenu de référence calculable');
    expect(txt).toContain('pas encore saisi ses revenus');
  });

  it('virements entrants depuis un compte « autre » = revenu de fait', () => {
    const txt = build(base({
      incomeRef: { avg: 1800, monthsUsed: 3, monthsWithoutIncome: 3, transfersAvg: 1800, source: 'virements' },
    }));
    expect(txt).toContain('moyenne des virements reçus sur les comptes courants');
    expect(txt).toContain('ces virements font office de revenu');
  });

  it('projection : plafonds marge (ponctuel + récurrent) alignés sur les recos de l’app', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      forecast: [
        { ym: '2026-07', balance: 2600 }, { ym: '2026-08', balance: 2600 }, { ym: '2026-09', balance: 2600 },
        { ym: '2026-10', balance: 2600 }, { ym: '2026-11', balance: 2600 }, { ym: '2026-12', balance: 2600 },
      ],
    }));
    // headroom = 2600 − 2000 = 600 ; récurrent max = (2600−2000)/6 = 100 €/mois.
    expect(txt).toContain('capacité de mise de côté PONCTUELLE ce mois-ci ≤ 600 €');
    expect(txt).toContain('max soutenable ≈ 100 €/mois');
  });

  it('1ᵉʳ mois d’app : astérisque + avertissement saisie incomplète', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      history: [
        { ym: '2026-05', income: 2799, expenses: 500, fixed: 200, variable: 300 },
        { ym: '2026-06', income: 1700, expenses: 1200, fixed: 900, variable: 300 },
      ],
      firstMonthPartial: true,
    }));
    expect(txt).toContain('- 2026-05* :');
    expect(txt).toContain('1ᵉʳ mois d\'utilisation de l\'app');
  });

  it('dépenses variables : référence = enveloppe du pilotage (pas une moyenne divergente)', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
    }));
    expect(txt).toContain('enveloppe mensuelle 600 €');
    expect(txt).toContain('calculée sur l\'historique (3 mois fiables)');
  });
});

