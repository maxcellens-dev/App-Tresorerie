import {
  futureMonthsWindow, projectRecurringFlux, buildForecastFlux, variableShareByAccount,
  type ReportTx, type MonthBucket,
} from '../lib/finance/reportingEngine';

const SALAIRE = 'cat-income';
const COURSES = 'cat-expense';
const categoryType = (id: string | null | undefined) =>
  id === SALAIRE ? ('income' as const) : id === COURSES ? ('expense' as const) : null;

const months: MonthBucket[] = futureMonthsWindow(3, new Date(2026, 6, 15)); // août, sept, oct 2026

const tx = (over: Partial<ReportTx>): ReportTx => ({
  id: 't', date: '2026-08-05', amount: -100, account_id: 'acc1', ...over,
});

describe('futureMonthsWindow', () => {
  it('donne les N mois SUIVANTS (le mois courant appartient à l’historique)', () => {
    expect(months.map((m) => m.ym)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('passe correctement l’année', () => {
    expect(futureMonthsWindow(3, new Date(2026, 10, 20)).map((m) => m.ym)).toEqual(['2026-12', '2027-01', '2027-02']);
  });
});

describe('projectRecurringFlux', () => {
  const loyer = tx({ id: 'loyer', date: '2026-08-03', amount: -800, is_recurring: true, recurrence_rule: 'monthly', category_id: COURSES });
  const salaire = tx({ id: 'sal', date: '2026-08-01', amount: 2500, is_recurring: true, recurrence_rule: 'monthly', category_id: SALAIRE });

  it('déplie une mensuelle sur chaque mois à venir', () => {
    const out = projectRecurringFlux([loyer], months);
    expect(out).toHaveLength(3);
    expect(out.map((t) => t.date.substring(0, 7))).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(out.every((t) => t.amount === -800)).toBe(true);
  });

  it('ne projette QUE les modèles récurrents (un ponctuel est déjà une vraie ligne)', () => {
    expect(projectRecurringFlux([tx({ id: 'ponctuel' })], months)).toHaveLength(0);
  });

  it('respecte une échéance modifiée pour un mois précis', () => {
    const out = projectRecurringFlux([loyer], months, { 'loyer:2026:9': -950 });
    expect(out.find((t) => t.date.startsWith('2026-09'))!.amount).toBe(-950);
    expect(out.find((t) => t.date.startsWith('2026-08'))!.amount).toBe(-800);
  });

  it('s’arrête à la fin de la récurrence', () => {
    const out = projectRecurringFlux([{ ...loyer, recurrence_end_date: '2026-09-30' }], months);
    expect(out.map((t) => t.date.substring(0, 7))).toEqual(['2026-08', '2026-09']);
  });

  it('ignore les virements internes (neutres pour le budget, comme dans l’historique)', () => {
    expect(projectRecurringFlux([{ ...loyer, linked_account_id: 'acc2' }], months)).toHaveLength(0);
  });

  it('projette aussi les recettes', () => {
    const rows = buildForecastFlux({ fluxTx: [salaire], months, categoryType });
    expect(rows.every((r) => r.income === 2500)).toBe(true);
  });
});

describe('buildForecastFlux', () => {
  const loyer = tx({ id: 'loyer', date: '2026-08-03', amount: -800, is_recurring: true, recurrence_rule: 'monthly', category_id: COURSES });
  const salaire = tx({ id: 'sal', date: '2026-08-01', amount: 2500, is_recurring: true, recurrence_rule: 'monthly', category_id: SALAIRE });
  const ponctuelFutur = tx({ id: 'p1', date: '2026-09-12', amount: -300, category_id: COURSES });

  it('mélange récurrentes projetées et ponctuels déjà saisis', () => {
    const rows = buildForecastFlux({ fluxTx: [loyer, salaire, ponctuelFutur], months, categoryType });
    expect(rows.map((r) => r.expense)).toEqual([800, 1100, 800]);
    expect(rows.map((r) => r.income)).toEqual([2500, 2500, 2500]);
    expect(rows.every((r) => r.forecast)).toBe(true);
  });

  it('ajoute l’enveloppe variable estimée (sinon les mois futurs paraissent deux fois moins chers)', () => {
    const rows = buildForecastFlux({ fluxTx: [loyer, salaire], months, categoryType, variableMonthly: 400 });
    expect(rows[0].expense).toBe(1200);           // 800 de charges + 400 estimés
    expect(rows[0].variableEstimate).toBe(400);
    expect(rows[0].net).toBe(2500 - 1200);
  });

  it('un ponctuel PASSÉ ne pollue pas la prévision', () => {
    const rows = buildForecastFlux({ fluxTx: [tx({ id: 'vieux', date: '2026-05-04', amount: -500, category_id: COURSES })], months, categoryType });
    expect(rows.every((r) => r.expense === 0)).toBe(true);
  });
});

describe('variableShareByAccount', () => {
  const past: MonthBucket[] = [{ year: 2026, month: 6, ym: '2026-06', label: 'juin' }];
  it('répartit selon les dépenses NON récurrentes observées', () => {
    const share = variableShareByAccount([
      tx({ date: '2026-06-02', amount: -300, account_id: 'acc1', category_id: COURSES }),
      tx({ date: '2026-06-08', amount: -100, account_id: 'acc2', category_id: COURSES }),
    ], past);
    expect(share.acc1).toBeCloseTo(0.75, 5);
    expect(share.acc2).toBeCloseTo(0.25, 5);
  });

  it('exclut les charges récurrentes (ce ne sont pas des dépenses variables)', () => {
    const share = variableShareByAccount([
      tx({ date: '2026-06-03', amount: -800, account_id: 'acc1', is_recurring: true, recurrence_rule: 'monthly', category_id: COURSES }),
      tx({ date: '2026-06-04', amount: -700, account_id: 'acc1', materialized_from: 'loyer', category_id: COURSES }),
      tx({ date: '2026-06-08', amount: -100, account_id: 'acc2', category_id: COURSES }),
    ], past);
    expect(share.acc1).toBeUndefined();
    expect(share.acc2).toBe(1);
  });

  it('aucun historique → aucune part (on n’invente pas)', () => {
    expect(variableShareByAccount([], past)).toEqual({});
  });
});
