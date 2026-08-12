import { detectExpectedIncome } from '../lib/finance/pilotageEngine';

/**
 * Détection du revenu attendu — trois niveaux, du plus sûr au plus approximatif :
 *   1. EXPLICITE : une recette récurrente mensuelle déclarée ;
 *   2. INFÉRÉ    : des recettes ponctuelles régulières (même libellé, ≥ 2 mois) ;
 *   3. REPLI     : la moyenne mensuelle des recettes, sans date — surtout pas de date, sinon on
 *                  inventerait une rentrée d'argent dans la simulation du point bas.
 *
 * Ce niveau détermine à la fois le montant projeté ET la confiance affichée : s'y tromper fait
 * annoncer un revenu qui n'arrivera pas.
 */
const TODAY = '2026-06-15';
const CHECKING = new Set(['a1']);
let n = 0;
const rec = (o: Partial<any> = {}): any => ({
  id: `t${++n}`, account_id: 'a1', amount: 1000, date: '2026-06-05',
  is_recurring: false, recurrence_rule: null, is_draft: false, is_reserved: false,
  linked_account_id: null, note: 'Salaire', ...o,
});

describe('detectExpectedIncome — aucune donnée', () => {
  it('ne rend aucun revenu et aucune confiance', () => {
    expect(detectExpectedIncome([], CHECKING, TODAY)).toEqual({
      monthlyAmount: 0, nextDate: null, day: 1, confidence: 0, source: 'none',
    });
  });
});

describe('detectExpectedIncome — revenu explicite', () => {
  it('retient la récurrente mensuelle entrante avec une confiance totale', () => {
    const r = detectExpectedIncome(
      [rec({ amount: 2400, date: '2026-01-25', is_recurring: true, recurrence_rule: 'monthly' })],
      CHECKING, TODAY,
    );
    expect(r.source).toBe('explicit');
    expect(r.monthlyAmount).toBe(2400);
    expect(r.day).toBe(25);
    expect(r.confidence).toBe(1);
    expect(r.nextDate).toBe('2026-06-25'); // prochaine échéance après aujourd'hui
  });

  it('garde la plus grosse quand plusieurs récurrentes coexistent', () => {
    const r = detectExpectedIncome([
      rec({ amount: 900, date: '2026-01-10', is_recurring: true, recurrence_rule: 'monthly' }),
      rec({ amount: 2400, date: '2026-01-25', is_recurring: true, recurrence_rule: 'monthly' }),
    ], CHECKING, TODAY);
    expect(r.monthlyAmount).toBe(2400);
  });

  it('ignore un virement interne, qui n\'est pas une rentrée d\'argent', () => {
    const r = detectExpectedIncome(
      [rec({ amount: 2400, date: '2026-01-25', is_recurring: true, recurrence_rule: 'monthly', linked_account_id: 'a2' })],
      CHECKING, TODAY,
    );
    expect(r.source).not.toBe('explicit');
  });

  it('ignore une récurrente sur un compte hors périmètre', () => {
    const r = detectExpectedIncome(
      [rec({ account_id: 'autre', amount: 2400, date: '2026-01-25', is_recurring: true, recurrence_rule: 'monthly' })],
      CHECKING, TODAY,
    );
    expect(r.source).toBe('none');
  });
});

describe('detectExpectedIncome — revenu inféré', () => {
  it('déduit un salaire de recettes régulières portant le même libellé', () => {
    const r = detectExpectedIncome([
      rec({ amount: 2000, date: '2026-04-05', note: 'Salaire' }),
      rec({ amount: 2000, date: '2026-05-05', note: 'Salaire' }),
      rec({ amount: 2000, date: '2026-06-05', note: 'Salaire' }),
    ], CHECKING, TODAY);
    expect(r.source).toBe('inferred');
    expect(r.monthlyAmount).toBe(2000);
    expect(r.day).toBe(5);
  });

  it('monte en confiance avec le nombre de mois observés', () => {
    const deux = detectExpectedIncome([
      rec({ amount: 2000, date: '2026-05-05' }), rec({ amount: 2000, date: '2026-06-05' }),
    ], CHECKING, TODAY);
    const trois = detectExpectedIncome([
      rec({ amount: 2000, date: '2026-04-05' }), rec({ amount: 2000, date: '2026-05-05' }),
      rec({ amount: 2000, date: '2026-06-05' }),
    ], CHECKING, TODAY);
    expect(trois.confidence).toBeGreaterThan(deux.confidence);
    expect(trois.confidence).toBeLessThanOrEqual(1);
  });

  it('projette la prochaine échéance après aujourd\'hui, jamais avant', () => {
    const r = detectExpectedIncome([
      rec({ amount: 2000, date: '2026-04-05' }), rec({ amount: 2000, date: '2026-05-05' }),
    ], CHECKING, TODAY);
    // Le 5 juin est déjà passé → la prochaine tombe en juillet.
    expect(r.nextDate! > TODAY).toBe(true);
    expect(r.nextDate).toBe('2026-07-05');
  });
});

describe('detectExpectedIncome — repli sur la moyenne', () => {
  it('moyenne les recettes sans jamais annoncer de date', () => {
    /* Point crucial : `nextDate` reste null. Une date inventée créerait une rentrée d'argent
       fantôme dans la simulation du point bas, donc un budget libre trop optimiste. */
    const r = detectExpectedIncome([
      rec({ amount: 1000, date: '2026-05-03', note: 'Mission A' }),
      rec({ amount: 1400, date: '2026-06-11', note: 'Mission B' }),
    ], CHECKING, TODAY);
    expect(r.source).toBe('inferred');
    expect(r.nextDate).toBeNull();
    expect(r.monthlyAmount).toBe(1200);
  });

  it('exclut les régularisations de solde de la moyenne', () => {
    const r = detectExpectedIncome([
      rec({ amount: 1000, date: '2026-05-03', note: 'Mission A' }),
      rec({ amount: 5000, date: '2026-06-11', note: 'Régularisation' }),
    ], CHECKING, TODAY);
    expect(r.monthlyAmount).toBe(1000);
  });

  it('ignore les brouillons et les montants futurs', () => {
    const r = detectExpectedIncome([
      rec({ amount: 1000, date: '2026-05-03', note: 'Mission A' }),
      rec({ amount: 9000, date: '2026-06-12', note: 'Brouillon', is_draft: true }),
      rec({ amount: 9000, date: '2026-06-30', note: 'Plus tard' }),
    ], CHECKING, TODAY);
    expect(r.monthlyAmount).toBe(1000);
  });
});
