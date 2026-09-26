import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePilotageReadiness } from '../hooks/pilotage/usePilotageReadiness';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const query = (refetch: jest.Mock<Promise<unknown>, any[]> = jest.fn(async () => undefined)) => ({ isSuccess: true, isError: false, fetchStatus: 'idle', refetch });

it('ne montre pas le cache avant la synchronisation puis les lectures complémentaires', async () => {
  const sync = deferred(), extras = deferred();
  const main = query(jest.fn(() => sync.promise)); const reserve = query(jest.fn(() => extras.promise));
  const { result } = renderHook(() => usePilotageReadiness('u', false, main, [reserve]));
  expect(result.current.ready).toBe(false);
  expect(reserve.refetch).not.toHaveBeenCalled();
  await act(async () => sync.resolve());
  expect(reserve.refetch).toHaveBeenCalled();
  expect(result.current.ready).toBe(false);
  await act(async () => extras.resolve());
  await waitFor(() => expect(result.current.ready).toBe(true));
});
it('un échec des réservations bloque les montants, même avec un cache réussi', async () => {
  const { result } = renderHook(() => usePilotageReadiness('u', false, query(), [query(jest.fn(async () => { throw new Error('offline'); }))]));
  await waitFor(() => expect(result.current.failed).toBe(true), { timeout: 4000 });
  expect(result.current.ready).toBe(false);
});
it('hors ligne, ne présente jamais le cache comme un Relyka actualisé', () => {
  const main = query();
  const { result } = renderHook(() => usePilotageReadiness('u', true, main, []));
  expect(result.current.ready).toBe(false);
  expect(main.refetch).not.toHaveBeenCalled();
});

it('ne libère pas les données après quatre secondes de réseau lent', async () => {
  jest.useFakeTimers();
  const sync = deferred(); const main = query(jest.fn(() => sync.promise));
  const { result, unmount } = renderHook(() => usePilotageReadiness('u', false, main, []));
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(result.current.ready).toBe(false);
  unmount(); jest.useRealTimers();
});
it('une ancienne réponse ne déverrouille pas un autre utilisateur', async () => {
  const first = deferred(), second = deferred();
  const main = query(jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
  const { result, rerender } = renderHook(({ user }: { user: string }) => usePilotageReadiness(user, false, main, []), { initialProps: { user: 'one' } });
  rerender({ user: 'two' });
  await act(async () => first.resolve());
  expect(result.current.ready).toBe(false);
  await act(async () => second.resolve());
  await waitFor(() => expect(result.current.ready).toBe(true));
});

it('récupère sans recharger après une invalidation concurrente des lectures complémentaires', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['reserve'], { amount: 999 }, { updatedAt: 1 });
  const first = deferred();
  const fetchReserve = jest.fn().mockImplementationOnce(() => first.promise.then(() => ({ amount: 999 })))
    .mockResolvedValue({ amount: 200 });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => {
    const reserve = useQuery({ queryKey: ['reserve'], queryFn: fetchReserve });
    return usePilotageReadiness('u', false, query(), [reserve]);
  }, { wrapper });
  await waitFor(() => expect(fetchReserve).toHaveBeenCalledTimes(1));
  expect(result.current.ready).toBe(false);
  await act(async () => { await client.invalidateQueries({ queryKey: ['reserve'] }); });
  await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 4000 });
  expect(result.current.failed).toBe(false);
  expect(client.getQueryData(['reserve'])).toEqual({ amount: 200 });
  await act(async () => first.resolve());
  expect(client.getQueryData(['reserve'])).toEqual({ amount: 200 });
  unmount(); client.clear();
});

it('se débloque après le rétablissement réseau sans actualisation de la page', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['reserve'], { amount: 999 }, { updatedAt: 1 });
  const fetchReserve = jest.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ amount: 200 });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => {
    const reserve = useQuery({ queryKey: ['reserve'], queryFn: fetchReserve });
    return usePilotageReadiness('u', false, query(), [reserve]);
  }, { wrapper });
  await waitFor(() => expect(fetchReserve).toHaveBeenCalled());
  await act(async () => { await client.refetchQueries({ queryKey: ['reserve'] }); });
  await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 4000 });
  expect(result.current.failed).toBe(false);
  unmount(); client.clear();
});

