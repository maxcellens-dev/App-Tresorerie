import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isCancelledError } from '@tanstack/react-query';

type ReadableQuery = {
  isSuccess: boolean;
  isError: boolean;
  fetchStatus: string;
  error?: unknown;
  dataUpdatedAt?: number;
  refetch: (options?: { cancelRefetch?: boolean; throwOnError?: boolean }) => Promise<unknown>;
};

/** Le cache peut nourrir les hooks, mais aucun montant n'est rendu avant sa revalidation. */
export function usePilotageReadiness(
  profileId: string | undefined,
  offline: boolean,
  primary: ReadableQuery,
  dependencies: ReadableQuery[],
  onFailure?: (error: unknown, stage: string) => void,
) {
  const queries = useRef({ primary, dependencies });
  queries.current = { primary, dependencies };
  const reporter = useRef(onFailure);
  reporter.current = onFailure;
  const failedVersions = useRef('');
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ profileId?: string; status: 'loading' | 'ready' | 'error'; error?: unknown }>({ status: 'loading' });
  const retry = useCallback(() => setGeneration(n => n + 1), []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') retry();
      else setState({ status: 'loading' });
    });
    return () => sub.remove();
  }, [retry]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseWait: (() => void) | undefined;
    setState({ profileId, status: 'loading' });
    if (!profileId || offline) return;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
        let stage = 'pilotage';
        try {
          // Le calcul principal synchronise d'abord les échéances. Ne pas annuler une écriture en vol.
          await queries.current.primary.refetch({ cancelRefetch: false, throwOnError: true });
          if (disposed) return;
          // Les autres vues de comptes/opérations doivent être lues APRÈS ces écritures.
          stage = 'dependencies';
          await Promise.all(queries.current.dependencies.map(q => q.refetch({ cancelRefetch: true, throwOnError: true })));
          if (!disposed) setState({ profileId, status: 'ready' });
          return;
        } catch (error) {
          if (disposed) return;
          const e = error as { code?: string; message?: string };
          const transient = isCancelledError(error) || ['40P01', '40001', '57014'].includes(e?.code ?? '')
            || /network|failed to fetch|fetch failed|timeout|offline|load failed/i.test(e?.message ?? '');
          if (transient && attempt < 2) {
            await new Promise<void>(resolve => {
              releaseWait = resolve;
              timer = setTimeout(resolve, 750 * (attempt + 1));
            });
            continue;
          }
          failedVersions.current = [queries.current.primary, ...queries.current.dependencies].map(q => q.dataUpdatedAt ?? 0).join(':');
          setState({ profileId, status: 'error', error });
          reporter.current?.(error, stage);
          return;
        }
      }
    })();
    return () => { disposed = true; clearTimeout(timer); releaseWait?.(); };
  }, [profileId, offline, generation]);

  const all = [primary, ...dependencies];
  const allSucceeded = all.every(q => q.isSuccess && q.fetchStatus === 'idle');
  const versions = all.map(q => q.dataUpdatedAt ?? 0).join(':');
  // A successful reconnect/focus refetch must restart validation, not leave a sticky error.
  useEffect(() => {
    if (!offline && state.profileId === profileId && state.status === 'error'
      && allSucceeded && versions !== failedVersions.current) retry();
  }, [offline, profileId, state, allSucceeded, versions, retry]);
  const failed = state.profileId === profileId && state.status === 'error'
    || state.profileId === profileId && state.status === 'ready' && all.some(q => q.isError && q.fetchStatus !== 'fetching');
  const ready = !offline && state.profileId === profileId && state.status === 'ready'
    && all.every(q => q.isSuccess && q.fetchStatus === 'idle');
  const error = state.profileId === profileId ? state.error ?? all.find(q => q.isError)?.error : undefined;
  return { ready, failed, retry, error };
}
