/* On importe le MOTEUR, jamais le hook : passer par `hooks/usePilotageData` tirerait `lib/supabase`,
   donc `react-native`, qui ne s'exécute pas dans une suite Node. C'est précisément ce couplage que
   l'extraction a supprimé. */
import { computePilotageData, type PilotageInput } from '../lib/finance/pilotageEngine';

/**
 * Tests de caractérisation du cœur de calcul du Pilotage (≈800 lignes).
 *
 * Ils décrivent le comportement ACTUEL, celui qui tourne en production. Leur but n'est pas de juger
 * les règles métier mais de les FIGER, pour qu'un découpage ultérieur du fichier ne puisse pas les
 * modifier en douce (cf. docs/PLAN_REFACTOR_TESTS.md).
 *
 * Toutes les dates sont exprimées par rapport à une horloge FIXE, injectée. Sans elle, la moitié de
 * ces cas — bascule de mois, dépenses « passées » vs « à venir », point bas — ne seraient
 * reproductibles qu'un jour par mois.
 */

/** Horloge de référence : 15 juin 2026, milieu de mois et de semaine. */
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

function account(over: Partial<any> = {}): any {
  return {
    id: uid('acc'), profile_id: 'me', name: 'Compte courant', type: 'checking',
    balance: 1000, currency: 'EUR', is_joint: false,
    init_date: iso(2026, 1, 1), created_at: iso(2026, 1, 1),
    ...over,
  };
}

function tx(over: Partial<any> = {}): any {
  return {
    id: uid('tx'), profile_id: 'me', account_id: 'acc-1', amount: -50,
    date: iso(2026, 6, 10), type: 'expense', is_recurring: false, recurrence_rule: null,
    is_draft: false, note: null, category_id: 'cat-1',
    category: { name: 'Courses', type: 'expense', is_variable: true },
    created_at: iso(2026, 6, 10),
    ...over,
  };
}

/** Entrée minimale valide. Chaque test ne surcharge que ce qui l'intéresse. */
function input(over: Partial<PilotageInput> = {}): PilotageInput {
  return {
    profile: { id: 'me', currency_code: 'EUR', created_at: iso(2025, 1, 1) } as any,
    sharedFactor: {},
    sharedModeById: {},
    estimatedMonths: new Set<string>(),
    accounts: [],
    transactions: [],
    questionnaireAnswers: null,
    projects: [],
    monthOverrides: [],
    rates: { EUR: 1 },
    ...over,
  } as PilotageInput;
}

const run = (over: Partial<PilotageInput> = {}, now: Date = NOW) => computePilotageData(input(over), now);

