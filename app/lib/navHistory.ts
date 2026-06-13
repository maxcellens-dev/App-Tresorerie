/**
 * Historique de navigation « à plat » (liste des chemins visités).
 *
 * Pourquoi : les pages secondaires partagent une pile imbriquée qui s'accumule à travers
 * les changements d'onglet ; `router.back()` y dépile alors vers une page secondaire obsolète
 * au lieu de la page réellement précédente. On suit donc nous-mêmes le chemin pour un retour fiable.
 */
let stack: string[] = [];

/** Enregistre la route courante (chemin renvoyé par usePathname). Ignore les doublons consécutifs. */
export function recordRoute(path: string | null | undefined): void {
  if (!path) return;
  if (stack[stack.length - 1] === path) return;
  stack.push(path);
  if (stack.length > 40) stack.shift();
}

/** Retire la route courante et renvoie la précédente (ou null s'il n'y en a pas). */
export function consumePreviousRoute(): string | null {
  if (stack.length < 2) return null;
  stack.pop();
  return stack[stack.length - 1] ?? null;
}
