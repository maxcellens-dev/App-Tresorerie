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
      savingsInvestForecast: { savingsNow: 8000, investNow: 5000, savings6: 9200, savings12: 10400, invest6: 5600, invest12: 6200 },
    }));
    // headroom = 2600 − 2000 = 600 ; récurrent max = (2600−2000)/6 = 100 €/mois.
    expect(txt).toContain('capacité de mise de côté PONCTUELLE ce mois-ci ≤ 600 €');
    expect(txt).toContain('max soutenable ≈ 100 €/mois');
    // Repères 6/12 mois + poches projetées (hors rendement).
    expect(txt).toContain('solde courant dans 6 mois ≈ 2 600 €');
    expect(txt).toContain('Épargne projetée (virements déjà saisis, HORS rendement) : ≈ 9 200 € dans 6 mois · ≈ 10 400 € dans 12 mois');
    expect(txt).toContain('Investissement projeté');
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

  it('changements à venir : fin de revenu, fin de charge, crédit terminé, ponctuelle future + bilan net', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      credits: [{ principal: 10000, monthly: 250, ratePct: 3.5, crd: 2000, endYM: '2026-12', impactPct: 100, remainingMonths: 5 }],
      upcoming: {
        endings: [
          { kind: 'income', category: 'Revenu > Gérant Société', amount: 1200, rule: 'monthly', ym: '2026-10' },
          { kind: 'expense', category: 'Logement > Loyer', amount: 800, rule: 'monthly', ym: '2026-09' },
          { kind: 'transfer_saving', category: 'Épargne', amount: 150, rule: 'monthly', ym: '2026-11' },
        ],
        starts: [{ kind: 'expense', category: 'Transport > Leasing', amount: 300, rule: 'monthly', ym: '2026-09' }],
        oneOffs: [{ date: '2026-07-02', category: 'Logement > Travaux', amount: 440, income: false }],
      },
    }));
    expect(txt).toContain('CHANGEMENTS DÉJÀ SAISIS À VENIR');
    expect(txt).toContain('FIN d\'un revenu récurrent « Revenu > Gérant Société »');
    expect(txt).toContain('le revenu BAISSERA de ~1 200 €/mois');
    expect(txt).toContain('FIN d\'une charge récurrente « Logement > Loyer »');
    expect(txt).toContain('la mise de côté s\'arrête');
    expect(txt).toContain('NOUVEAU engagement « Transport > Leasing »');
    expect(txt).toContain('FIN du crédit 1 en 2026-12');
    expect(txt).toContain('Dépense ponctuelle FUTURE déjà saisie : 2026-07-02');
    // Bilan : +800 (fin loyer) −1200 (fin revenu) −300 (leasing) +250 (crédit) = −450/mois.
    expect(txt).toContain('perdra ~450 €/mois vs aujourd\'hui');
  });

  it('aucun changement saisi : pas de section', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      upcoming: { endings: [], starts: [], oneOffs: [] },
    }));
    expect(txt).not.toContain('CHANGEMENTS DÉJÀ SAISIS À VENIR');
  });

  it('dépenses variables : référence = enveloppe du pilotage (pas une moyenne divergente)', () => {
    const txt = build(base({
      incomeRef: { avg: 2100, monthsUsed: 2, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
    }));
    expect(txt).toContain('enveloppe mensuelle 600 €');
    expect(txt).toContain('calculée sur l\'historique (3 mois fiables)');
  });

  it('engagements : UN total consolidé, crédits du foyer exclus (pas de 95 % additionné)', () => {
    const txt = build(base({
      incomeRef: { avg: 2333, monthsUsed: 3, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      recurringExpenses: [{ category: 'Divers', amount: 1315, rule: 'monthly' }],
      jointContributionMonthly: 955,
      credits: [
        { principal: 1, monthly: 609, ratePct: 3.9, crd: 1, endYM: null, impactPct: 50 },
        { principal: 1, monthly: 120, ratePct: 0, crd: 1, endYM: null, impactPct: 100 },
      ],
      recurringIncomes: [{ category: 'Revenu', amount: 4000, rule: 'monthly' }] as any,
    }));
    expect(txt).toContain('ENGAGEMENTS MENSUELS À CHARGE');
    // total = 1315 + 120 (crédit perso) + 955 (contribution) = 2 390. Le crédit foyer 609 est exclu.
    expect(txt).toContain('TOTAL ENGAGÉ : ~2 390 €/mois');
    expect(txt).toContain('DÉJÀ couverts par la contribution');
  });

  it('score de santé pré-calculé présent et à recopier', () => {
    const txt = build(base({
      incomeRef: { avg: 2333, monthsUsed: 3, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
    }));
    expect(txt).toContain('SCORE DE SANTÉ FINANCIÈRE');
    expect(txt).toMatch(/Score global : \d+\/100/);
    expect(txt).toContain('Sécurité (25 %)');
  });

  it('évolution depuis le dernier bilan : deltas + sens', () => {
    const prev = { patrimoine: 120000, checking: 3000, savings: 22000, invested: 95000, engaged: 2200, balance12: 1500, income: 2300, score: 78 };
    const cur = { patrimoine: 126059, checking: 2600, savings: 23000, invested: 95132, engaged: 2270, balance12: 800, income: 2333, score: 80 };
    const txt = build(base({
      incomeRef: { avg: 2333, monthsUsed: 3, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      evolution: { previousDate: '2026-06-08', previous: prev, current: cur },
    }));
    expect(txt).toContain('ÉVOLUTION DEPUIS LE DERNIER BILAN (2026-06-08)');
    expect(txt).toContain('Patrimoine : +6 059 €');
    expect(txt).toContain('Score : 78 → 80 (+2)');
  });

  it('revenus attendus mois par mois affichés', () => {
    const txt = build(base({
      incomeRef: { avg: 2333, monthsUsed: 3, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      incomeByMonth: [{ ym: '2026-07', income: 1200 }, { ym: '2026-08', income: 4000 }],
    }));
    expect(txt).toContain('Revenus attendus mois par mois');
    expect(txt).toContain('2026-08 : 4 000 €');
  });

  it('revenus récurrents à montants variables : pas de faux total /mois, moyenne réelle + renvoi au détail', () => {
    const txt = build(base({
      incomeRef: { avg: 2333, monthsUsed: 3, monthsWithoutIncome: 0, transfersAvg: 0, source: 'recettes' },
      // Les templates montrent 2500/1500 (override d'un mois), mais la moyenne réelle est bien plus basse.
      recurringIncomes: [
        { category: 'Revenu > Gérant', amount: 2500, rule: 'monthly' },
        { category: 'Revenu > Gérant', amount: 1500, rule: 'monthly' },
      ] as any,
      realMonthlyIncome: 2400,
      incomeByMonth: [{ ym: '2026-07', income: 2500 }, { ym: '2026-08', income: 4000 }, { ym: '2026-09', income: 3000 }],
    }));
    // Plus de « total ≈ 4 000 €/mois » présenté comme permanent.
    expect(txt).not.toContain('REVENUS RÉCURRENTS ACTIFS — total');
    expect(txt).toContain('SOURCES DE REVENU RÉCURRENTES');
    expect(txt).toContain('montants VARIABLES selon les mois');
    expect(txt).toContain('moyenne réelle ≈ 2 400 €/mois');
    expect(txt).toContain('varie selon les mois');
  });
});

