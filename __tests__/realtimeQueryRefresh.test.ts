import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createRealtimeQueryRefresh } from '../lib/platform/realtimeQueryRefresh';

it('regroupe neuf mises à jour de soldes sans annuler le premier chargement, puis relit le dernier état', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ['pilotage_data', 'u'];
  client.setQueryData(key, 999, { updatedAt: 1 });
  let finish!: (value: number) => void;
  const fetch = jest.fn().mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; })).mockResolvedValue(200);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: fetch });
  const unsubscribe = observer.subscribe(() => {});
  const joined = observer.refetch({ cancelRefetch: false, throwOnError: true });
  const refresh = createRealtimeQueryRefresh(client);
  for (let i = 0; i < 9; i++) refresh.refresh(['pilotage_data']);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(250);
  await expect(joined).resolves.toMatchObject({ isSuccess: true });
  // Let the single follow-up invalidation complete.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(key)).toBe(200);
  refresh.dispose(); unsubscribe(); client.clear();
});
