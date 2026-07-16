import { matchProjectsForTransaction, nextMonthlyAllocation } from '../lib/projectMatch';
import type { Project } from '../types/database';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    profile_id: 'u1',
    name: 'Voiture',
    target_amount: 1500,
    monthly_allocation: 100,
    allocation_type: 'monthly',
    mode: 'transfer',
    source_account_id: 'src',
    linked_account_id: 'dst',
    status: 'active' as any,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  } as Project;
}

describe('matchProjectsForTransaction', () => {
  const base = { projects: [project()], progressPctById: { p1: 20 } };

  it('virement : mêmes comptes source + destination → match', () => {
    const r = matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'dst', ...base });
    expect(r.map((p) => p.id)).toEqual(['p1']);
  });

  it('virement : comptes inversés ou différents → pas de match', () => {
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'dst', targetAccountId: 'src', ...base })).toHaveLength(0);
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'autre', ...base })).toHaveLength(0);
  });

  it('dépense : projet « spend » au même compte + même catégorie → match', () => {
    const spend = project({ id: 'p2', mode: 'spend', linked_account_id: null, expense_category_id: 'cat1' });
    const args = { projects: [spend], progressPctById: {} };
    expect(matchProjectsForTransaction({ kind: 'expense', accountId: 'src', categoryId: 'cat1', ...args })).toHaveLength(1);
    expect(matchProjectsForTransaction({ kind: 'expense', accountId: 'src', categoryId: 'cat2', ...args })).toHaveLength(0);
    // Un virement ne matche jamais un projet « spend » (et réciproquement).
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'dst', ...args })).toHaveLength(0);
  });

  it('projet terminé (100 %), archivé ou « reserve » → jamais proposé', () => {
    const done = { projects: [project()], progressPctById: { p1: 100 } };
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'dst', ...done })).toHaveLength(0);
    const archived = { projects: [project({ status: 'archived' as any })], progressPctById: {} };
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'dst', ...archived })).toHaveLength(0);
    const reserve = { projects: [project({ mode: 'reserve', linked_account_id: 'src', source_account_id: 'src' })], progressPctById: {} };
    expect(matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'src', ...reserve })).toHaveLength(0);
  });

  it('avancement inconnu (pas encore dans le pilotage) → proposé quand même', () => {
    const r = matchProjectsForTransaction({ kind: 'transfer', accountId: 'src', targetAccountId: 'dst', projects: [project()], progressPctById: {} });
    expect(r).toHaveLength(1);
  });
});

describe('nextMonthlyAllocation', () => {
  const dateProject = { allocation_type: 'date', target_amount: 1500, target_date: '2026-12-15', monthly_allocation: 100 };

  it('mode « date cible » : mensualité = restant ÷ mois restants (mois courant exclu)', () => {
    // 16 juillet, cible décembre → 5 échéances restantes (août..déc). Restant 1500−500 = 1000 → 200.
    expect(nextMonthlyAllocation(dateProject, 500, '2026-07-16')).toBe(200);
  });

  it('mensualité inchangée (±1 centime) → null (pas de régénération inutile)', () => {
    expect(nextMonthlyAllocation(dateProject, 1000, '2026-07-16')).toBe(null); // 500/5 = 100 = actuel
  });

  it('cible atteinte → mensualité 0 (plus rien à verser)', () => {
    expect(nextMonthlyAllocation(dateProject, 1500, '2026-07-16')).toBe(0);
    expect(nextMonthlyAllocation(dateProject, 1800, '2026-07-16')).toBe(0);
  });

  it('cible du mois courant ou passée → null (rien à réétaler)', () => {
    expect(nextMonthlyAllocation({ ...dateProject, target_date: '2026-07-31' }, 500, '2026-07-16')).toBe(null);
    expect(nextMonthlyAllocation({ ...dateProject, target_date: '2026-06-30' }, 500, '2026-07-16')).toBe(null);
  });

  it('autres modes d’allocation → null (mensualité fixée par l’utilisateur)', () => {
    expect(nextMonthlyAllocation({ ...dateProject, allocation_type: 'monthly' }, 500, '2026-07-16')).toBe(null);
    expect(nextMonthlyAllocation({ ...dateProject, allocation_type: 'ponctuel' }, 500, '2026-07-16')).toBe(null);
  });
});
