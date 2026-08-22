/**
 * Monte un composant avec le décor MINIMAL dont l'app a besoin pour rendre.
 *
 * `retry: false` est essentiel : par défaut react-query réessaie les requêtes en échec, ce qui fait
 * expirer les tests d'erreur au lieu de les faire échouer proprement. `gcTime: Infinity` évite que
 * le cache soit nettoyé entre deux assertions du même test.
 */
import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../../contexts/AuthContext';

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnMount: false, refetchOnWindowFocus: false },
      /* `gcTime: Infinity` AUSSI sur les mutations : sinon react-query programme un minuteur de
         nettoyage (5 min par défaut) dès qu'une mutation se termine, et jest signale « a worker
         process has failed to exit gracefully » à la fin d'un test qui écrit. */
      mutations: { retry: false, gcTime: Infinity },
    },
  });
}

export function renderWithProviders(
  ui: ReactElement,
  { queryClient = makeTestQueryClient(), ...options }: RenderOptions & { queryClient?: QueryClient } = {},
) {
  /* `AuthProvider` est monté ici et pas au cas par cas : `useAppColors` en dépend, donc TOUT
     composant qui lit une couleur du thème le traverse — y compris quand il l'ignore complètement
     (une puce d'aide au fond d'une modale a suffi à faire échouer neuf tests). Le mettre au décor
     commun évite d'avoir à deviner, pour chaque test, s'il en aura besoin.
     Il est INTÉRIEUR au QueryClientProvider : il appelle `useQueryClient`. */
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

export * from '@testing-library/react-native';
