import {
  isBudgetExpense, isRecurringTx, variableContribution,
  sumVariableSpent, variableSpentByCategory, monthPrefix,
} from '../lib/finance/variableSpend';

/* Ce fichier verrouille la règle EXTRAITE de `pilotageEngine` (« dépense du budget quotidien » et
   « variable »). Elle est désormais partagée avec le module Budgets : si quelqu'un la modifie ici,
   ce n'est plus un écran qui bouge mais cinq — Pilotage, Projection, Pouls, Reporting, Budgets.
   D'où le niveau de détail : chaque condition a son test. */

const ACC = { cc: 'checking', cc2: 'checking', ep: 'savings', inv: 'investment' };
const EXPENSE = { name: 'Courses', type: 'expense' };
const INCOME = { name: 'Salaire', type: 'income' };

function tx(over: Partial<any> = {}): any {
  return { account_id: 'cc', amount: -100, date: '2026-09-10', category: EXPENSE, category_id: 'courses', ...over };
}

describe('isBudgetExpense — ce qui pèse sur le budget quotidien', () => {
  it('accepte une dépense sur un compte courant', () => {
    expect(isBudgetExpense(tx(), ACC)).toBe(true);
  });
  it('refuse tout ce qui ne part pas d’un compte courant', () => {
    expect(isBudgetExpense(tx({ account_id: 'ep' }), ACC)).toBe(false);
    expect(isBudgetExpense(tx({ account_id: 'inv' }), ACC)).toBe(false);
    expect(isBudgetExpense(tx({ account_id: 'inconnu' }), ACC)).toBe(false);
  });
  it('refuse un virement interne (il ne sort pas du périmètre)', () => {
    expect(isBudgetExpense(tx({ linked_account_id: 'ep' }), ACC)).toBe(false);
  });
  it('refuse une catégorie de RECETTE', () => {
    expect(isBudgetExpense(tx({ category: INCOME }), ACC)).toBe(false);
  });
  it('accepte une transaction SANS catégorie (elle sort quand même du compte)', () => {
    expect(isBudgetExpense(tx({ category: null }), ACC)).toBe(true);
  });
  /* Un projet ne compte QUE s'il fait réellement sortir l'argent du compte — c'est ce que
     `isProjectSpendTx` appelle une dépense de projet : montant négatif, pas de compte lié, pas de
     montant réservé. Une mise de côté ou une réservation, elles, ne se dépensent pas. */
  it('accepte une dépense de projet réellement sortante', () => {
    expect(isBudgetExpense(tx({ project_id: 'p1', amount: -100 }), ACC)).toBe(true);
  });
  it('refuse une mise de côté ou une réservation de projet', () => {
    expect(isBudgetExpense(tx({ project_id: 'p1', linked_account_id: 'ep' }), ACC)).toBe(false);
    expect(isBudgetExpense(tx({ project_id: 'p1', is_reserved: true }), ACC)).toBe(false);
    expect(isBudgetExpense(tx({ project_id: 'p1', amount: 100 }), ACC)).toBe(false);
  });
  it('accepte une RÉGULARISATION de solde — constater qu’il manque 80 €, c’est 80 € dépensés', () => {
    expect(isBudgetExpense(tx({ regul_target: 1500, note: 'Régularisation solde' }), ACC)).toBe(true);
  });
});

describe('isRecurringTx — « variable » = tout ce qui n’est PAS récurrent', () => {
  it('un modèle récurrent est récurrent', () => {
    expect(isRecurringTx(tx({ is_recurring: true, recurrence_rule: 'monthly' }))).toBe(true);
  });
  it('une occurrence MATÉRIALISÉE aussi — sans ce test, chaque loyer déjà passé deviendrait variable', () => {
    expect(isRecurringTx(tx({ is_recurring: false, materialized_from: 'tpl1' }))).toBe(true);
  });
  it('un drapeau `is_recurring` sans règle ne suffit pas', () => {
    expect(isRecurringTx(tx({ is_recurring: true }))).toBe(false);
  });
  it('une dépense ponctuelle ne l’est pas', () => {
    expect(isRecurringTx(tx())).toBe(false);
  });
});

