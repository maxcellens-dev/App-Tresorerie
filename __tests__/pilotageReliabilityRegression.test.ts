import { computeRelykaBreakdown, relykaTone, relykaZeroHero } from '../lib/finance/pilotageView';
import { variableContribution, isRecurringOccurrence } from '../lib/finance/variableSpend';
import { consumesVariableEnvelope } from '../lib/pulse/pulseDelta';

const extras = { reservationsTotal: 0, preEpargneTotal: 0, preInvestTotal: 0 };
describe('Relyka : petits montants et manque réel', () => {
  it.each([0.01, 0.5, 4.27, 9.9, 9.99])('affiche %s sans arrondir à la dizaine', amount => {
    const b = computeRelykaBreakdown({ cashflow_trough: amount } as any, extras);
    expect(b.relykaAffiche).toBe(Math.max(1, Math.round(amount)));
    expect(relykaZeroHero(b)).toBeNull();
  });
  it.each([[0, 0], [-2, 0], [10, 10], [18.75, 10], [505, 500]])('conserve la règle hors ]0,10[ : %s', (amount, expected) => {
    expect(computeRelykaBreakdown({ cashflow_trough: amount } as any, extras).relykaAffiche).toBe(expected);
  });
  it('signale le manque même si des investissements pourraient théoriquement le combler', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: -100, month_invest_total: 500 } as any, extras);
    expect(relykaTone(b)).toBe('negative');
    expect(relykaZeroHero(b)?.word).toBe('Relyka dépassé');
  });
  it('emploie le sous-texte mensuel demandé même si le calcul dépasse la fin du mois', () => {
    const b = computeRelykaBreakdown({ cashflow_trough: -460.41, cashflow_horizon_end: '2026-10-05' } as any, extras);
    expect(relykaZeroHero(b)?.sub).toBe('Tu as dépensé 460,41 € de plus que ton Relyka ce mois-ci.');
    expect(relykaZeroHero(b)?.sub).not.toContain('sur la période');
  });
});

describe('récurrence : indépendante de la catégorie et durable', () => {
  it('reconnaît une échéance passée même après disparition du modèle, sans recréer une série', () => {
    expect(isRecurringOccurrence({ is_recurring: false, materialized_from: 'parent' })).toBe(true);
    expect(isRecurringOccurrence({ is_recurring: false, is_recurring_occurrence: true })).toBe(true);
    expect(isRecurringOccurrence({ is_recurring: true, recurrence_rule: 'monthly' })).toBe(false);
    expect(isRecurringOccurrence({ is_recurring: false })).toBe(false);
    expect(isRecurringOccurrence(undefined)).toBe(false);
  });
  const expense = { account_id: 'a', amount: -100, category: { type: 'expense', is_variable: true } };
  it.each([
    { is_recurring: true },
    { is_recurring: false, materialized_from: 'parent' },
    { is_recurring: false, materialized_from: null, is_recurring_occurrence: true },
  ])('exclut la récurrence du calcul central : %j', markers => {
    expect(variableContribution({ ...expense, ...markers }, { a: 'checking' })).toBeNull();
  });
  it('exclut une occurrence dont le modèle a été supprimé de la confirmation', () => {
    expect(consumesVariableEnvelope({ kind: 'expense', accountType: 'checking', isRecurringOccurrence: true } as any)).toBe(false);
  });
  it('compte une dépense ponctuelle même dans une catégorie habituellement fixe', () => {
    expect(variableContribution({ ...expense, category: { type: 'expense', is_variable: false } }, { a: 'checking' })).toBe(100);
  });
});
