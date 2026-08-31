import {
  computeBudgets, resolveBudgetFor, effectiveBudget, buildBudgetHistory,
  countMonthsRespected, monthKeyOf, yearKeyOf, periodLabel,
  type BudgetRecord, type BudgetCategory,
} from '../lib/finance/budgetEngine';
import { sumVariableSpent } from '../lib/finance/variableSpend';

/* ── Décor minimal ──────────────────────────────────────────────────────────────────────────────
   Un compte courant, une hiérarchie Alimentation › (Courses, Restaurants) + Loisirs + Vacances.
   Les transactions sont celles de la vue FLUX (déjà passées par le périmètre).

   ⚠️ Il n'existe PLUS de budget global (migration 218) : chaque budget porte une catégorie. Le
   bloc `total` du résultat est un CUMUL des budgets posés, pas une limite déclarée. */

const ACCOUNTS = { cc: 'checking', ep: 'savings' };
const TODAY = '2026-09-18';

const CATS: BudgetCategory[] = [
  { id: 'alim', name: 'Alimentation', parent_id: null, type: 'expense' },
  { id: 'courses', name: 'Courses', parent_id: 'alim', type: 'expense' },
  { id: 'resto', name: 'Restaurants', parent_id: 'alim', type: 'expense' },
  { id: 'loisirs', name: 'Loisirs', parent_id: null, type: 'expense' },
  { id: 'vac', name: 'Vacances', parent_id: null, type: 'expense' },
  { id: 'salaire', name: 'Salaire', parent_id: null, type: 'income' },
  // « Mouvements » = virements internes. Hors budget, elle et ses enfants.
  { id: 'mvt', name: 'Mouvements', parent_id: null, type: 'expense' },
  { id: 'mvt-ep', name: 'Épargne', parent_id: 'mvt', type: 'expense' },
];

let seq = 0;
function tx(over: Partial<any> = {}): any {
  seq += 1;
  const category_id = over.category_id ?? null;
  const cat = CATS.find((c) => c.id === category_id);
  return {
    id: `t${seq}`,
    account_id: 'cc',
    category_id,
    category: cat ? { name: cat.name, type: cat.type } : null,
    amount: -100,
    date: '2026-09-10',
    is_draft: false,
    ...over,
  };
}

function budget(over: Partial<BudgetRecord> & { category_id: string }): BudgetRecord {
  return { id: `b${Math.random()}`, period: 'month', period_key: '2026-09', amount: 1000, ...over };
}

