import { applyOpToPilotage, type PilotageBalances } from '../lib/finance/pilotagePatch';
import { computeRelyka } from '../lib/finance/relyka';

/**
 * Le patch optimiste doit donner EXACTEMENT ce que la carte de confirmation annonce (lib/pulseDelta) :
 * sinon la carte et l'écran derrière elle se contrediraient pendant la seconde qui précède le refetch.
 */
const base: PilotageBalances = {
  cashflow_trough: 1200,
  current_checking_balance: 1500,
  total_checking: 1500,
  total_savings: 8000,
  total_invested: 3000,
  variable_envelope_initial: 600,
  variable_envelope_spent: 200,
  variable_envelope_remaining: 400,
};
const today = '2026-08-10';

describe('applyOpToPilotage', () => {
  it('une dépense du quotidien consomme l’enveloppe et creuse le point bas d’autant', () => {
    const next = applyOpToPilotage(base, {
      amount: -100, accountType: 'checking', date: today, hitsVariableEnvelope: true,
    }, today)!;
    expect(next.cashflow_trough).toBe(1100);
    expect(next.total_checking).toBe(1400);
    expect(next.variable_envelope_spent).toBe(300);
    expect(next.variable_envelope_remaining).toBe(300);
  });

  it('… et le Relyka ne bouge donc pas : c’est ce que dit déjà la carte', () => {
    const relyka = (d: PilotageBalances) => computeRelyka({
      cashflowTrough: d.cashflow_trough,
      savingsFuture: 0, investFuture: 0, reservePlanned: 0, reservationsTotal: 0, cumulsTotal: 0,
      variableEnvelopeRemaining: d.variable_envelope_remaining,
      safetyMargin: 0,
    });
    const next = applyOpToPilotage(base, {
      amount: -100, accountType: 'checking', date: today, hitsVariableEnvelope: true,
    }, today)!;
    expect(relyka(next)).toBe(relyka(base));
  });

  it('une dépense HORS quotidien (récurrente, projet) fait bien baisser le Relyka', () => {
    const next = applyOpToPilotage(base, { amount: -100, accountType: 'checking', date: today }, today)!;
    expect(next.cashflow_trough).toBe(1100);
    expect(next.variable_envelope_remaining).toBe(400); // l'enveloppe n'est pas concernée
  });

  it('une recette remonte le point bas', () => {
    const next = applyOpToPilotage(base, { amount: 900, accountType: 'checking', date: today }, today)!;
    expect(next.cashflow_trough).toBe(2100);
    expect(next.total_checking).toBe(2400);
  });

  it('épargne et investissement vont sur leur propre total, jamais sur le point bas', () => {
    const s = applyOpToPilotage(base, { amount: 300, accountType: 'savings', date: today }, today)!;
    expect(s.total_savings).toBe(8300);
    expect(s.cashflow_trough).toBe(1200);
    const i = applyOpToPilotage(base, { amount: 300, accountType: 'investment', date: today }, today)!;
    expect(i.total_invested).toBe(3300);
  });

  it('opération déjà comprise dans la régul du jour : aucun solde ne bouge, l’enveloppe si', () => {
    const next = applyOpToPilotage(base, {
      amount: -100, accountType: 'checking', date: today, regulCovered: true, hitsVariableEnvelope: true,
    }, today)!;
    expect(next.cashflow_trough).toBe(1200);
    expect(next.variable_envelope_remaining).toBe(300);
  });

  it('un dépassement d’enveloppe ne rend pas le restant négatif', () => {
    const next = applyOpToPilotage(base, {
      amount: -900, accountType: 'checking', date: today, hitsVariableEnvelope: true,
    }, today)!;
    expect(next.variable_envelope_remaining).toBe(0);
    expect(next.cashflow_trough).toBe(300);
  });

  /* SUPPRIMER = APPLIQUER L'EFFET INVERSE. La nature de l'opération (dépense du quotidien) se lit
     sur la ligne elle-même : le patch, lui, porte le montant opposé. */
  it('supprimer une dépense du quotidien recrédite l’enveloppe et remonte le point bas', () => {
    const next = applyOpToPilotage(base, {
      amount: +100, accountType: 'checking', date: today, hitsVariableEnvelope: true,
    }, today)!;
    expect(next.cashflow_trough).toBe(1300);
    expect(next.variable_envelope_spent).toBe(100);
    expect(next.variable_envelope_remaining).toBe(500);
  });

  it('… et supprimer plus que ce qui est dépensé ne rend pas le « dépensé » négatif', () => {
    const next = applyOpToPilotage(base, {
      amount: +900, accountType: 'checking', date: today, hitsVariableEnvelope: true,
    }, today)!;
    expect(next.variable_envelope_spent).toBe(0);
    expect(next.variable_envelope_remaining).toBe(600);
  });

  it('saisir puis supprimer la même dépense ramène exactement à l’état de départ', () => {
    const op = { accountType: 'checking', date: today, hitsVariableEnvelope: true } as const;
    const after = applyOpToPilotage(base, { ...op, amount: -100 }, today)!;
    expect(applyOpToPilotage(after, { ...op, amount: +100 }, today)).toEqual(base);
  });

  it('une opération FUTURE n’est pas devinée : on laisse le refetch trancher', () => {
    expect(applyOpToPilotage(base, { amount: -100, accountType: 'checking', date: '2026-08-25' }, today)).toBe(base);
  });

  it('cache vide → rien à devancer ; rien à changer → même référence', () => {
    expect(applyOpToPilotage(undefined, { amount: -100, date: today }, today)).toBeUndefined();
    expect(applyOpToPilotage(base, { amount: 0, accountType: 'checking', date: today }, today)).toBe(base);
  });

  it('une enveloppe d’un AUTRE mois n’est pas touchée', () => {
    const next = applyOpToPilotage(base, {
      amount: -100, accountType: 'checking', date: '2026-07-30', hitsVariableEnvelope: true,
    }, today)!;
    expect(next.variable_envelope_spent).toBe(200);
    expect(next.cashflow_trough).toBe(1100);
  });
});
