import type { QueryClient } from '@tanstack/react-query';

/** Regroupe les événements reçus pendant une lecture, sans annuler ses consommateurs. */
export function createRealtimeQueryRefresh(client: QueryClient) {
  const queued = new Set<string>();
  let disposed = false;
  return {
    refresh(keys: string[]) {
      for (const key of keys) {
        if (disposed || queued.has(key)) continue;
        queued.add(key);
        const running = client.getQueryCache().findAll({ queryKey: [key] })
          .filter(query => query.state.fetchStatus === 'fetching').map(query => query.promise);
        void Promise.allSettled(running).then(async () => {
          queued.delete(key);
          if (disposed) return;
          // Une lecture entamée avant l'événement ne suffit pas : relire APRÈS sa fin.
          await client.invalidateQueries({ queryKey: [key] }, { cancelRefetch: false });
        });
      }
    },
    dispose() { disposed = true; queued.clear(); },
  };
}