function run(fluxTx: any[], budgets: BudgetRecord[], monthKey = '2026-09', today = TODAY) {
  return computeBudgets({ fluxTx, accountTypeById: ACCOUNTS, categories: CATS, budgets, monthKey, today });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe('effectiveBudget — report implicite', () => {
  it('prend la ligne de la période demandée quand elle existe', () => {
    const b = [budget({ category_id: 'alim', period_key: '2026-08', amount: 900 }), budget({ category_id: 'alim', period_key: '2026-09', amount: 1000 })];
    expect(effectiveBudget(b, 'month', '2026-09', 'alim')).toEqual({ amount: 1000, inherited: false, fromKey: '2026-09' });
  });

  it('hérite de la période antérieure la plus récente, et le signale', () => {
    const b = [budget({ category_id: 'alim', period_key: '2026-06', amount: 800 }), budget({ category_id: 'alim', period_key: '2026-08', amount: 900 })];
    expect(effectiveBudget(b, 'month', '2026-09', 'alim')).toEqual({ amount: 900, inherited: true, fromKey: '2026-08' });
  });

  it('ne regarde JAMAIS vers le futur : octobre ne s’applique pas à septembre', () => {
    expect(effectiveBudget([budget({ category_id: 'alim', period_key: '2026-10', amount: 2000 })], 'month', '2026-09', 'alim')).toBeNull();
  });

  it('ne mélange pas les cadences : un annuel ne sert pas de repli au mensuel', () => {
    const b = [budget({ category_id: 'vac', period: 'year', period_key: '2026', amount: 12000 })];
    expect(effectiveBudget(b, 'month', '2026-09', 'vac')).toBeNull();
    expect(effectiveBudget(b, 'year', '2026', 'vac')?.amount).toBe(12000);
  });

  it('ne mélange pas les catégories', () => {
    const b = [budget({ category_id: 'alim', amount: 400 })];
    expect(effectiveBudget(b, 'month', '2026-09', 'loisirs')).toBeNull();
  });

  it('un budget à 0 est une VALEUR (retrait), pas une absence : il stoppe le report', () => {
    const b = [budget({ category_id: 'alim', period_key: '2026-08', amount: 900 }), budget({ category_id: 'alim', period_key: '2026-09', amount: 0 })];
    expect(effectiveBudget(b, 'month', '2026-09', 'alim')?.amount).toBe(0);
  });
});

describe('aucun budget : l’app est celle d’avant', () => {
  it('rend un résultat vide, sans zéros trompeurs', () => {
    const r = run([tx({ category_id: 'courses', amount: -300 })], []);
    expect(r.isEmpty).toBe(true);
    expect(r.total.hasBudget).toBe(false);
    expect(r.rows).toEqual([]);
    expect(r.annual).toEqual([]);
    expect(r.total.pct).toBeNull();
  });

  it('`spentAll` reste le dépensé variable du mois, budgets ou pas — même source que le Pilotage', () => {
    const txs = [tx({ category_id: 'courses', amount: -300 }), tx({ category_id: 'loisirs', amount: -120 })];
    const ref = sumVariableSpent(txs, ACCOUNTS, { prefix: '2026-09', upTo: TODAY });
    expect(run(txs, []).total.spentAll).toBe(ref);
    expect(run(txs, [budget({ category_id: 'alim', amount: 400 })]).total.spentAll).toBe(ref);
  });

  it('un budget RETIRÉ (0) fait disparaître la catégorie, comme si elle n’avait jamais été budgétée', () => {
    const r = run([tx({ category_id: 'courses', amount: -300 })], [budget({ category_id: 'alim', amount: 0 })]);
    expect(r.isEmpty).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe('cumul du mois — une somme de décisions, pas une limite déclarée', () => {
  it('additionne les budgets posés et le dépensé correspondant', () => {
    const r = run(
      [tx({ category_id: 'courses', amount: -300 }), tx({ category_id: 'loisirs', amount: -120 }), tx({ category_id: 'resto', amount: -80 })],
      [budget({ category_id: 'alim', amount: 400 }), budget({ category_id: 'loisirs', amount: 200 })],
    );
    expect(r.total.budget).toBe(600);
    expect(r.total.spent).toBe(500);      // 300 + 80 (alim roulée) + 120
    expect(r.total.remaining).toBe(100);
    expect(r.total.spentAll).toBe(500);
  });

  it('le cumul ne compte QUE les racines : une sous-catégorie budgétée ne double pas son budget', () => {
    const r = run(
      [tx({ category_id: 'courses', amount: -238 }), tx({ category_id: 'resto', amount: -40 })],
      [budget({ category_id: 'alim', amount: 400 }), budget({ category_id: 'resto', amount: 100 })],
    );
    expect(r.total.budget).toBe(400);
    expect(r.total.spent).toBe(278);
  });
});

describe('hiérarchie : aucune double comptabilisation', () => {
  const txs = [
    tx({ category_id: 'courses', amount: -238 }),
    tx({ category_id: 'resto', amount: -40 }),
    tx({ category_id: 'loisirs', amount: -120 }),
  ];

  it('la parente ROULE ses enfants ; ce qui n’est pas budgété tombe dans « outside »', () => {
    const r = run(txs, [budget({ category_id: 'alim', amount: 400 })]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].categoryId).toBe('alim');
    expect(r.rows[0].spent).toBe(278);
    expect(r.outside).toBe(120);
  });

  it('une dépense compte dans sa sous-catégorie ET dans sa parente — deux lectures, pas deux euros', () => {
    const r = run(txs, [budget({ category_id: 'alim', amount: 400 }), budget({ category_id: 'resto', amount: 100 })]);
    expect(r.rows).toHaveLength(1);
    const alim = r.rows[0];
    expect(alim.spent).toBe(278);
    expect(alim.children).toHaveLength(1);
    expect(alim.children[0].categoryId).toBe('resto');
    expect(alim.children[0].spent).toBe(40);
    expect(r.outside).toBe(120); // 398 − 278, pas 398 − 318
  });

  it('une sous-catégorie budgétée sans sa parente remonte au premier niveau', () => {
    const r = run(txs, [budget({ category_id: 'resto', amount: 100 })]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].categoryId).toBe('resto');
    expect(r.rows[0].level).toBe('sub');
    expect(r.outside).toBe(358); // 398 − 40
  });
});

describe('combinaisons libres', () => {
  it('une catégorie sans budget n’est pas une erreur : elle passe en « autres dépenses »', () => {
    const r = run(
      [tx({ category_id: 'loisirs', amount: -120 }), tx({ category_id: 'courses', amount: -50 })],
      [budget({ category_id: 'alim', amount: 400 })],
    );
    expect(r.outside).toBe(120);
    expect(r.total.spentAll).toBe(170);
  });

  it('un seul budget de catégorie suffit à faire vivre l’écran', () => {
    const r = run([tx({ category_id: 'courses', amount: -238 })], [budget({ category_id: 'alim', amount: 400 })]);
    expect(r.isEmpty).toBe(false);
    expect(r.rows[0].remaining).toBe(162);
  });
});

describe('dépassement : information, jamais un calcul cassé', () => {
  it('le restant devient négatif et le reste (aucun écrêtage)', () => {
    const r = run([tx({ category_id: 'courses', amount: -470 })], [budget({ category_id: 'alim', amount: 400 })]);
    expect(r.rows[0].remaining).toBe(-70);
    expect(r.rows[0].pct).toBeCloseTo(117.5, 1);
  });
});

describe('remboursement', () => {
  it('vient en déduction du dépensé', () => {
    const r = run(
      [tx({ category_id: 'courses', amount: -300 }), tx({ category_id: 'courses', amount: 50 })],
      [budget({ category_id: 'alim', amount: 400 })],
    );
    expect(r.rows[0].spent).toBe(250);
    expect(r.rows[0].remaining).toBe(150);
  });
});

describe('les mois sont isolés', () => {
  it('une dépense d’août ne pèse pas sur septembre', () => {
    const txs = [tx({ category_id: 'courses', amount: -300, date: '2026-08-12' }), tx({ category_id: 'courses', amount: -100 })];
    expect(run(txs, [budget({ category_id: 'alim', amount: 1000 })], '2026-09').rows[0].spent).toBe(100);
    expect(run(txs, [budget({ category_id: 'alim', period_key: '2026-08', amount: 1000 })], '2026-08').rows[0].spent).toBe(300);
  });

  it('le mois COURANT s’arrête à aujourd’hui ; le futur déjà saisi est à part', () => {
    const txs = [tx({ category_id: 'courses', amount: -100 }), tx({ category_id: 'courses', amount: -45, date: '2026-09-25' })];
    const r = run(txs, [budget({ category_id: 'alim', amount: 1000 })]);
    expect(r.rows[0].spent).toBe(100);
    expect(r.plannedRest).toBe(45);
  });

  it('un mois FUTUR se lit en entier — sinon il afficherait 0 malgré ses dépenses saisies', () => {
    const r = run([tx({ category_id: 'courses', amount: -60, date: '2026-11-12' })], [budget({ category_id: 'alim', amount: 1000 })], '2026-11');
    expect(r.rows[0].spent).toBe(60);
  });
});

describe('exclusions — le budget ne parle que de variable', () => {
  it('récurrente, occurrence matérialisée, brouillon, virement et compte non courant sont hors budget', () => {
    const r = run(
      [
        tx({ category_id: 'courses', amount: -100 }),
        tx({ category_id: 'courses', amount: -800, is_recurring: true, recurrence_rule: 'monthly' }),
        tx({ category_id: 'courses', amount: -700, materialized_from: 'tpl1' }),
        tx({ category_id: 'courses', amount: -600, is_draft: true }),
        tx({ category_id: 'courses', amount: -500, linked_account_id: 'ep' }),
        tx({ category_id: 'courses', amount: -400, account_id: 'ep' }),
        tx({ category_id: 'salaire', amount: 2500 }),
      ],
      [budget({ category_id: 'alim', amount: 1000 })],
    );
    expect(r.rows[0].spent).toBe(100);
    expect(r.total.spentAll).toBe(100);
  });
});

describe('« Mouvements » est hors budget', () => {
  /* Ce sont des virements internes : l'argent change de poche sans quitter le patrimoine. Un budget
     posé dessus (avant cette règle, ou par une écriture directe en base) ne doit plus rien
     afficher — son dépensé serait de toute façon éternellement à 0. */
  it('un budget sur « Mouvements » n’apparaît pas', () => {
    const r = run([tx({ category_id: 'courses', amount: -100 })], [budget({ category_id: 'mvt', amount: 500 })]);
    expect(r.rows).toEqual([]);
    expect(r.isEmpty).toBe(true);
  });

  it('ni sur une de ses SOUS-catégories', () => {
    const r = run([tx({ category_id: 'courses', amount: -100 })], [budget({ category_id: 'mvt-ep', amount: 300 })]);
    expect(r.rows).toEqual([]);
  });

  it('il ne gonfle pas non plus le cumul du mois', () => {
    const r = run(
      [tx({ category_id: 'courses', amount: -100 })],
      [budget({ category_id: 'alim', amount: 400 }), budget({ category_id: 'mvt', amount: 500 })],
    );
    expect(r.total.budget).toBe(400);
  });

  it('la saisie n’affiche aucun budget sur une catégorie de mouvement', () => {
    const r = resolveBudgetFor({
      fluxTx: [], accountTypeById: ACCOUNTS, categories: CATS, today: TODAY,
      categoryId: 'mvt-ep', date: '2026-09-18', amount: 200,
      budgets: [budget({ category_id: 'mvt', amount: 500 })],
    });
    expect(r).toBeNull();
  });
});

describe('cadence annuelle — deux fenêtres, jamais une division', () => {
  const txs = [
    tx({ category_id: 'vac', amount: -1200, date: '2026-04-10' }),
    tx({ category_id: 'vac', amount: -650, date: '2026-09-02' }),
    tx({ category_id: 'courses', amount: -300 }),
  ];
  const budgets = [
    budget({ category_id: 'alim', amount: 400 }),
    budget({ category_id: 'vac', period: 'year', period_key: '2026', amount: 2400 }),
  ];

  it('un budget annuel se lit sur l’ANNÉE, pas sur un douzième du mois', () => {
    const r = run(txs, budgets);
    expect(r.annual).toHaveLength(1);
    expect(r.annual[0].budget).toBe(2400);
    expect(r.annual[0].spent).toBe(1850); // avril + septembre
    expect(r.annual[0].remaining).toBe(550);
  });

  it('il n’entre PAS dans le cumul du mois ni dans ses lignes mensuelles', () => {
    const r = run(txs, budgets);
    expect(r.rows.map((x) => x.categoryId)).toEqual(['alim']);
    expect(r.total.budget).toBe(400);
    expect(r.total.spent).toBe(300);
    // Le dépensé TOTAL, lui, comprend bien les vacances de septembre.
    expect(r.total.spentAll).toBe(950);
  });
});

describe('régularisation — elle compte, mais isolée', () => {
  it('entre dans le dépensé ET ressort dans regulPart', () => {
    const r = run(
      [tx({ category_id: 'courses', amount: -200 }), tx({ category_id: 'courses', amount: -80, regul_target: 1500 })],
      [budget({ category_id: 'alim', amount: 1000 })],
    );
    expect(r.rows[0].spent).toBe(280);
    expect(r.regulPart).toBe(80);
  });
});

describe('resolveBudgetFor — la saisie', () => {
  const base = {
    fluxTx: [tx({ category_id: 'courses', amount: -238 }), tx({ category_id: 'resto', amount: -40 })],
    accountTypeById: ACCOUNTS,
    categories: CATS,
    today: TODAY,
  };

  it('le plus spécifique gagne : la sous-catégorie avant sa parente', () => {
    const r = resolveBudgetFor({
      ...base, categoryId: 'resto', date: '2026-09-18', amount: 40,
      budgets: [budget({ category_id: 'alim', amount: 400 }), budget({ category_id: 'resto', amount: 100 })],
    });
    expect(r?.level).toBe('sub');
    expect(r?.categoryId).toBe('resto');
    expect(r?.budget).toBe(100);
    expect(r?.spentBefore).toBe(40);
    expect(r?.spentAfter).toBe(80);
  });

  it('sans budget de sous-catégorie, on remonte à la parente (qui roule ses enfants)', () => {
    const r = resolveBudgetFor({
      ...base, categoryId: 'courses', date: '2026-09-18', amount: 40,
      budgets: [budget({ category_id: 'alim', amount: 400 })],
    });
    expect(r?.level).toBe('parent');
    expect(r?.spentBefore).toBe(278);
    expect(r?.remainingAfter).toBe(82);
  });

  it('sans budget sur la catégorie NI sa parente, on ne montre rien', () => {
    const r = resolveBudgetFor({ ...base, categoryId: 'courses', date: '2026-09-18', amount: 40, budgets: [budget({ category_id: 'loisirs', amount: 200 })] });
    expect(r).toBeNull();
  });

  it('la DATE pilote la période : un mois futur lit son budget reporté et ses dépenses saisies', () => {
    const r = resolveBudgetFor({
      ...base,
      fluxTx: [...base.fluxTx, tx({ category_id: 'courses', amount: -60, date: '2026-11-05' })],
      categoryId: 'courses', date: '2026-11-12', amount: 40,
      budgets: [budget({ category_id: 'alim', period_key: '2026-08', amount: 400 })],
    });
    expect(r?.periodKey).toBe('2026-11');
    expect(r?.inherited).toBe(true);
    expect(r?.fromKey).toBe('2026-08');
    expect(r?.spentBefore).toBe(60);   // novembre seulement
    expect(r?.spentAfter).toBe(100);
    expect(r?.isFuture).toBe(true);
  });

  it('une modification n’est pas comptée deux fois', () => {
    const target = tx({ category_id: 'resto', amount: -40, id: 'edit-me' });
    const r = resolveBudgetFor({
      ...base, fluxTx: [tx({ category_id: 'resto', amount: -20 }), target],
      categoryId: 'resto', date: '2026-09-18', amount: 40, excludeTxId: 'edit-me',
      budgets: [budget({ category_id: 'resto', amount: 100 })],
    });
    expect(r?.spentBefore).toBe(20);
  });

  it('date incomplète ou catégorie absente → null, jamais un calcul à moitié', () => {
    const b = [budget({ category_id: 'alim', amount: 400 })];
    expect(resolveBudgetFor({ ...base, categoryId: 'courses', date: '2026-1', amount: 10, budgets: b })).toBeNull();
    expect(resolveBudgetFor({ ...base, categoryId: null, date: '2026-09-18', amount: 10, budgets: b })).toBeNull();
  });

  it('un budget annuel de catégorie est retenu quand il n’y a pas de mensuel', () => {
    const r = resolveBudgetFor({
      ...base, fluxTx: [tx({ category_id: 'vac', amount: -1200, date: '2026-04-10' })],
      categoryId: 'vac', date: '2026-09-18', amount: 300,
      budgets: [budget({ category_id: 'vac', period: 'year', period_key: '2026', amount: 2400 })],
    });
    expect(r?.period).toBe('year');
    expect(r?.spentBefore).toBe(1200);
  });
});

describe('historique', () => {
  const txs = [
    tx({ category_id: 'courses', amount: -920, date: '2026-07-10' }),
    tx({ category_id: 'courses', amount: -1080, date: '2026-08-10' }),
    tx({ category_id: 'courses', amount: -300, date: '2026-09-10' }),
  ];
  const hist = (months: string[], budgets: BudgetRecord[]) =>
    buildBudgetHistory(months, txs, ACCOUNTS, budgets, TODAY, CATS);

  it('chaque mois porte le budget qui était le sien', () => {
    const pts = hist(['2026-07', '2026-08', '2026-09'], [
      budget({ category_id: 'alim', period_key: '2026-07', amount: 950 }),
      budget({ category_id: 'alim', period_key: '2026-08', amount: 1000 }),
    ]);
    expect(pts.map((p) => p.budget)).toEqual([950, 1000, 1000]); // septembre hérite d'août
    expect(pts.map((p) => p.spent)).toEqual([920, 1080, 300]);
    expect(pts.map((p) => p.gap)).toEqual([30, -80, 700]);
  });

  it('un mois sans budget n’a pas de repère — pas de dépassement fantôme', () => {
    const pts = hist(['2026-07', '2026-08'], [budget({ category_id: 'alim', period_key: '2026-08', amount: 1000 })]);
    expect(pts[0].hasBudget).toBe(false);
    expect(pts[0].gap).toBeNull();
    expect(countMonthsRespected(pts)).toEqual({ respected: 0, total: 1 });
  });

  it('le cumul ne compte pas deux fois une sous-catégorie budgétée sous sa parente', () => {
    const pts = hist(['2026-09'], [
      budget({ category_id: 'alim', amount: 400 }),
      budget({ category_id: 'courses', amount: 250 }),
    ]);
    expect(pts[0].budget).toBe(400);
    expect(pts[0].spent).toBe(300);
  });
});

describe('utilitaires de période', () => {
  it('dérive les clés et les libellés', () => {
    expect(monthKeyOf('2026-09-18')).toBe('2026-09');
    expect(yearKeyOf('2026-09-18')).toBe('2026');
    expect(periodLabel('month', '2026-09')).toBe('septembre 2026');
    expect(periodLabel('year', '2026')).toBe('2026');
  });
});
