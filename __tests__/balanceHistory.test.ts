import { buildBalanceHistory, type BalanceHistoryTx } from '../lib/balanceHistory';

/**
 * La courbe du compte remonte le temps depuis le solde D'AUJOURD'HUI (source de vérité, recalculée
 * côté base) : elle ne refait jamais l'addition des transactions, sinon elle divergerait du chiffre
 * affiché juste au-dessus d'elle — et les régularisations la feraient mentir.
 */
const tx = (date: string, amount: number, extra: Partial<BalanceHistoryTx> = {}): BalanceHistoryTx => ({
  account_id: 'a1', amount, date, is_draft: false, is_recurring: false, ...extra,
});

describe('buildBalanceHistory', () => {
  it('finit sur le solde du jour et remonte mois par mois', () => {
    const pts = buildBalanceHistory('a1', 1500, [
      tx('2026-01-10', 1000),
      tx('2026-02-15', 300),
      tx('2026-03-05', 200),
    ], '2026-03-20');

    expect(pts.map((p) => [p.date, p.value])).toEqual([
      ['2026-01-31', 1000],   // 1500 − (300 + 200)
      ['2026-02-28', 1300],   // 1500 − 200
      ['2026-03-20', 1500],   // le solde du jour, tel quel
    ]);
  });

  it('ignore brouillons, modèles récurrents et opérations futures', () => {
    const pts = buildBalanceHistory('a1', 1000, [
      tx('2026-01-10', 1000),
      tx('2026-03-01', 500, { is_draft: true }),
      tx('2026-03-02', 500, { is_recurring: true }),
      tx('2026-04-01', 500),                        // futur : pas encore au solde
      tx('2026-02-01', 999, { account_id: 'autre' }),
    ], '2026-03-20');

    expect(pts[0].value).toBe(1000);
    expect(pts[pts.length - 1].value).toBe(1000);
  });

  it('suit un solde qui passe dans le rouge', () => {
    const pts = buildBalanceHistory('a1', -200, [
      tx('2026-01-10', 800),
      tx('2026-02-20', -1000),
    ], '2026-02-25');
    expect(pts.map((p) => p.value)).toEqual([800, -200]);
  });

  it('ne trace rien tant que le compte n’a aucun mouvement échu', () => {
    expect(buildBalanceHistory('a1', 0, [], '2026-03-20')).toEqual([]);
    expect(buildBalanceHistory('a1', 500, [tx('2026-04-10', 500)], '2026-03-20')).toEqual([]);
  });

  it('démarre à la date d’ouverture déclarée si elle est plus ancienne', () => {
    const pts = buildBalanceHistory('a1', 1000, [tx('2026-03-05', 1000)], '2026-03-20', '2026-01-15');
    expect(pts[0].date).toBe('2026-01-31');
    expect(pts).toHaveLength(3); // janvier, février, aujourd'hui
  });

  it('ne remonte pas au-delà de ce qu’on sait complet (liste tronquée à 500 lignes)', () => {
    // On ne connaît les opérations que depuis le 2026-02-01 : remonter à l'ouverture déclarée
    // donnerait un solde de janvier calculé sans les lignes manquantes — faux, mais crédible.
    const pts = buildBalanceHistory('a1', 1000, [
      tx('2026-02-10', 400),
      tx('2026-03-05', 600),
    ], '2026-03-20', '2025-06-01', '2026-02-01');
    expect(pts[0].date).toBe('2026-02-28');
    expect(pts[0].value).toBe(400);   // 1000 − 600
  });

  it('… mais garde l’ouverture déclarée quand l’historique est intégral', () => {
    const pts = buildBalanceHistory('a1', 1000, [tx('2026-03-05', 1000)], '2026-03-20', '2026-01-15', null);
    expect(pts[0].date).toBe('2026-01-31');
  });

  it('borne le nombre de points sur un très long historique', () => {
    const pts = buildBalanceHistory('a1', 100, [tx('2015-01-05', 100)], '2026-03-20');
    expect(pts.length).toBeLessThanOrEqual(36);
    expect(pts[pts.length - 1].date).toBe('2026-03-20');
  });
});
