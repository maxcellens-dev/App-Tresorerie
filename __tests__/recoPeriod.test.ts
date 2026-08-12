import { daysLeftInPeriod, buildRecoOptions } from '../lib/finance/recoInputs';
import { computeRecommendations } from '../lib/finance/recommendationEngine';

/**
 * LE BUG : la bascule « Confort → Réserver » suivait le mois CALENDAIRE. Un utilisateur payé le 25
 * voyait donc son Confort disparaître du 25 au 31 — c'est-à-dire au tout début de son mois d'argent,
 * juste après avoir été payé. La fin de période se lit maintenant sur une vraie donnée : la
 * prochaine rentrée d'argent.
 */
const base: any = {
  next_income_date: null,
  next_income_amount: 0,
  avg_monthly_income: 2500,
};

describe('daysLeftInPeriod — la période, pas le calendrier', () => {
  it('paie le 25 : le 30, on est en DÉBUT de période (≈ 26 jours), plus en fin de mois', () => {
    const d = daysLeftInPeriod(
      { ...base, next_income_date: '2026-08-25', next_income_amount: 2500 },
      new Date(2026, 6, 30), // 30 juillet
    );
    expect(d).toBe(26);
  });

  it('la veille de la paie, la période se termine bien', () => {
    const d = daysLeftInPeriod(
      { ...base, next_income_date: '2026-07-25', next_income_amount: 2500 },
      new Date(2026, 6, 24),
    );
    expect(d).toBe(1);
  });

  it('aucune rentrée détectée → null (aucune bascule, Confort intact)', () => {
    expect(daysLeftInPeriod(base, new Date(2026, 6, 30))).toBeNull();
  });

  it('revenu de référence inconnu → null', () => {
    expect(daysLeftInPeriod(
      { ...base, avg_monthly_income: 0, next_income_date: '2026-07-25', next_income_amount: 2500 },
      new Date(2026, 6, 24),
    )).toBeNull();
  });

  it('petite recette (remboursement, extra) → n’ouvre pas une période', () => {
    expect(daysLeftInPeriod(
      { ...base, next_income_date: '2026-07-25', next_income_amount: 120 },
      new Date(2026, 6, 24),
    )).toBeNull();
  });

  it('revenu hebdomadaire → pas de fin de période permanente', () => {
    // 600 €/semaine sur 2 500 €/mois = 24 % → sous le seuil : on ne déclare pas la période finie
    // toutes les semaines (sinon Confort serait rogné en continu).
    expect(daysLeftInPeriod(
      { ...base, next_income_date: '2026-07-17', next_income_amount: 600 },
      new Date(2026, 6, 14),
    )).toBeNull();
  });

  it('date aberrante (au-delà de 60 jours, ou passée) → null', () => {
    expect(daysLeftInPeriod(
      { ...base, next_income_date: '2026-12-25', next_income_amount: 2500 },
      new Date(2026, 6, 24),
    )).toBeNull();
    expect(daysLeftInPeriod(
      { ...base, next_income_date: '2026-07-01', next_income_amount: 2500 },
      new Date(2026, 6, 24),
    )).toBeNull();
  });
});

/* ── Bout en bout : le cas signalé ─────────────────────────────────────────────────────────────── */

const pilotage: any = {
  safe_to_spend: 900, safety_margin_amount: 500, projection_in_danger: false,
  current_savings: 9000, safety_threshold_min: 5000, safety_threshold_optimal: 10000,
  safety_threshold_comfort: 20000,
  variable_trend_percentage: 100, variable_pace_percentage: 100,
  committed_allocations: 0, remaining_fixed_expenses: 0,
  current_checking_balance: 2600, total_checking: 2600,
  total_savings: 9000, total_invested: 4000, avg_monthly_income: 2500,
  variable_envelope_initial: 400, variable_envelope_spent: 150, variable_envelope_remaining: 250,
  cashflow_trough: 2200,
  month_savings_future: 0, month_invest_future: 0,
  month_savings_total: 0, month_invest_total: 0, monthly_reserve_planned: 0,
  projection_balances_6m: [2200, 2400, 2600, 2800, 3000, 3200],
  projection_balances_12m: [2200, 2400, 2600, 2800, 3000, 3200, 3400, 3600, 3800, 4000, 4200, 4400],
  next_income_date: '2026-08-25', next_income_amount: 2500,
};

const confortLe = (day: number) => {
  const opts = buildRecoOptions(pilotage, {
    reservationsTotal: 0, preEpargneTotal: 0, preInvestTotal: 0, prudenceLevel: null,
    financialProfileId: 'P3', today: new Date(2026, 6, day),
  });
  return computeRecommendations(pilotage, opts).find((r) => r.type === 'enjoy')?.amount ?? 0;
};

describe('salaire le 25 — Confort ne fond plus en fin de mois civil', () => {
  it('du 26 au 31, Confort reste identique au milieu de période', () => {
    const reference = confortLe(10);
    expect(reference).toBeGreaterThan(0);
    for (const day of [26, 27, 28, 29, 30, 31]) {
      expect(confortLe(day)).toBe(reference);
    }
  });

  it('en revanche, à l’approche de la VRAIE fin de période, il bascule bien', () => {
    const veille = { ...pilotage, next_income_date: '2026-07-25' };
    const opts = buildRecoOptions(veille, {
      reservationsTotal: 0, preEpargneTotal: 0, preInvestTotal: 0, prudenceLevel: null,
      financialProfileId: 'P3', today: new Date(2026, 6, 24),
    });
    const enjoy = computeRecommendations(veille, opts).find((r) => r.type === 'enjoy')?.amount ?? 0;
    expect(enjoy).toBeLessThan(confortLe(10));
  });
});
