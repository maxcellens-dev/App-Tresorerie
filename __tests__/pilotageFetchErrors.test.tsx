import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockSupabase } from '../jest.setup';
import { usePilotageData } from '../hooks/pilotage/usePilotageData';
import { synchronizeFinances } from '../lib/finance/financialSync';

jest.mock('../lib/finance/financialSync', () => {
  const sync = jest.fn(async () => false);
  return { createFinancialSynchronizer: () => sync, synchronizeFinances: sync };
});
jest.mock('../hooks/data/useSharedContribution', () => ({
  fetchSharedContribution: jest.fn(async () => ({ accounts: [], transactions: [], factorByAccount: {}, modeByAccount: {} })),
  buildSharedContribution: jest.fn(),
}));

it.each(['currency_rates', 'transaction_month_overrides', 'credits', 'credit_events', 'month_closures'])(
  'une lecture %s en erreur ne devient pas un Pilotage incomplet', async table => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
    mockSupabase.from.mockImplementation(name => {
      const result = { data: name === 'profiles' ? { id: 'u' } : [], error: name === table ? new Error(`lecture ${table}`) : null };
      const q: any = { then: (resolve: any) => Promise.resolve(result).then(resolve) };
      for (const method of ['select', 'eq', 'or', 'single', 'maybeSingle']) q[method] = () => q;
      return q;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => usePilotageData('u'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(`lecture ${table}`);
    expect(result.current.data).toBeUndefined();
    unmount(); client.clear();
  },
);

it('lit le snapshot après synchronisation sans attendre les rechargements des autres écrans', async () => {
  (synchronizeFinances as jest.Mock).mockResolvedValueOnce(true);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
  mockSupabase.from.mockImplementation(name => {
    const response = { data: name === 'profiles' ? { id: 'u' } : [], error: null };
    const q: any = { then: (resolve: any) => Promise.resolve(response).then(resolve) };
    for (const method of ['select', 'eq', 'or', 'single', 'maybeSingle']) q[method] = () => q;
    return q;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let finish!: () => void;
  const refresh = new Promise<void>(resolve => { finish = resolve; });
  jest.spyOn(client, 'invalidateQueries').mockReturnValue(refresh);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => usePilotageData('u'), { wrapper });
  try {
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.invalidateQueries).toHaveBeenCalled();
  } finally { finish(); unmount(); client.clear(); }
});
