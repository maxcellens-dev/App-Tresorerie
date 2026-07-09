import {
  isRealFlux, buildMonthlyFlux, buildSavingsSeries, buildCategoryBreakdown,
  buildBalanceSeries, buildInsights, monthsWindow, type ReportTx, type MonthBucket,
} from '../lib/reportingEngine';

const M = (ym: string, label = ym.slice(5)): MonthBucket => ({
  year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), ym, label,
});

describe('isRealFlux', () => {
  it('exclut régul, virement interne et brouillon', () => {
    expect(isRealFlux({ date: '2026-07-01', amount: 100, account_id: 'a' })).toBe(true);
    expect(isRealFlux({ date: '2026-07-01', amount: 100, account_id: 'a', regul_target: 500 })).toBe(false);
    expect(isRealFlux({ date: '2026-07-01', amount: 100, account_id: 'a', linked_account_id: 'b' })).toBe(false);
    expect(isRealFlux({ date: '2026-07-01', amount: 100, account_id: 'a', is_draft: true })).toBe(false);
    expect(isRealFlux({ date: '2026-07-01', amount: -50, account_id: 'a', note: 'Régularisation solde' })).toBe(false);
  });
});

describe('buildMonthlyFlux', () => {
  it('agrège revenus/dépenses hors régul et virements', () => {
    const months = [M('2026-06'), M('2026-07')];
    const tx: ReportTx[] = [
      { date: '2026-07-05', amount: 2000, account_id: 'a' },        // revenu
      { date: '2026-07-10', amount: -300, account_id: 'a' },        // dépense
      { date: '2026-07-11', amount: -200, account_id: 'a', regul_target: 100 }, // régul → ignoré
      { date: '2026-07-12', amount: -500, account_id: 'a', linked_account_id: 'b' }, // virement → ignoré
      { date: '2026-06-05', amount: 1000, account_id: 'a' },
    ];
    const r = buildMonthlyFlux(tx, months);
    expect(r[1]).toMatchObject({ ym: '2026-07', income: 2000, expense: 300, net: 1700 });
    expect(r[1].rate).toBeCloseTo(85, 0);
    expect(r[0]).toMatchObject({ income: 1000, expense: 0 });
  });
});

describe('buildSavingsSeries', () => {
  it('compte l’argent arrivé sur épargne/investissement (jambe entrante)', () => {
    const months = [M('2026-07')];
    const typeById = { chk: 'checking', sav: 'savings', inv: 'investment' };
    const tx: ReportTx[] = [
      { date: '2026-07-01', amount: -200, account_id: 'chk', linked_account_id: 'sav' }, // sortie courant
      { date: '2026-07-01', amount: 200, account_id: 'sav', linked_account_id: 'chk' },  // ENTRE épargne
      { date: '2026-07-02', amount: 150, account_id: 'inv', linked_account_id: 'chk' },  // ENTRE invest
      { date: '2026-07-03', amount: 999, account_id: 'chk', linked_account_id: 'sav' },  // arrive sur courant → ignoré
    ];
    expect(buildSavingsSeries(tx, months, typeById)[0].saved).toBe(350);
  });
});

describe('buildCategoryBreakdown', () => {
  const grand = (id: string | null | undefined) => (id ? `cat-${id}` : 'Sans catégorie');
  it('top N + regroupe le reste dans « Autres »', () => {
    const tx: ReportTx[] = [];
    for (let i = 1; i <= 9; i++) tx.push({ date: '2026-07-01', amount: -i * 10, account_id: 'a', category_id: String(i) });
    const r = buildCategoryBreakdown(tx, '2026-07', grand, 7);
    expect(r.length).toBe(8); // 7 + Autres
    expect(r[0]).toEqual({ label: 'cat-9', amount: 90 });
    expect(r[r.length - 1].label).toBe('Autres');
    expect(r[r.length - 1].amount).toBe(10 + 20); // cat-1 + cat-2
  });
});

describe('buildBalanceSeries', () => {
  it('reconstruit à rebours et ignore le futur + brouillons', () => {
    const months = [M('2026-06'), M('2026-07')];
    const accounts = [{ id: 'a', balance: 1000 }];
    const tx: ReportTx[] = [
      { date: '2026-07-10', amount: 200, account_id: 'a' },                 // ce mois
      { date: '2026-07-25', amount: 500, account_id: 'a', is_draft: true }, // brouillon → ignoré
      { date: '2026-08-01', amount: 999, account_id: 'a' },                 // futur → ignoré
      { date: '2026-06-15', amount: 300, account_id: 'a' },
    ];
    const pts = buildBalanceSeries(new Set(['a']), accounts, tx, months, '2026-07-20');
    // fin juillet = solde actuel 1000 ; fin juin = 1000 − 200 (juillet) = 800
    expect(pts[1].value).toBe(1000);
    expect(pts[0].value).toBe(800);
  });
});

describe('buildInsights', () => {
  it('trie alertes → réussites → opportunités', () => {
    const monthlyFlux = [
      { ym: '2026-06', label: 'juin', income: 2000, expense: 1000, net: 1000, rate: 50 },
      { ym: '2026-07', label: 'juil', income: 2000, expense: 1400, net: 600, rate: 30 },
    ];
    const ins = buildInsights({
      monthlyFlux,
      savingsSeries: [{ saved: 400 }],
      netWorthTotal: [{ value: 5000 }, { value: 6000 }],
      categoryBreakdown: [{ label: 'Logement', amount: 900 }, { label: 'Courses', amount: 500 }],
      monthIncome: 2000,
      monthSaved: 400,
      variableTrendPct: 130, // +30 % → alerte
      hasVariableBaseline: true,
      daysSinceVerification: 40, // alerte
    });
    expect(ins.length).toBeGreaterThan(0);
    // Le premier constat est une alerte, et les tons sont ordonnés.
    const order = { alert: 0, win: 1, tip: 2 } as const;
    for (let i = 1; i < ins.length; i++) {
      expect(order[ins[i].tone]).toBeGreaterThanOrEqual(order[ins[i - 1].tone]);
    }
    expect(ins[0].tone).toBe('alert');
  });
});

describe('monthsWindow', () => {
  it('borne à la 1ʳᵉ donnée', () => {
    const w = monthsWindow(6, '2026-05', new Date('2026-07-15T00:00:00'));
    expect(w[0].ym).toBe('2026-05');
    expect(w[w.length - 1].ym).toBe('2026-07');
    expect(w.length).toBe(3);
  });
});
