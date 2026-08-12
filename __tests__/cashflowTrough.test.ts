import { computeCashflowTrough, computeRelyka } from '../lib/finance/relyka';

const TODAY = '2026-07-25';

describe('computeCashflowTrough — point bas de trésorerie', () => {
  it('sans événement, le point bas est le solde du jour', () => {
    const r = computeCashflowTrough(1523, [], TODAY);
    expect(r.trough).toBe(1523);
    expect(r.troughDate).toBe(TODAY);
    expect(r.outflowTotal).toBe(0);
  });

  // RÉGRESSION — le bug signalé : salaire et prélèvement le MÊME jour (27), solde 1 523 €.
  // Avant l'agrégation par jour, l'ordre d'arrivée des lignes décidait du résultat :
  // prélèvement d'abord → 463 €, salaire d'abord → 1 523 €. Deux chiffres pour le même compte.
  it('même jour : le résultat ne dépend PAS de l’ordre des opérations', () => {
    const debitFirst = [
      { date: '2026-07-27', amount: -1060 },
      { date: '2026-07-27', amount: 2528 },
      { date: '2026-07-28', amount: -11.99 },
    ];
    const incomeFirst = [
      { date: '2026-07-27', amount: 2528 },
      { date: '2026-07-27', amount: -1060 },
      { date: '2026-07-28', amount: -11.99 },
    ];
    const a = computeCashflowTrough(1523, debitFirst, TODAY);
    const b = computeCashflowTrough(1523, incomeFirst, TODAY);
    expect(a.trough).toBeCloseTo(b.trough, 6);
    expect(a.troughDate).toBe(b.troughDate);
    // Le compte ne descend JAMAIS à 463 € : le 27 au soir il est à 1 523 − 1 060 + 2 528 = 2 991 €.
    expect(a.trough).toBe(1523);
    expect(a.troughDate).toBe(TODAY);
  });

  it('une dépense la VEILLE de la paie creuse réellement le point bas, à sa date', () => {
    const r = computeCashflowTrough(1523, [
      { date: '2026-07-26', amount: -1060 },
      { date: '2026-07-27', amount: 2528 },
    ], TODAY);
    expect(r.trough).toBe(463);
    expect(r.troughDate).toBe('2026-07-26'); // l'info porte une DATE : le Relyka ne vaut que jusque-là
  });

  it('retient le plus bas de TOUTE la trajectoire, pas le dernier creux', () => {
    const r = computeCashflowTrough(1000, [
      { date: '2026-07-26', amount: -900 },
      { date: '2026-07-27', amount: 500 },
      { date: '2026-07-28', amount: -400 },
    ], TODAY);
    expect(r.trough).toBe(100);
    expect(r.troughDate).toBe('2026-07-26');
    expect(r.outflowTotal).toBe(1300);
  });

  it('découvert prévu : le point bas passe sous zéro', () => {
    const r = computeCashflowTrough(200, [{ date: '2026-07-30', amount: -500 }], TODAY);
    expect(r.trough).toBe(-300);
    expect(r.troughDate).toBe('2026-07-30');
  });

  it('les jours sont ordonnés chronologiquement, quel que soit l’ordre d’entrée', () => {
    const r = computeCashflowTrough(1000, [
      { date: '2026-08-03', amount: 800 },
      { date: '2026-07-30', amount: -950 },
    ], TODAY);
    expect(r.trough).toBe(50);
    expect(r.troughDate).toBe('2026-07-30');
  });
});

describe('computeRelyka — le point bas alimente bien le budget libre', () => {
  const base = {
    savingsFuture: 0, investFuture: 0, reservePlanned: 0, reservationsTotal: 0,
    cumulsTotal: 0, variableEnvelopeRemaining: 0, safetyMargin: 0,
  };

  it('cas signalé : 1 523 € de point bas − 344 € d’épargne à venir − 100 € de marge', () => {
    const { trough } = computeCashflowTrough(1523, [
      { date: '2026-07-27', amount: -1060 },
      { date: '2026-07-27', amount: 2528 },
    ], TODAY);
    expect(computeRelyka({ ...base, cashflowTrough: trough, savingsFuture: 344, safetyMargin: 100 }))
      .toBe(1079); // et non 19 € comme avant la correction
  });

  it('ne descend jamais sous 0', () => {
    expect(computeRelyka({ ...base, cashflowTrough: 100, safetyMargin: 500 })).toBe(0);
  });
});
