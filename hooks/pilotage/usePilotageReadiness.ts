import { useCallback, useEffect, useRef, useState } from 'react';
import { type QueryClient, isCancelledError } from '@tanstack/react-query';

const SESSION_STARTED_AT = Date.now();

type ReadableQuery = {
  isSuccess: boolean;
  isError: boolean;
  fetchStatus: string;
  error?: unknown;
  dataUpdatedAt?: number;
  /** false pour les données que la synchronisation ne modifie pas (réservations, profil…). */
  afterFinancialSync?: boolean;
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
    const primarySince = generation === 0 ? SESSION_STARTED_AT : Date.now();
    let primarySucceeded = false;
    /* Rejoint la lecture en vol, ou en lance une si la donnée n'a pas été lue depuis `since`.
       Rend l'instant de la donnée obtenue. Une invalidation qui REMPLACE la lecture (annulation)
       n'est pas un échec : on rejoint la suivante, sans relancer quoi que ce soit nous-mêmes. */
    const settle = async (q: ReadableQuery, since: number): Promise<number> => {
      if (q.isSuccess && q.fetchStatus === 'idle' && (q.dataUpdatedAt ?? 0) >= since) return q.dataUpdatedAt ?? 0;
      for (let cancelled = 0; ; cancelled++) {
        try {
          const r = await q.refetch({ cancelRefetch: false, throwOnError: true }) as { dataUpdatedAt?: number } | undefined;
          return r?.dataUpdatedAt || Date.now();
        } catch (error) {
          const e = error as { message?: string };
          if (disposed || cancelled >= 5 || !(isCancelledError(error) || e?.message === 'CancelledError')) throw error;
        }
      }
    };
    void (async () => {
      for (let attempt = 0; !disposed;) {
        let stage = 'pilotage';
        try {
          /* TOUT PART EN MÊME TEMPS. Les comptes, opérations et partages étaient relus APRÈS la
             synchronisation + le snapshot : trois allers-retours bout à bout sous le rond de
             chargement, alors que dans le cas courant la synchronisation n'écrit rien. On les lance
             maintenant ; si elle a écrit, fetchPilotageData les invalide (la lecture en vol est
             remplacée) et on relit ci-dessous celles qui dateraient d'avant ses écritures. */
          const deps = queries.current.dependencies;
          const early = deps.map(q => settle(q, SESSION_STARTED_AT));
          early.forEach(p => p.catch(() => {})); // observées même si le calcul principal échoue d'abord
          // Le calcul principal synchronise les échéances. Ne jamais annuler une écriture en vol.
          if (!primarySucceeded) {
            await settle(queries.current.primary, primarySince);
            primarySucceeded = true;
          }
          if (disposed) return;
          stage = 'dependencies';
          const readAt = await Promise.all(early);
          if (disposed) return;
          // Les vues de comptes/opérations lues AVANT des écritures de la synchronisation sont relues.
          const syncAt = sessionClient?.getQueryData<number>(['pilotage_sync_completed', profileId]) ?? 0;
          await Promise.all(deps.map((q, i) => q.afterFinancialSync !== false && readAt[i] < syncAt
            ? settle(q, Number.POSITIVE_INFINITY) : null));
          if (!disposed) {
            sessionClient?.setQueryDefaults(['pilotage_validated_session'], { gcTime: Infinity });
            sessionClient?.setQueryData(['pilotage_validated_session', profileId], true);
            setState({ profileId, status: 'ready' });
          }
          return;
        } catch (error) {
          if (disposed) return;
          const e = error as { code?: string; message?: string };
          if (isCancelledError(error) || e?.message === 'CancelledError') {
            // Une invalidation après écriture remplace la lecture, sans erreur réseau.
            // Rejoindre la nouvelle requête sans consommer les tentatives de récupération.
            primarySucceeded = false;
            await Promise.resolve();
            continue;
          }
          const transient = ['40P01', '40001', '57014'].includes(e?.code ?? '')
            || /network|failed to fetch|fetch failed|timeout|offline|load failed/i.test(e?.message ?? '');
          if (transient && attempt < 2) {
            attempt++;
            await new Promise<void>(resolve => {
              releaseWait = resolve;
              timer = setTimeout(resolve, 750 * attempt);
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
