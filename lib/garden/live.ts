/**
 * `live(() => valeur)` : un objet (ou tableau) RECALCULÉ à chaque lecture. Sert aux constantes de
 * module qui dépendent des couleurs du Jardin (GARDEN_COLORS change avec le thème) : figées au
 * chargement, elles gardaient les couleurs du mode clair en mode sombre.
 */
export function live<T extends object>(make: () => T): T {
  return new Proxy({} as T, {
    get: (_t, k) => { const v = make() as any; const x = v[k]; return typeof x === 'function' ? x.bind(v) : x; },
    has: (_t, k) => k in (make() as any),
    ownKeys: () => Reflect.ownKeys(make() as any),
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Reflect.getOwnPropertyDescriptor(make() as any, k);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}
