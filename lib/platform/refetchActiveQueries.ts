import type { QueryClient, RefetchQueryFilters } from '@tanstack/react-query';

/** Actualisations de lecture : focus, retour au premier plan et cache réhydraté. */
export function refetchActiveQueries(client: QueryClient, filters: RefetchQueryFilters) {
  // Le chargement financier peut déjà être attendu par plusieurs observateurs.
  // Le remplacer ferait rejeter leur promesse avec CancelledError et répéterait les lectures.
  return client.refetchQueries(filters, { cancelRefetch: false });
}
