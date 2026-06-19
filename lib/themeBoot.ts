/**
 * themeBoot — mémorisation locale (web) du thème à appliquer dès la PREMIÈRE frame, avant
 * toute réponse réseau, pour éliminer le flash sombre au rechargement / à la déconnexion.
 *
 * Pourquoi c'est nécessaire (et ce n'est pas un doublon du stockage serveur) :
 * le thème vit côté serveur (profil utilisateur OU app_config.landing pour l'admin), mais il
 * n'est lu qu'APRÈS un aller-retour réseau. Au tout premier rendu web, aucune de ces valeurs
 * n'est disponible → l'app retombe sur le défaut sombre puis bascule → flash. On garde donc le
 * dernier thème connu en localStorage et on le lit de façon SYNCHRONE.
 *
 * Deux contextes :
 *  - ADMIN  : thème global pré-connexion (vitrine, login, écran de démarrage).
 *  - USER   : thème choisi par l'utilisateur connecté (pages de l'app dans les onglets).
 *
 * Le boot-loader web (app/+html.tsx) et useAppColors/useBrandColors lisent ces valeurs.
 * À la déconnexion, on efface le thème USER (clearCachedUserTheme) → on retombe sur l'ADMIN.
 * Sur natif (pas de localStorage) → tout renvoie null : l'écran de démarrage natif gère le fond.
 */
export const ADMIN_THEME_KEY = 'relyka.admin.theme';
export const USER_THEME_KEY = 'relyka.user.theme';

export type ThemeModeStr = 'dark' | 'light';

function ls(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ── Thème admin (pré-connexion) ───────────────────────────────
export function getCachedAdminTheme(): ThemeModeStr | null {
  const v = ls()?.getItem(ADMIN_THEME_KEY);
  return v === 'light' || v === 'dark' ? v : null;
}

export function setCachedAdminTheme(mode: ThemeModeStr): void {
  try { ls()?.setItem(ADMIN_THEME_KEY, mode); } catch { /* quota / privé : sans gravité */ }
}

// ── Thème utilisateur (connecté) ──────────────────────────────
export function getCachedUserTheme(): { mode: ThemeModeStr; preset: string } | null {
  const raw = ls()?.getItem(USER_THEME_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o && (o.mode === 'light' || o.mode === 'dark')) {
      return { mode: o.mode, preset: typeof o.preset === 'string' ? o.preset : 'emerald' };
    }
  } catch { /* JSON corrompu : ignore */ }
  return null;
}

export function setCachedUserTheme(mode: ThemeModeStr, preset: string): void {
  try { ls()?.setItem(USER_THEME_KEY, JSON.stringify({ mode, preset })); } catch { /* sans gravité */ }
}

export function clearCachedUserTheme(): void {
  try { ls()?.removeItem(USER_THEME_KEY); } catch { /* sans gravité */ }
}
