import { computeMonthUpcoming } from '../lib/finance/monthUpcoming';

// Le 15 juillet 2026 : ce qui tombe après le 15 est « à venir ».
const NOW = new Date(2026, 6, 15);
const accounts = [
  { id: 'cc', type: 'checking', currency: 'EUR' },
  { id: 'liv', type: 'savings', currency: 'EUR' },
];
const expenseCat = { name: 'Courses', type: 'expense' };
const incomeCat = { name: 'Salaire', type: 'income' };
const run = (txs: any[], recurringExpenses: any[] = []) => computeMonthUpcoming({
  recurringExpenses, txForSuivi: txs, accountsForSuivi: accounts, refCode: 'EUR', rates: { EUR: 1 }, now: NOW,
});

describe('computeMonthUpcoming — ce qui est déjà inscrit d’ici la fin du mois', () => {
  it('reprend les prélèvements récurrents restants tels quels (même total que l’écran)', () => {
    const r = run([], [{ id: 'loyer', account_id: 'cc', amount: -800, date: '2026-07-28', _left: 800, _monthDate: '2026-07-28' }]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'expense', source: 'recurring', date: '2026-07-28', amount: 800, occurrences: 1 });
    expect(r.expenseTotal).toBe(800);
  });

  it('compte les occurrences restantes d’une hebdomadaire', () => {
    const r = run([], [{ id: 'cine', account_id: 'cc', amount: -10, date: '2026-07-18', _left: 20 }]);
    expect(r.items[0]).toMatchObject({ amount: 20, occurrences: 2, date: '2026-07-18' });
  });

  it('ajoute les rentrées récurrentes pas encore arrivées', () => {
    const salaire = { id: 'sal', account_id: 'cc', amount: 2000, date: '2026-07-28', is_recurring: true, recurrence_rule: 'monthly', category: incomeCat };
    const r = run([salaire]);
    expect(r.items).toEqual([expect.objectContaining({ kind: 'income', source: 'recurring', amount: 2000, date: '2026-07-28' })]);
    expect(r.incomeTotal).toBe(2000);
    expect(r.expenseTotal).toBe(0);
  });

  it('ignore une rentrée récurrente déjà arrivée ce mois', () => {
    const salaire = { id: 'sal', account_id: 'cc', amount: 2000, date: '2026-08-02', is_recurring: true, recurrence_rule: 'monthly', category: incomeCat };
    const recue = { id: 'sal-07', materialized_from: 'sal', account_id: 'cc', amount: 2000, date: '2026-07-02', category: incomeCat };
    expect(run([salaire, recue]).items).toHaveLength(0);
  });

  it('ajoute les opérations ponctuelles saisies pour plus tard dans le mois', () => {
    const achat = { id: 'a', account_id: 'cc', amount: -120, date: '2026-07-25', category: expenseCat };
    const rembt = { id: 'b', account_id: 'cc', amount: 60, date: '2026-07-20', category: incomeCat };
    const r = run([achat, rembt]);
    expect(r.items.map((i) => i.key)).toEqual(['tx-b', 'tx-a']); // triées par date
    expect(r.expenseTotal).toBe(120);
    expect(r.incomeTotal).toBe(60);
  });

  it('écarte le passé, le mois suivant, les virements, brouillons, régularisations et autres comptes', () => {
    const txs = [
      { id: 'passe', account_id: 'cc', amount: -50, date: '2026-07-10', category: expenseCat },
      { id: 'aout', account_id: 'cc', amount: -50, date: '2026-08-02', category: expenseCat },
      { id: 'vir', account_id: 'cc', linked_account_id: 'liv', amount: -100, date: '2026-07-20' },
      { id: 'brouillon', account_id: 'cc', amount: -40, date: '2026-07-20', is_draft: true, category: expenseCat },
      { id: 'regul', account_id: 'cc', amount: -30, date: '2026-07-20', regul_target: 100, category: expenseCat },
      { id: 'epargne', account_id: 'liv', amount: -20, date: '2026-07-20', category: expenseCat },
    ];
    expect(run(txs).items).toHaveLength(0);
  });
});
