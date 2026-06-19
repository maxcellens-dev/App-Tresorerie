/**
 * Historique de navigation « à plat » (liste des chemins visités).
 *
 * Pourquoi : les pages secondaires partagent une pile imbriquée qui s'accumule à travers
 * les changements d'onglet ; `router.back()` y dépile alors vers une page secondaire obsolète
 * au lieu de la page réellement précédente. On suit donc nous-mêmes le chemin pour un retour fiable.
 */
let stack: string[] = [];

/** Enregistre la route courante (chemin renvoyé par usePathname). Se comporte comme une PILE :
 *  revenir sur une route déjà présente la rétablit comme sommet (on tronque l'« avant »), au lieu
 *  d'empiler un doublon. Sans ça, un retour (router.back) réenregistre la page courante PAR-DESSUS
 *  la page d'où l'on revient → la « précédente » devenait à tort la page qu'on vient de quitter
 *  (ex. revenir sur un projet puis « Retour » renvoyait vers l'écran d'ajout de dépense). */
export function recordRoute(path: string | null | undefined): void {
  if (!path) return;
  if (stack[stack.length - 1] === path) return;
  const existing = stack.lastIndexOf(path);
  if (existing >= 0) {
    // Retour sur une route déjà visitée → on tronque tout ce qui suit (vraie sémantique de pile).
    stack.length = existing + 1;
    return;
  }
  stack.push(path);
  if (stack.length > 40) stack.shift();
}

/** Retire la route courante et renvoie la précédente (ou null s'il n'y en a pas). */
export function consumePreviousRoute(): string | null {
  if (stack.length < 2) return null;
  stack.pop();
  return stack[stack.length - 1] ?? null;
}
