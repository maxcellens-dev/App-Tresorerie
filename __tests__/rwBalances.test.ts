/**
 * Relyka World — soldes entre participants, en multi-devises.
 *
 * Une dépense est libellée dans la devise où elle a été PAYÉE (celle du compte utilisé, ou celle du
 * projet en cash) ; ses avances et ses parts le sont aussi. Le projet, lui, a UNE devise dans
 * laquelle se lisent tous ses totaux. Sans conversion, « 40 CHF + 40 € = 80 » — et le « qui doit
 * quoi » devenait faux dès qu'un participant réglait depuis un compte en devise étrangère.
 */
import { computeBalances, settleUp, type RwBalanceExpense, type RwBalanceParticipant, type RwBalanceShare, type RwBalancePayer } from '../lib/finance/rwBalances';

const participants = [
  { id: 'alice', project_id: 'p', user_id: null, display_name: 'Alice', created_at: '' },
  { id: 'bob', project_id: 'p', user_id: null, display_name: 'Bob', created_at: '' },
] as unknown as RwBalanceParticipant[];

const expense = (over: Partial<RwBalanceExpense>): RwBalanceExpense => ({
  id: 'e1', project_id: 'p', title: 'Resto', emoji: null, amount: 100, currency: 'EUR',
  date: '2026-08-20', paid_by: 'alice', created_by: null, account_id: null, transaction_id: null,
  created_at: '',
  ...over,
} as RwBalanceExpense);

const share = (expense_id: string, participant_id: string, amount: number): RwBalanceShare =>
  ({ expense_id, participant_id, amount });

/** Projet en EUR ; 1 EUR = 0,95 CHF (même convention que currency_rates : base EUR). */
const RATES: Record<string, number> = { EUR: 1, CHF: 0.95 };
const toEur = (amount: number, e: { currency?: string | null }) =>
  (e.currency ?? 'EUR') === 'EUR' ? amount : amount / RATES[e.currency as string];

describe('computeBalances — projet mono-devise (comportement inchangé)', () => {
  it('Alice avance 100, chacun doit 50 → Bob lui doit 50', () => {
    const expenses = [expense({})];
    const shares = [share('e1', 'alice', 50), share('e1', 'bob', 50)];
    const net = computeBalances(participants, expenses, shares, []);
    expect(net.get('alice')).toBeCloseTo(50, 2);
    expect(net.get('bob')).toBeCloseTo(-50, 2);
  });
});

describe('computeBalances — dépenses dans des devises différentes', () => {
  /* Alice règle 100 € (compte FR), Bob règle 95 CHF (compte suisse) — soit exactement 100 € au taux
     retenu. Chacun assume la moitié de chaque dépense : tout le monde doit finir à zéro. */
  const expenses = [
    expense({ id: 'e1', amount: 100, currency: 'EUR', paid_by: 'alice' }),
    expense({ id: 'e2', amount: 95, currency: 'CHF', paid_by: 'bob' }),
  ];
  const shares = [
    share('e1', 'alice', 50), share('e1', 'bob', 50),
    share('e2', 'alice', 47.5), share('e2', 'bob', 47.5),
  ];

  it('converties, les deux dépenses s’équilibrent exactement', () => {
    const net = computeBalances(participants, expenses, shares, [], toEur);
    expect(net.get('alice')).toBeCloseTo(0, 2);
    expect(net.get('bob')).toBeCloseTo(0, 2);
    expect(settleUp([...net].map(([id, amount]) => ({ id, amount })))).toEqual([]);
  });

  it('sans conversion, le solde est FAUX — c’est le bug que le convertisseur corrige', () => {
    const net = computeBalances(participants, expenses, shares, []);
    // 95 CHF comptés comme 95 € : Bob paraît devoir de l'argent alors qu'il est à jour.
    expect(net.get('bob')).toBeLessThan(-1);
  });

  it('les avances multi-payeurs sont converties elles aussi', () => {
    // Bob a avancé 95 CHF sur e2, en deux lignes (payers) plutôt que par la colonne historique.
    const payers: RwBalancePayer[] = [
      { expense_id: 'e2', participant_id: 'bob', amount: 45 },
      { expense_id: 'e2', participant_id: 'alice', amount: 50 },
    ];
    const net = computeBalances(participants, expenses, shares, payers, toEur);
    /* Alice : +100 € avancés sur e1, +50 CHF avancés sur e2 (≈ 52,63 €), et ses parts font 100 €
       une fois converties (50 € + 47,50 CHF ≈ 50 €). Reste ≈ 52,63 € qu'on lui doit. */
    expect(net.get('alice')).toBeCloseTo(100 + 50 / 0.95 - (50 + 47.5 / 0.95), 2);
    // La somme des soldes reste nulle : rien ne se crée ni ne se perd à la conversion.
    expect((net.get('alice') ?? 0) + (net.get('bob') ?? 0)).toBeCloseTo(0, 2);
  });
});
