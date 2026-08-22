import { computeTresoRows } from '../lib/finance/tresoProjection';

/**
 * Trajectoire des soldes prévus — le calcul qui alimente la courbe de la Projection, les cartes
 * mois par mois, les soldes 12 mois du Pilotage et le garde-fou marge des recommandations.
 *
 * Deux propriétés y sont vérifiées en priorité :
 *   1. une RÉGULARISATION de solde n'est ni une recette ni une dépense (dans les deux sens) ;
 *   2. la carte du MOIS COURANT doit s'additionner sous les yeux de l'utilisateur :
 *        solde de départ + à venir (recettes − dépenses − variables + autre) = solde prévu.
 */

// On se place le 15 juillet 2026.
const NOW = new Date(2026, 6, 15);
const accounts = [{ id: 'c', type: 'checking', balance: 1000 }];

const run = (transactions: any[], opts: Partial<Parameters<typeof computeTresoRows>[0]> = {}) =>
  computeTresoRows({
    transactions, accounts, overridesMap: {},
    variableMonthly: 300, variableRemaining: 200, monthsCount: 2, now: NOW,
    ...opts,
  });

const tx = (o: any) => ({ id: 'x', account_id: 'c', is_draft: false, is_recurring: false, ...o });
const salaire = tx({ id: 'sal', amount: 2500, date: '2026-07-31', is_recurring: true, recurrence_rule: 'monthly' });
const loyer = tx({ id: 'loy', amount: -800, date: '2026-07-05', is_recurring: true, recurrence_rule: 'monthly' });
const passee = tx({ id: 'p1', amount: -100, date: '2026-07-10' });
const aVenir = tx({ id: 'p2', amount: -60, date: '2026-07-20' });

describe('computeTresoRows — mois courant', () => {
  const [m0] = run([salaire, loyer, passee, aVenir]);

  // RÉGRESSION : le salaire est ancré le DERNIER jour du mois. Le moteur de récurrences comparait
  // une date UTC à un minuit local et le faisait disparaître de son propre mois — 2 500 € de moins
  // dans la trajectoire, en silence.
  it('une échéance ancrée le 31 compte bien dans le mois', () => {
    expect(m0.income).toBe(2500);
    expect(m0.incomeRemaining).toBe(2500);
  });

  it('totaux du mois = tout le mois ; « à venir » = ce qui n’est pas encore échu', () => {
    expect(m0.expense).toBe(960);          // 800 loyer + 100 passée + 60 à venir
    expect(m0.expenseRemaining).toBe(60);  // seule la dépense du 20 reste à venir
    expect(m0.startBalance).toBe(1000);
  });

  it('la carte s’additionne : départ + à venir = solde prévu', () => {
    expect(m0.startBalance! + m0.incomeRemaining - m0.expenseRemaining - m0.variable + m0.otherRemaining)
      .toBe(m0.balance);
    expect(m0.balance).toBe(1000 + 2500 - 60 - 200);
  });
});

