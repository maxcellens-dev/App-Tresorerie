import { useCallback, useEffect, useRef, useState } from 'react';
import { type QueryClient, isCancelledError } from '@tanstack/react-query';

const SESSION_STARTED_AT = Date.now();

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
  sessionClient?: QueryClient,
) {
  const sessionKey = ['pilotage_validated_session', profileId];
  const validated = !!profileId && sessionClient?.getQueryData(sessionKey) === true;
  const queries = useRef({ primary, dependencies });
  queries.current = { primary, dependencies };
  const reporter = useRef(onFailure);
  reporter.current = onFailure;
  const failedVersions = useRef('');
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ profileId?: string; status: 'loading' | 'ready' | 'error'; error?: unknown }>({ profileId, status: validated ? 'ready' : 'loading' });
  const retry = useCallback(() => setGeneration(n => n + 1), []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseWait: (() => void) | undefined;
    if (validated && generation === 0) {
      setState({ profileId, status: 'ready' });
      return;
    }
    setState({ profileId, status: 'loading' });
    if (!profileId || offline) return;
    let primarySucceeded = false;
    const validationStartedAt = SESSION_STARTED_AT;
    void (async () => {
      for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
        let stage = 'pilotage';
        try {
          // Le calcul principal synchronise d'abord les échéances. Ne pas annuler une écriture en vol.
          if (!primarySucceeded) {
            const q = queries.current.primary;
            if (!(q.isSuccess && q.fetchStatus === 'idle' && (q.dataUpdatedAt ?? 0) >= SESSION_STARTED_AT && generation === 0)) {
              await q.refetch({ cancelRefetch: false, throwOnError: true });
            }
            primarySucceeded = true;
          }
          if (disposed) return;
          // Les autres vues de comptes/opérations doivent être lues APRÈS ces écritures.
          stage = 'dependencies';
          await Promise.all(queries.current.dependencies.map(q => q.isSuccess && q.fetchStatus === 'idle' && (q.dataUpdatedAt ?? 0) >= validationStartedAt
            ? Promise.resolve() : q.refetch({ cancelRefetch: true, throwOnError: true })));
          if (!disposed) {
            sessionClient?.setQueryDefaults(['pilotage_validated_session'], { gcTime: Infinity });
            sessionClient?.setQueryData(['pilotage_validated_session', profileId], true);
            setState({ profileId, status: 'ready' });
          }
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
  }, [profileId, offline, generation, sessionClient]);

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
  const ready = (validated || state.profileId === profileId && state.status === 'ready')
    && all.every(q => q.isSuccess || (q.dataUpdatedAt ?? 0) > 0);
  const error = state.profileId === profileId ? state.error ?? all.find(q => q.isError)?.error : undefined;
  return { ready, failed, retry, error, updating: all.some(q => q.fetchStatus === 'fetching') };
}