it('relance automatiquement une erreur transitoire puis affiche les données validées', async () => {
  const main = query(jest.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(undefined));
  const { result } = renderHook(() => usePilotageReadiness('u', false, main, []));
  await waitFor(() => expect(main.refetch).toHaveBeenCalledTimes(1));
  expect(result.current.ready).toBe(false);
  expect(result.current.failed).toBe(false);
  await waitFor(() => expect(result.current.ready).toBe(true), { timeout: 3000 });
  expect(main.refetch).toHaveBeenCalledTimes(2);
});

it('borne les relances et le bouton Réessayer redémarre sans recharger la page', async () => {
  const report = jest.fn();
  const main = query(jest.fn().mockRejectedValue(new Error('Network request failed')));
  const { result } = renderHook(() => usePilotageReadiness('u', false, main, [], report));
  await waitFor(() => expect(result.current.failed).toBe(true), { timeout: 4000 });
  expect(main.refetch).toHaveBeenCalledTimes(3);
  expect(result.current.ready).toBe(false);
  expect(report).toHaveBeenCalledTimes(1);
  main.refetch.mockResolvedValue(undefined);
  await act(async () => result.current.retry());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.failed).toBe(false);
});

it('ne relance pas une erreur permanente et annule la reprise au démontage', async () => {
  const permanent = query(jest.fn().mockRejectedValue({ code: '42501', message: 'permission denied' }));
  const first = renderHook(() => usePilotageReadiness('u', false, permanent, []));
  await waitFor(() => expect(first.result.current.failed).toBe(true));
  expect(permanent.refetch).toHaveBeenCalledTimes(1);
  first.unmount();
  jest.useFakeTimers();
  const main = query(jest.fn().mockRejectedValue(new Error('Failed to fetch')));
  const second = renderHook(() => usePilotageReadiness('u', false, main, []));
  await act(async () => {});
  second.unmount();
  await act(async () => jest.advanceTimersByTime(10000));
  expect(main.refetch).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('retour immédiat sur Pilotage : aucune nouvelle validation ni page masquée pendant un refetch', async () => {
  const client = new QueryClient();
  const main = query(); const extra = query();
  const first = renderHook(() => usePilotageReadiness('u', false, main, [extra], undefined, client));
  await waitFor(() => expect(first.result.current.ready).toBe(true));
  first.unmount();
  const back = renderHook(({ fetching }: { fetching: boolean }) => usePilotageReadiness('u', false,
    { ...main, fetchStatus: fetching ? 'fetching' : 'idle' }, [extra], undefined, client), { initialProps: { fetching: false } });
  expect(back.result.current.ready).toBe(true);
  expect(main.refetch).toHaveBeenCalledTimes(1);
  expect(extra.refetch).toHaveBeenCalledTimes(1);
  back.rerender({ fetching: true });
  expect(back.result.current.ready).toBe(true);
  back.unmount(); client.clear();
});

it('garde le tableau validé visible en cas d’échec de mise à jour, sans le dire à jour', async () => {
  const client = new QueryClient(); const main = query();
  const first = renderHook(() => usePilotageReadiness('u', false, main, [], undefined, client));
  await waitFor(() => expect(first.result.current.ready).toBe(true)); first.unmount();
  const back = renderHook(() => usePilotageReadiness('u', false, { ...main, isSuccess: false, isError: true, dataUpdatedAt: Date.now(), error: new Error('offline') }, [], undefined, client));
  expect(back.result.current.ready).toBe(true);
  expect(back.result.current.failed).toBe(true);
  back.unmount(); client.clear();
});

it('réutilise les lectures réseau du démarrage sans seconde vague de requêtes', async () => {
  const main = { ...query(), dataUpdatedAt: Date.now() };
  const extra = { ...query(), dataUpdatedAt: Date.now() };
  const { result } = renderHook(() => usePilotageReadiness('u', false, main, [extra]));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(main.refetch).not.toHaveBeenCalled(); expect(extra.refetch).not.toHaveBeenCalled();
});

it('un nouveau lancement attend la validation du cache ancien même si les données sont présentes', async () => {
  const client = new QueryClient(); const pending = deferred();
  const main = { ...query(jest.fn(() => pending.promise)), dataUpdatedAt: 1 };
  const { result, unmount } = renderHook(() => usePilotageReadiness('u', false, main, [], undefined, client));
  expect(result.current.ready).toBe(false);
  await act(async () => pending.resolve());
  await waitFor(() => expect(result.current.ready).toBe(true));
  unmount(); client.clear();
});