describe('computeTresoRows — régularisations de solde', () => {
  /* Règle produit : une régul est constatée APRÈS COUP.
       • à la baisse → dépense VARIABLE, déjà portée par l'enveloppe (cf. pilotageData.test) ;
       • à la hausse → recette du mois ;
       • jamais une « dépense prévue », jamais dans le « à venir », jamais sur un mois futur. */
  const regulBaisse = tx({ id: 'r1', amount: -300, date: '2026-07-08', regul_target: 700 });
  const regulHausse = tx({ id: 'r2', amount: 300, date: '2026-07-09', regul_target: 1300 });

  it('une régul À LA BAISSE n’est pas une dépense prévue (sinon comptée deux fois : ici ET dans l’enveloppe variable)', () => {
    const [sans] = run([loyer]);
    const [avec] = run([loyer, regulBaisse]);
    expect(avec.expense).toBe(sans.expense);
    expect(avec.expenseRemaining).toBe(sans.expenseRemaining);
    expect(avec.balance).toBe(sans.balance);
  });

  it('une régul À LA HAUSSE compte dans les revenus du mois', () => {
    const [sans] = run([loyer]);
    const [avec] = run([loyer, regulHausse]);
    expect(avec.income).toBe(sans.income + 300);
  });

  it('… mais jamais dans le « à venir » : elle est déjà dans le solde du compte', () => {
    const [sans] = run([loyer]);
    const [avec] = run([loyer, regulHausse]);
    expect(avec.incomeRemaining).toBe(sans.incomeRemaining);
    expect(avec.balance).toBe(sans.balance);
  });

  it('sur un mois FUTUR, une régul est ignorée dans les deux sens', () => {
    const baisse = tx({ id: 'r3', amount: -500, date: '2026-08-12', regul_target: 400 });
    const hausse = tx({ id: 'r4', amount: 500, date: '2026-08-12', regul_target: 1400 });
    const [, sans] = run([loyer]);
    const [, avecBaisse] = run([loyer, baisse]);
    const [, avecHausse] = run([loyer, hausse]);
    expect(avecBaisse.expense).toBe(sans.expense);
    expect(avecBaisse.balance).toBe(sans.balance);
    expect(avecHausse.income).toBe(sans.income);
    expect(avecHausse.balance).toBe(sans.balance);
  });
});

describe('computeTresoRows — échéance modifiée (convention de SIGNE)', () => {
  /* `transaction_month_overrides.override_amount` est un montant SIGNÉ : c'est ainsi que le lisent
     cette trajectoire, le plan de trésorerie et le Reporting.
     La modale « Modifier montant » du plan de trésorerie enregistrait la valeur ABSOLUE saisie :
     corriger un loyer de 800 € à 750 € stockait +750 là où le modèle vaut −800, et la dépense
     devenait une RECETTE — le solde projeté partait 1 550 € trop haut, sur ce mois et tous les
     suivants. Ce test fige la convention côté lecture. */
  const loyerAout = { 'loy:2026:8': -750 };

  it('une dépense corrigée reste une dépense', () => {
    const [, m1] = run([loyer], { overridesMap: loyerAout });
    expect(m1.expense).toBe(750);
    expect(m1.income).toBe(0);
  });

  it('un override POSITIF sur une dépense la transformerait en recette — le signe compte', () => {
    const [, faux] = run([loyer], { overridesMap: { 'loy:2026:8': 750 } });
    expect(faux.income).toBe(750);   // comportement si l'on stocke une valeur absolue : à éviter
    expect(faux.expense).toBe(0);
  });

  it('l’échéance corrigée se répercute sur le solde prévu', () => {
    const [, sans] = run([loyer]);
    const [, avec] = run([loyer], { overridesMap: loyerAout });
    expect(avec.balance).toBe(sans.balance + 50); // 800 − 750 de dépense en moins
  });
});

describe('computeTresoRows — mois suivants', () => {
  it('le mois futur enchaîne sur le solde prévu précédent, avec l’enveloppe variable pleine', () => {
    const [m0, m1] = run([salaire, loyer, passee, aVenir]);
    expect(m1.income).toBe(2500);
    expect(m1.expense).toBe(800);              // les ponctuels de juillet ne se répètent pas
    expect(m1.variable).toBe(300);             // enveloppe pleine (et non le reste du mois courant)
    expect(m1.balance).toBe(m0.balance + 2500 - 800 - 300);
    // Sur un mois futur, « à venir » et total sont la même chose.
    expect(m1.incomeRemaining).toBe(m1.income);
    expect(m1.expenseRemaining).toBe(m1.expense);
    expect(m1.otherRemaining).toBe(m1.other);
  });

  it('sans aucune transaction : la trajectoire ne fait que retrancher l’enveloppe variable', () => {
    const [m0, m1] = run([]);
    expect(m0.balance).toBe(800);              // 1000 − 200 de variable restante
    expect(m1.balance).toBe(500);              // − 300 d'enveloppe pleine
    expect(m0.income).toBe(0);
    expect(m0.expense).toBe(0);
  });
});
