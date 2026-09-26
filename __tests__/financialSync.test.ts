import { synchronizeFinances, createFinancialSynchronizer } from '../lib/finance/financialSync';
import { creditScheduleHash } from '../lib/finance/creditMaterialization';

const credit: any = { id: 'c', _role: 'owner', is_active: true, account_id: 'a', materialized_until: '2026-01-01', schedule_hash: 'old' };
function harness() {
  const rpc = jest.fn(async (_name: string, _args?: any): Promise<any> => ({ data: 0, error: null }));
  const deps = {
    rpc, loadCredits: jest.fn(async () => [] as any[]),
    loadAccounts: jest.fn(async () => [{ id: 'a', _role: 'owner' }]), loadEvents: jest.fn(async () => ({})),
    schedule: jest.fn(() => [{ credit_id: 'c', credit_kind: 'pay' as const, credit_period: 1, date: '2026-09-01', amount: -100, account_id: 'a', category_id: null, note: 'Crédit' }]),
  };
  return deps;
}
it('ne publie jamais les crédits avant une réconciliation réussie', async () => {
  const d = harness(); d.rpc.mockImplementation(async name => name === 'recompute_account_balance' ? { error: new Error('offline') } : { data: null, error: null });
  await expect(synchronizeFinances('u', '2026-09-26', d)).rejects.toThrow('offline');
  expect(d.loadCredits).not.toHaveBeenCalled();
});
it('propage une lecture crédit ratée au lieu de calculer sans crédit', async () => {
  const d = harness(); d.loadCredits.mockRejectedValue(new Error('droits'));
  await expect(synchronizeFinances('u', '2026-09-26', d)).rejects.toThrow('droits');
});
it('publie atomiquement le tableau et le hash avant la matérialisation', async () => {
  const d = harness(); d.loadCredits.mockResolvedValue([credit]);
  await synchronizeFinances('u', '2026-09-26', d);
  const names = d.rpc.mock.calls.map(c => c[0]);
  expect(names).toEqual(['pending_materialization', 'materialize_due_recurring', 'recompute_account_balance', 'publish_credit_schedule', 'materialize_credit_from_schedule']);
  expect(d.rpc.mock.calls[3][1]).toMatchObject({ p_credit: 'c', p_today: '2026-09-26', p_rows: [{ kind: 'pay', period: 1, amount: -100 }] });
});
it('ne matérialise pas après une publication refusée', async () => {
  const d = harness(); d.loadCredits.mockResolvedValue([credit]);
  d.rpc.mockImplementation(async name => name === 'publish_credit_schedule' ? { error: new Error('refus') } : { data: 0, error: null });
  await expect(synchronizeFinances('u', '2026-09-26', d)).rejects.toThrow('refus');
  expect(d.rpc.mock.calls.some(c => c[0] === 'materialize_credit_from_schedule')).toBe(false);
});
it('ne publie jamais pour un lecteur ou un compte inactif', async () => {
  const d = harness(); d.loadCredits.mockResolvedValue([{ ...credit, _role: 'read' }, { ...credit, id: 'closed', account_id: 'closed' }]);
  await synchronizeFinances('u', '2026-09-26', d);
  expect(d.rpc.mock.calls.some(c => c[0] === 'publish_credit_schedule')).toBe(false);
});

it('lit la révision crédit avant de commencer à lire ses événements', async () => {
  const d = harness(); let release!: (value: any[]) => void;
  d.loadCredits.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const pending = synchronizeFinances('u', '2026-09-26', d);
  // Les RPC précédentes doivent se terminer avant la lecture crédit.
  while (!d.loadCredits.mock.calls.length) await Promise.resolve();
  expect(d.loadEvents).not.toHaveBeenCalled();
  release([{ ...credit, events_revision: 7 }]);
  await pending;
  expect(d.rpc).toHaveBeenCalledWith('publish_credit_schedule', expect.objectContaining({ p_expected_events_revision: 7 }));
});

it('ne lance pas deux synchronisations concurrentes lors des relances du cache', async () => {
  const sync = createFinancialSynchronizer(); const d = harness();
  const first = sync('u', '2026-09-26', d);
  const second = sync('u', '2026-09-26', d);
  expect(first).toBe(second);
  await first;
  expect(d.loadCredits).toHaveBeenCalledTimes(1);
});
it('ne réécrit pas tous les comptes à chaque refetch mais vérifie les nouvelles récurrences', async () => {
  const sync = createFinancialSynchronizer(); const d = harness();
  d.rpc.mockImplementation(async name => name === 'pending_materialization'
    ? { data: { needs_recurring: false, needs_posted: true }, error: null } : { data: 0, error: null });
  await sync('u', '2026-09-26', d); await sync('u', '2026-09-26', d);
  expect(d.rpc.mock.calls.filter(c => c[0] === 'recompute_account_balance')).toHaveLength(1);
  await sync('u', '2026-09-27', d);
  expect(d.rpc.mock.calls.filter(c => c[0] === 'recompute_account_balance')).toHaveLength(2);
});
it('une sonde réseau en échec ne déclenche pas une rafale de RPC d’écriture', async () => {
  const d = harness(); d.rpc.mockResolvedValue({ error: new Error('Network request failed') });
  await expect(synchronizeFinances('u', '2026-09-26', d)).rejects.toThrow('Network');
  expect(d.rpc).toHaveBeenCalledTimes(1);
});

it('ne relance pas la matérialisation des crédits déjà à jour', async () => {
  const d = harness();
  d.loadCredits.mockResolvedValue([{ ...credit, materialized_until: '2026-09-26', schedule_hash: creditScheduleHash(d.schedule()) }]);
  await synchronizeFinances('u', '2026-09-26', d);
  expect(d.rpc.mock.calls.some(c => c[0] === 'materialize_credit_from_schedule')).toBe(false);
  expect(d.rpc.mock.calls.some(c => c[0] === 'publish_credit_schedule')).toBe(false);
});
it('sans crédit, ne charge pas les événements de crédit', async () => {
  const d = harness(); await synchronizeFinances('u', '2026-09-26', d);
  expect(d.loadEvents).not.toHaveBeenCalled();
});
