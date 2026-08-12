import { getMonthKey, getMonthsFromOffset, groupCategories, createOverridesMap, getOverrideKey } from '../lib/finance/treasuryTable';
import type { Category } from '../types/database';

const NOW = new Date(2026, 5, 15); // 15 juin 2026

describe('getMonthKey', () => {
  it('complète le mois sur deux chiffres', () => {
    expect(getMonthKey(2026, 1)).toBe('2026-01');
    expect(getMonthKey(2026, 12)).toBe('2026-12');
  });
});

describe('getMonthsFromOffset', () => {
  it('part du mois courant quand le décalage est nul', () => {
    const m = getMonthsFromOffset(0, 3, NOW);
    expect(m.map((x) => x.key)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('remonte dans le passé avec un décalage négatif', () => {
    const m = getMonthsFromOffset(-2, 3, NOW);
    expect(m.map((x) => x.key)).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('franchit correctement les fins d\'année', () => {
    const m = getMonthsFromOffset(6, 3, NOW);
    expect(m.map((x) => x.key)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('rend année et mois cohérents avec la clé', () => {
    const [first] = getMonthsFromOffset(7, 1, NOW);
    expect(first).toEqual({ year: 2027, month: 1, key: '2027-01' });
  });
});

describe('groupCategories', () => {
  const cats = [
    { id: 'p1', parent_id: null, name: 'Logement' },
    { id: 'p2', parent_id: null, name: 'Frais variables' },
    { id: 'c1', parent_id: 'p1', name: 'Loyer' },
    { id: 'c2', parent_id: 'p2', name: 'Courses' },
    { id: 'c3', parent_id: 'p2', name: 'Essence' },
  ] as unknown as Category[];

  it('sépare les racines de leurs sous-catégories', () => {
    const { parents, byParent } = groupCategories(cats);
    expect(parents.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(byParent['p2'].map((c) => c.id)).toEqual(['c2', 'c3']);
  });

  it('n\'invente pas d\'entrée pour un parent sans enfant', () => {
    const { byParent } = groupCategories([{ id: 'p1', parent_id: null, name: 'Seul' }] as unknown as Category[]);
    expect(byParent['p1']).toBeUndefined();
  });
});

describe('createOverridesMap', () => {
  it('indexe les montants modifiés par transaction, année et mois', () => {
    const map = createOverridesMap([
      { transaction_id: 't1', year: 2026, month: 6, override_amount: -120 },
      { transaction_id: 't2', year: 2026, month: 7, override_amount: 300 },
    ]);
    expect(map[getOverrideKey('t1', 2026, 6)]).toBe(-120);
    expect(map[getOverrideKey('t2', 2026, 7)]).toBe(300);
  });

  it('ignore un override qui ne porte QUE sur la date', () => {
    /* Une échéance peut être déplacée sans changer de montant (override_date) : il n'y a alors
       aucun montant à appliquer, et l'inscrire ferait passer la ligne à zéro. */
    const map = createOverridesMap([{ transaction_id: 't1', year: 2026, month: 6, override_amount: null }]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('conserve un montant explicitement mis à zéro', () => {
    // 0 ≠ « pas d'override » : c'est une échéance annulée pour ce mois-là.
    const map = createOverridesMap([{ transaction_id: 't1', year: 2026, month: 6, override_amount: 0 }]);
    expect(map[getOverrideKey('t1', 2026, 6)]).toBe(0);
  });
});
