import { detectUpcomingChanges, type UpcomingTx } from '../lib/aiUpcoming';

// Comptes : courant C, épargne S, investissement I, « autre » O.
const acctTypeById = { C: 'checking', S: 'savings', I: 'investment', O: 'other' };
const fullCat = (id: string | null | undefined) => (id ? `Cat ${id}` : 'Sans catégorie');
const isRefund = () => false;
const opts = { today: '2026-07-08', acctTypeById, fullCat, isRefund };

const tx = (o: Partial<UpcomingTx>): UpcomingTx => ({
  id: Math.random().toString(36).slice(2), date: '2026-07-01', amount: -10, accountType: 'checking', ...o,
});

describe('detectUpcomingChanges', () => {
  it('série ÉTABLIE (occurrences matérialisées passées) → PAS nouvelle malgré ancre future', () => {
    const r = detectUpcomingChanges([
      // Template vivant, ancre AVANCÉE au futur par la matérialisation.
      tx({ id: 'tpl', date: '2026-07-19', amount: -12, category_id: 'bank', is_recurring: true, recurrence_rule: 'monthly' }),
      // Occurrences matérialisées passées (is_recurring=false, materialized_from = tpl).
      tx({ date: '2026-06-19', amount: -12, category_id: 'bank', materialized_from: 'tpl' }),
      tx({ date: '2026-05-19', amount: -12, category_id: 'bank', materialized_from: 'tpl' }),
    ], opts);
    expect(r.starts).toHaveLength(0);
    expect(r.endings).toHaveLength(0);
  });

  it('série GENUINEMENT nouvelle (aucune occurrence passée) → apparaît en NOUVEAU', () => {
    const r = detectUpcomingChanges([
      tx({ id: 'newtpl', date: '2026-08-01', amount: -988, category_id: 'variable', is_recurring: true, recurrence_rule: 'monthly', recurrence_end_date: '2026-11-30' }),
      // Des ponctuelles passées de MÊME catégorie ne doivent PAS la masquer.
      tx({ date: '2026-06-10', amount: -40, category_id: 'variable' }),
    ], opts);
    expect(r.starts.map((s) => s.ym)).toEqual(['2026-08']);
    expect(r.starts[0].amount).toBe(988);
    // Elle se termine aussi en novembre.
    expect(r.endings.map((e) => e.ym)).toEqual(['2026-11']);
  });

  it('série TRONQUÉE (fin < ancre = supprimée/remplacée) → ignorée', () => {
    const r = detectUpcomingChanges([
      // Ancre avancée à août mais fin en juin → morte.
      tx({ id: 'dead', date: '2026-08-01', amount: -100, category_id: 'x', is_recurring: true, recurrence_rule: 'monthly', recurrence_end_date: '2026-06-30' }),
    ], opts);
    expect(r.starts).toHaveLength(0);
    expect(r.endings).toHaveLength(0);
  });

  it('nouveau REVENU récurrent → kind income', () => {
    const r = detectUpcomingChanges([
      tx({ id: 'inc', date: '2026-08-01', amount: 500, category_id: 'salary', is_recurring: true, recurrence_rule: 'monthly' }),
    ], opts);
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0].kind).toBe('income');
  });

  it('fin d’une série vivante établie → endings, pas starts', () => {
    const r = detectUpcomingChanges([
      tx({ id: 'ln', date: '2026-07-05', amount: -800, category_id: 'rent', is_recurring: true, recurrence_rule: 'monthly', recurrence_end_date: '2026-09-05' }),
      tx({ date: '2026-06-05', amount: -800, category_id: 'rent', materialized_from: 'ln' }),
    ], opts);
    expect(r.endings.map((e) => e.ym)).toEqual(['2026-09']);
    expect(r.starts).toHaveLength(0);
  });

  it('ponctuelle future notable → oneOffs (occurrence matérialisée exclue)', () => {
    const r = detectUpcomingChanges([
      tx({ date: '2026-07-15', amount: -4998, category_id: 'tax' }),
      tx({ date: '2026-07-20', amount: -30, category_id: 'small' }), // < 50 → ignorée
      tx({ date: '2026-07-25', amount: -60, category_id: 'mat', materialized_from: 'tpl' }), // matérialisée → exclue
    ], opts);
    expect(r.oneOffs.map((o) => o.date)).toEqual(['2026-07-15']);
    expect(r.oneOffs[0].amount).toBe(4998);
  });
});