describe('computePilotageData — compte vide', () => {
  it('ne rend aucun NaN et part de zéro quand il n\'y a rien', () => {
    const r = run();
    expect(r.current_checking_balance).toBe(0);
    expect(r.month_expenses_total).toBe(0);
    expect(r.variable_envelope_source).toBe('none');
    // Aucun montant ne doit être NaN : un NaN se propage silencieusement jusqu'à l'écran.
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('additionne le solde des comptes courants, et eux seuls', () => {
    const r = run({
      accounts: [
        account({ id: 'a1', balance: 1200 }),
        account({ id: 'a2', balance: 300 }),
        account({ id: 'a3', type: 'savings', balance: 9000 }),
      ],
    });
    expect(r.current_checking_balance).toBe(1500);
  });
});

describe('computePilotageData — dépenses passées et à venir du mois', () => {
  const accounts = [account({ id: 'a1', balance: 1000 })];

  it('sépare ce qui est déjà passé de ce qui reste à sortir', () => {
    const r = run({
      accounts,
      transactions: [
        tx({ account_id: 'a1', amount: -100, date: iso(2026, 6, 3) }),   // passé
        tx({ account_id: 'a1', amount: -40, date: iso(2026, 6, 25) }),   // à venir
      ],
    });
    expect(r.month_expenses_past).toBeCloseTo(100, 2);
    expect(r.month_expenses_remaining).toBeCloseTo(40, 2);
    expect(r.month_expenses_total).toBeCloseTo(140, 2);
  });

  it('ignore les dépenses des autres mois', () => {
    const r = run({
      accounts,
      transactions: [
        tx({ account_id: 'a1', amount: -100, date: iso(2026, 5, 20) }),  // mois précédent
        tx({ account_id: 'a1', amount: -70, date: iso(2026, 6, 10) }),
        tx({ account_id: 'a1', amount: -300, date: iso(2026, 8, 4) }),   // deux mois plus tard
      ],
    });
    expect(r.month_expenses_total).toBeCloseTo(70, 2);
  });

  it('affiche un brouillon dans le total du mois sans jamais l\'imputer au budget', () => {
    /* Distinction volontaire et facile à casser par mégarde : un brouillon est VISIBLE dans le total
       du mois (c'est une dépense prévue, l'utilisateur doit la voir), mais il n'entre ni dans le
       passé — il n'est pas dans le solde — ni dans le « reste à sortir », qui seul ampute le budget
       libre. Tant qu'il n'est pas validé, il n'engage rien. */
    const r = run({
      accounts,
      transactions: [
        tx({ account_id: 'a1', amount: -80, date: iso(2026, 6, 10) }),
        tx({ account_id: 'a1', amount: -500, date: iso(2026, 6, 12), is_draft: true }),
      ],
    });
    expect(r.month_expenses_total).toBeCloseTo(580, 2);   // visible
    expect(r.month_expenses_past).toBeCloseTo(80, 2);     // pas dans le solde
    expect(r.month_expenses_remaining).toBeCloseTo(0, 2); // n'ampute pas le budget libre
  });
});

describe('computePilotageData — régularisations', () => {
  /* ⚠️ Depuis la migration 175, une régularisation à la baisse EST une dépense variable, et c'est
     voulu : constater après coup qu'il manque 80 € sur le compte, c'est 80 € dépensés — la seule
     différence avec des courses, c'est qu'on ne sait pas en quoi. Ce test fige cette décision
     (elle est contre-intuitive, donc exactement le genre qu'un refactor pourrait défaire par
     mégarde en croyant « corriger » quelque chose). */
  it('compte une régularisation à la baisse comme une dépense du mois', () => {
    const accounts = [account({ id: 'a1', balance: 1000 })];
    const sans = run({ accounts, transactions: [tx({ account_id: 'a1', amount: -60, date: iso(2026, 6, 8) })] });
    const avec = run({
      accounts,
      transactions: [
        tx({ account_id: 'a1', amount: -60, date: iso(2026, 6, 8) }),
        tx({
          account_id: 'a1', amount: -250, date: iso(2026, 6, 9),
          category_id: null, category: null, note: 'Régularisation',
        }),
      ],
    });
    expect(avec.month_expenses_total - sans.month_expenses_total).toBeCloseTo(250, 2);
  });

  it('retient la régularisation comme date de dernière vérification', () => {
    const r = run({
      accounts: [account({ id: 'a1', balance: 1000 })],
      transactions: [tx({
        account_id: 'a1', amount: -250, date: iso(2026, 6, 9),
        category_id: null, category: null, note: 'Régularisation',
      })],
    });
    expect(r.confidence_inputs.lastVerifiedAt).toBe(iso(2026, 6, 9));
  });

  it('traite la création d\'un compte courant comme une vérification initiale', () => {
    // Le solde est recopié depuis la banque ce jour-là : l'écart est nul par construction.
    const r = run({ accounts: [account({ id: 'a1', balance: 1000, init_date: iso(2026, 4, 2) })] });
    expect(r.confidence_inputs.lastVerifiedAt).toBe(iso(2026, 4, 2));
  });
});

describe('computePilotageData — enveloppe des dépenses variables', () => {
  /* Référence unifiée « budget variable habituel » : le questionnaire tant qu'il n'y a pas assez
     d'historique, l'historique dès qu'il devient exploitable. */
  it('se rabat sur le questionnaire quand l\'historique est trop court', () => {
    const r = run({
      accounts: [account({ id: 'a1', balance: 1000 })],
      questionnaireAnswers: { q9: 100 }, // hebdomadaire → mensualisé par le moteur
    });
    expect(r.variable_envelope_source).toBe('onboarding');
    expect(r.variable_envelope_initial).toBeGreaterThan(0);
  });

  it('n\'invente aucune enveloppe sans historique ni questionnaire', () => {
    const r = run({ accounts: [account({ id: 'a1', balance: 1000 })] });
    expect(r.variable_envelope_source).toBe('none');
    expect(r.variable_envelope_initial).toBe(0);
    expect(r.variable_real_available).toBe(false);
  });

  it('ne descend jamais le reste d\'enveloppe sous zéro', () => {
    const r = run({
      accounts: [account({ id: 'a1', balance: 1000 })],
      questionnaireAnswers: { q9: 20 },
      transactions: [tx({ account_id: 'a1', amount: -5000, date: iso(2026, 6, 2) })],
    });
    expect(r.variable_envelope_remaining).toBeGreaterThanOrEqual(0);
  });
});

describe('computePilotageData — point bas de trésorerie', () => {
  it('rend une date de point bas dans l\'horizon simulé', () => {
    const r = run({
      accounts: [account({ id: 'a1', balance: 2000 })],
      transactions: [
        tx({ account_id: 'a1', amount: -900, date: iso(2026, 6, 20) }),
        tx({ account_id: 'a1', amount: 2500, date: iso(2026, 6, 28), type: 'income', category: { name: 'Salaire', type: 'income' } }),
      ],
    });
    expect(r.cashflow_trough_date >= iso(2026, 6, 15)).toBe(true);
    expect(r.cashflow_trough_date <= r.cashflow_horizon_end).toBe(true);
  });

  it('abaisse le point bas quand une grosse dépense future s\'ajoute', () => {
    const accounts = [account({ id: 'a1', balance: 2000 })];
    const sans = run({ accounts });
    const avec = run({ accounts, transactions: [tx({ account_id: 'a1', amount: -1500, date: iso(2026, 6, 22) })] });
    expect(avec.cashflow_trough).toBeLessThan(sans.cashflow_trough);
  });
});

describe('computePilotageData — bascule de mois', () => {
  /* Ces deux cas n'étaient pas écrivables avant l'injection de l'horloge : ils exigeaient
     d'attendre le bon jour. C'est exactement le genre de bord où une régression passe inaperçue. */
  const accounts = [account({ id: 'a1', balance: 1000 })];
  const transactions = [
    tx({ account_id: 'a1', amount: -120, date: iso(2026, 6, 30) }),
    tx({ account_id: 'a1', amount: -80, date: iso(2026, 7, 1) }),
  ];

  it('le dernier jour du mois à 23 h 59, la dépense du jour appartient encore au mois', () => {
    const r = computePilotageData(input({ accounts, transactions }), new Date(2026, 5, 30, 23, 59, 0));
    expect(r.month_expenses_total).toBeCloseTo(120, 2);
  });

  it('le lendemain à 00 h 01, le mois a changé et le compteur est reparti', () => {
    const r = computePilotageData(input({ accounts, transactions }), new Date(2026, 6, 1, 0, 1, 0));
    expect(r.month_expenses_total).toBeCloseTo(80, 2);
  });
});

describe('computePilotageData — déterminisme', () => {
  it('rend exactement le même résultat pour la même entrée et la même horloge', () => {
    const data = input({
      accounts: [account({ id: 'a1', balance: 1234 }), account({ id: 'a2', type: 'savings', balance: 5000 })],
      transactions: [
        tx({ account_id: 'a1', amount: -210, date: iso(2026, 6, 4) }),
        tx({ account_id: 'a1', amount: 2400, date: iso(2026, 6, 27), type: 'income', category: { name: 'Salaire', type: 'income' } }),
      ],
      questionnaireAnswers: { q9: 90 },
    });
    expect(computePilotageData(data, NOW)).toEqual(computePilotageData(data, NOW));
  });
});
