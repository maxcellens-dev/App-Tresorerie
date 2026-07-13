import { projectMode, isProjectSpendTx, buildProjectTransactions } from '../lib/projectTx';
import { computeMonthlyForecast } from '../lib/forecast';
import { computeTresoRows } from '../lib/tresoProjection';

/**
 * Projets personnels — les 3 modes (migration 139).
 *
 * Le point sensible : une dépense de projet « Dépenser petit à petit » doit être vue par TOUS les
 * moteurs comme une dépense ORDINAIRE — comptée une fois, et jamais comme un « mouvement projet »
 * (sinon elle serait comptée deux fois, ou disparaîtrait du budget).
 */

const P = { profileId: 'u1', projectId: 'p1', projectName: 'Piano', today: '2026-07-13' };

describe('projectMode — repli pour les projets antérieurs à la migration', () => {
  it('lit le mode quand il est là', () => {
    expect(projectMode({ mode: 'spend', source_account_id: 'a', linked_account_id: null })).toBe('spend');
  });
  it('même compte source/destination → réservation', () => {
    expect(projectMode({ source_account_id: 'a', linked_account_id: 'a' })).toBe('reserve');
  });
  it('comptes différents → virement', () => {
    expect(projectMode({ source_account_id: 'a', linked_account_id: 'b' })).toBe('transfer');
  });
});

describe('isProjectSpendTx — ne confond pas dépense, virement et réservation', () => {
  it('dépense de projet', () => {
    expect(isProjectSpendTx({ project_id: 'p1', amount: -80, linked_account_id: null })).toBe(true);
  });
  it('virement de projet (a une destination)', () => {
    expect(isProjectSpendTx({ project_id: 'p1', amount: -80, linked_account_id: 'b' })).toBe(false);
  });
  it('réservation de projet', () => {
    expect(isProjectSpendTx({ project_id: 'p1', amount: -80, linked_account_id: null, is_reserved: true })).toBe(false);
  });
  it('transaction hors projet', () => {
    expect(isProjectSpendTx({ project_id: null, amount: -80, linked_account_id: null })).toBe(false);
  });
});

describe('buildProjectTransactions — ce que chaque mode écrit vraiment', () => {
  const common = { ...P, amount: 80, accountId: 'checking', projetsCategoryId: 'cat-projets', expenseCategoryId: 'cat-piano' };

  it('spend : dépense validée, catégorisée, portée au solde seulement si la date est échue', () => {
    const [past] = buildProjectTransactions({ ...common, mode: 'spend', linkedAccountId: null, date: '2026-07-05' });
    expect(past).toMatchObject({ amount: -80, category_id: 'cat-piano', linked_account_id: null, is_draft: false, posted: true });

    const [future] = buildProjectTransactions({ ...common, mode: 'spend', linkedAccountId: null, date: '2026-08-05' });
    expect(future.posted).toBe(false); // pas encore sortie : le solde ne bouge pas aujourd'hui
    expect(future.is_draft).toBe(false);
  });

  it('reserve : brouillon réservé sur le compte, aucun virement', () => {
    const [row] = buildProjectTransactions({ ...common, mode: 'reserve', linkedAccountId: 'checking', date: '2026-07-05' });
    expect(row).toMatchObject({ is_draft: true, is_reserved: true, posted: false, category_id: 'cat-projets' });
    expect(row.linked_account_id).toBeUndefined();
  });

  it('transfer : brouillon de virement vers la destination', () => {
    const [row] = buildProjectTransactions({ ...common, mode: 'transfer', linkedAccountId: 'savings', date: '2026-07-05' });
    expect(row).toMatchObject({ is_draft: true, linked_account_id: 'savings', category_id: null, posted: false });
    expect(row.is_reserved).toBeUndefined();
  });
});

// ── Moteurs : la dépense de projet compte UNE fois, du côté « dépenses » ──
const accounts = [{ id: 'checking', type: 'checking', balance: 1000 }];
const spendTx = {
  id: 't1', account_id: 'checking', project_id: 'p1', category_id: 'cat-piano',
  amount: -80, date: '2026-07-20', is_draft: false, is_recurring: false, linked_account_id: null, note: 'Piano',
};
const now = new Date('2026-07-13T12:00:00');

describe('moteurs — une dépense de projet est une dépense, pas un mouvement', () => {
  it('forecast : comptée dans « dépenses », pas dans « autres sorties »', () => {
    const [m0] = computeMonthlyForecast({
      transactions: [spendTx], accounts, variableMonthly: 0, variableRemaining: 0, monthsCount: 1, now,
    });
    expect(m0.expense).toBe(80);
    expect(m0.other).toBe(0); // ← si elle basculait en « autre sortie », elle serait comptée deux fois
  });

  it('projection (tréso) : elle creuse le solde prévu du mois', () => {
    const [m0] = computeTresoRows({
      transactions: [spendTx], accounts, overridesMap: {}, variableMonthly: 0, variableRemaining: 0, monthsCount: 1, now,
    });
    expect(m0.expense).toBe(80); // dépenses exposées en valeur absolue par le moteur
    expect(m0.other).toBe(0);
  });
});
