import { computeEndOfMonthDelta } from '../lib/pulseDelta';
const today = new Date(2026, 6, 15); // 15 juillet 2026
const inMonth = '2026-07-20', nextMonth = '2026-08-03';

describe('computeEndOfMonthDelta', () => {
  it('dépense sur compte courant du mois → −montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking', date: inMonth }, today)).toBe(-100);
  });
  it('recette sur compte courant du mois → +montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'income', amount: 250, accountType: 'checking', date: inMonth }, today)).toBe(250);
  });
  it('dépense sur épargne → 0 (hors solde courant)', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'savings', date: inMonth }, today)).toBe(0);
  });
  it('virement courant → épargne → −montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'checking', toType: 'savings', date: inMonth }, today)).toBe(-400);
  });
  it('virement épargne → courant → +montant', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'savings', toType: 'checking', date: inMonth }, today)).toBe(400);
  });
  it('virement courant → courant → 0', () => {
    expect(computeEndOfMonthDelta({ kind: 'transfer', amount: 400, fromType: 'checking', toType: 'checking', date: inMonth }, today)).toBe(0);
  });
  it('opération datée du mois PROCHAIN → 0', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking', date: nextMonth }, today)).toBe(0);
  });
  it('sans date → 0 (on ne présume pas)', () => {
    expect(computeEndOfMonthDelta({ kind: 'expense', amount: 100, accountType: 'checking' }, today)).toBe(0);
  });
});