describe('variableContribution — le signe, et ce qui compte comme remboursement', () => {
  it('une dépense (montant négatif) contribue POSITIVEMENT au dépensé', () => {
    expect(variableContribution(tx({ amount: -40 }), ACC)).toBe(40);
  });
  it('un remboursement sur une catégorie de dépense vient EN DÉDUCTION', () => {
    expect(variableContribution(tx({ amount: 50 }), ACC)).toBe(-50);
  });
  it('un montant positif SANS catégorie de dépense est ignoré (recette, apport, régul)', () => {
    expect(variableContribution(tx({ amount: 50, category: null }), ACC)).toBeNull();
    expect(variableContribution(tx({ amount: 50, category: INCOME }), ACC)).toBeNull();
  });
  it('brouillon et montant réservé ne comptent pas', () => {
    expect(variableContribution(tx({ is_draft: true }), ACC)).toBeNull();
    expect(variableContribution(tx({ is_reserved: true }), ACC)).toBeNull();
  });
});

describe('sumVariableSpent — fenêtres', () => {
  const txs = [
    tx({ amount: -100, date: '2026-09-05' }),
    tx({ amount: -50, date: '2026-09-20' }),
    tx({ amount: -300, date: '2026-08-15' }),
  ];

  it('filtre sur le préfixe de mois', () => {
    expect(sumVariableSpent(txs, ACC, { prefix: '2026-09' })).toBe(150);
    expect(sumVariableSpent(txs, ACC, { prefix: '2026-08' })).toBe(300);
  });
  it('`upTo` borne au jour près (mois en cours)', () => {
    expect(sumVariableSpent(txs, ACC, { prefix: '2026-09', upTo: '2026-09-10' })).toBe(100);
  });
  it('`after` ne garde que le futur connu', () => {
    expect(sumVariableSpent(txs, ACC, { prefix: '2026-09', after: '2026-09-10' })).toBe(50);
  });
  it('le préfixe d’ANNÉE agrège les mois (fenêtre des budgets annuels)', () => {
    expect(sumVariableSpent(txs, ACC, { prefix: '2026' })).toBe(450);
  });
  it('le total ne descend jamais sous zéro (un mois très remboursé ne « rapporte » pas)', () => {
    expect(sumVariableSpent([tx({ amount: 500 })], ACC, { prefix: '2026-09' })).toBe(0);
  });
});

describe('variableSpentByCategory — ventilation', () => {
  it('ventile par catégorie, sans-catégorie comprise', () => {
    const m = variableSpentByCategory([
      tx({ amount: -100, category_id: 'courses' }),
      tx({ amount: -40, category_id: 'resto' }),
      tx({ amount: -25, category_id: null, category: null }),
    ], ACC, { prefix: '2026-09' });
    expect(m.get('courses')).toBe(100);
    expect(m.get('resto')).toBe(40);
    expect(m.get('')).toBe(25);
  });

  it('applique EXACTEMENT les mêmes exclusions que le total', () => {
    const txs = [
      tx({ amount: -100 }),
      tx({ amount: -800, is_recurring: true, recurrence_rule: 'monthly' }),
      tx({ amount: -700, account_id: 'ep' }),
    ];
    const byCat = variableSpentByCategory(txs, ACC, { prefix: '2026-09' });
    const total = [...byCat.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(sumVariableSpent(txs, ACC, { prefix: '2026-09' }));
  });

  it('une catégorie peut ressortir NÉGATIVE (remboursement), là où le total est plafonné à 0', () => {
    const txs = [tx({ amount: 60, category_id: 'courses' })];
    expect(variableSpentByCategory(txs, ACC, { prefix: '2026-09' }).get('courses')).toBe(-60);
    expect(sumVariableSpent(txs, ACC, { prefix: '2026-09' })).toBe(0);
  });
});

describe('monthPrefix', () => {
  it('pose le zéro de tête', () => {
    expect(monthPrefix(2026, 9)).toBe('2026-09');
    expect(monthPrefix(2026, 12)).toBe('2026-12');
  });
});
