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

/** Route courante (sommet de pile) — utile hors React (ex. remontée d'erreur globale). */
export function getCurrentRoute(): string | null {
  return stack[stack.length - 1] ?? null;
}

/** Retire la route courante et renvoie la précédente (ou null s'il n'y en a pas). */
export function consumePreviousRoute(): string | null {
  if (stack.length < 2) return null;
  stack.pop();
  return stack[stack.length - 1] ?? null;
}

/**
 * Repart de zéro sur `path`. À utiliser quand on REMONTE d'un cran faute d'historique (cf.
 * useNavBack) : sans ça, la page qu'on vient de quitter deviendrait la « précédente » de sa propre
 * page parente — et « Retour » y redescendrait aussitôt, en boucle.
 */
export function resetRouteTo(path: string): void {
  stack = [path];
}

/**
 * Segments qui ne sont QUE des dossiers de rangement, sans page à eux : on les saute en remontant.
 * Ex. /comptes/edit/42 → /comptes (et non /comptes/edit, qui n'existe pas).
 */
const PASSTHROUGH_SEGMENTS = new Set(['edit', 'credit']);

/**
 * Chemin parent réellement navigable, ou null si on est déjà à la racine.
 * Sert de repli à « Retour » quand l'historique est vide (ouverture directe par URL, rechargement
 * de la page web, arrivée sur la page juste après la connexion) : remonter d'un cran vaut mieux que
 * de renvoyer sur le tableau de bord. Vérifié : dans cette app, toute route à plusieurs segments a
 * un parent qui est lui-même une route — aux dossiers ci-dessus près.
 */
export function parentRoute(path: string | null | undefined): string | null {
  const parts = (path ?? '').split('/').filter(Boolean);
  parts.pop();
  while (parts.length > 0 && PASSTHROUGH_SEGMENTS.has(parts[parts.length - 1])) parts.pop();
  return parts.length > 0 ? '/' + parts.join('/') : null;
}

/**
 * Filtre une destination reçue en PARAMÈTRE D'URL (`?origin=…`) : on ne renvoie que des chemins
 * internes, jamais une adresse extérieure.
 *
 * Plusieurs écrans acceptent une destination de retour fournie par l'appelant. Sur le web, ce
 * paramètre est dans l'URL, donc modifiable par n'importe qui : un lien
 * `…/apparence?origin=https://exemple.test` (ou `//exemple.test`, que les navigateurs traitent
 * comme une adresse externe) envoyait l'utilisateur hors de l'app au clic sur « Retour » — une
 * page de connexion imitée n'aurait plus qu'à se présenter. On n'accepte donc qu'un chemin
 * commençant par un seul `/`, sans schéma ni saut de ligne.
 */
export function safeInternalRoute(value: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (/[\r\n\t]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  return path;
}
