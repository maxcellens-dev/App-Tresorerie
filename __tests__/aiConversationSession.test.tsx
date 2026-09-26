import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAiConversationSession } from '../hooks/platform/useAiConversationSession';

it('retrouve le fil après navigation mais démarre un fil neuf au prochain lancement', async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const first = renderHook(() => useAiConversationSession('u'), { wrapper });
  expect(first.result.current[0]).toBeNull();
  await act(async () => { first.result.current[1]('conversation'); });
  first.unmount();
  const back = renderHook(() => useAiConversationSession('u'), { wrapper });
  expect(back.result.current[0]).toBe('conversation');
  back.unmount();
  client.clear(); // Nouveau runtime ou déconnexion : aucun choix persisté sur disque.
  const reopened = renderHook(() => useAiConversationSession('u'), { wrapper });
  expect(reopened.result.current[0]).toBeNull();
  reopened.unmount(); client.clear();
});

it('isole les comptes et conserve aussi le choix Nouvelle conversation', async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(({ id }: { id: string }) => useAiConversationSession(id), { wrapper, initialProps: { id: 'one' } });
  await act(async () => { view.result.current[1]('private'); });
  view.rerender({ id: 'two' });
  expect(view.result.current[0]).toBeNull();
  view.rerender({ id: 'one' });
  expect(view.result.current[0]).toBe('private');
  await act(async () => { view.result.current[1](null); });
  view.unmount();
  const back = renderHook(() => useAiConversationSession('one'), { wrapper });
  expect(back.result.current[0]).toBeNull();
  back.unmount(); client.clear();
});
