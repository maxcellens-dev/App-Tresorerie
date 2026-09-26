import { QueryClient } from '@tanstack/react-query';
import { refetchActiveQueries } from '../lib/platform/refetchActiveQueries';

it('les trois actualisations du démarrage rejoignent le chargement attendu par Pilotage', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ['pilotage_data', 'u'];
  client.setQueryData(key, { amount: 999 }, { updatedAt: 1 });
  let release!: (value: { amount: number }) => void;
  const queryFn = jest.fn(() => new Promise<{ amount: number }>(resolve => { release = resolve; }));
  const initial = client.fetchQuery({ queryKey: key, queryFn });
  // Pilotage rejoint le travail déjà démarré par le préchargement.
  const joined = client.fetchQuery({ queryKey: key, queryFn });
  const joinedOutcome = joined.then(data => ({ data }), error => ({ error }));
  await client.invalidateQueries({ queryKey: key, refetchType: 'none' });
  const foreground = refetchActiveQueries(client, { queryKey: key, stale: true });
  const hydration = refetchActiveQueries(client, { queryKey: key, stale: true });
  const focus = refetchActiveQueries(client, { queryKey: key, stale: true });
  release({ amount: 200 });
  await Promise.all([initial, foreground, hydration, focus]);
  expect(await joinedOutcome).toEqual({ data: { amount: 200 } });
  expect(queryFn).toHaveBeenCalledTimes(1);
  client.clear();
});
