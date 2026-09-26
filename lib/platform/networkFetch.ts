/** Bornes réseau communes. Aucun jeton, paramètre d'URL ou corps de requête dans les erreurs. */
export function createNetworkFetch(fetcher: typeof fetch, timeoutMs = 20_000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const source = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    if (source?.aborted) abort();
    source?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } catch (cause) {
      if (source?.aborted) throw cause;
      let resource = 'serveur';
      try {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        const parts = url.pathname.split('/').filter(Boolean);
        // Auth endpoint / REST table / RPC name only. Never include object paths or query strings.
        resource = parts[0] === 'rest' ? parts.slice(0, parts[2] === 'rpc' ? 4 : 3).join('/')
          : parts[0] === 'auth' ? parts.slice(0, 3).join('/') : parts[0] ?? resource;
      } catch { /* URL absente : diagnostic générique */ }
      const error = new Error(`${timedOut ? 'Network timeout' : 'Network request failed'} (${init?.method ?? 'GET'} ${resource}). Réessaie lorsque la connexion est disponible.`);
      error.name = timedOut ? 'NetworkTimeoutError' : 'NetworkRequestError';
      throw error;
    } finally {
      clearTimeout(timer);
      source?.removeEventListener('abort', abort);
    }
  };
}
