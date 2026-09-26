import { createNetworkFetch } from '../lib/platform/networkFetch';

it('identifie la requête sans exposer ses jetons ou filtres', async () => {
  const request = createNetworkFetch(jest.fn(async () => { throw new TypeError('A network error occurred.'); }));
  await expect(request('https://example.test/rest/v1/rpc/pilotage_snapshot?token=SECRET', { method: 'POST', body: 'PRIVATE' }))
    .rejects.toThrow('Network request failed (POST rest/v1/rpc/pilotage_snapshot)');
  try { await request('https://example.test/storage/v1/private/SECRET?token=SECRET'); }
  catch (e) { expect(String(e)).not.toContain('SECRET'); }
});
it('interrompt une requête suspendue et permet une nouvelle tentative', async () => {
  jest.useFakeTimers();
  const request = createNetworkFetch(jest.fn((_url, init) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })), 500);
  const result = request('https://example.test/rest/v1/accounts');
  const expectation = expect(result).rejects.toThrow('Network timeout');
  await jest.advanceTimersByTimeAsync(500);
  await expectation;
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});
it('conserve une annulation demandée par l’appelant', async () => {
  const controller = new AbortController(); controller.abort();
  const original = new Error('cancelled');
  const request = createNetworkFetch(jest.fn(async () => { throw original; }));
  await expect(request('https://example.test', { signal: controller.signal })).rejects.toBe(original);
});
