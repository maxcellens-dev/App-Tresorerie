import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { MAX_W, PAGE_VARIANTS, GUTTER, contentWidth, pageColumn, formColumn } from '../lib/ui/webLayout';

/**
 * VERROU SUR LA LARGEUR DE PAGE (bureau).
 *
 * Il y avait trois colonnes selon la « nature » de la page — 1180 pour le Pilotage, 1000 pour les
 * listes, 820 pour les réglages. En naviguant, l'app se recadrait toute seule à chaque écran.
 * Elles sont désormais égales : ces tests empêchent qu'elles redivergent, et que quelqu'un
 * recopie une colonne à la main plutôt que d'appeler le helper.
 *
 * ⚠️ Rien de tout ça ne concerne le MOBILE : chaque helper rend `null` quand `isDesktop` est faux.
 */

describe('MAX_W — une seule largeur de page', () => {
  it('toutes les variantes de PAGE valent la même chose', () => {
    const widths = PAGE_VARIANTS.map((v) => `${v}:${MAX_W[v]}`);
    expect(new Set(PAGE_VARIANTS.map((v) => MAX_W[v])).size).toBe(1);
    expect(widths).toEqual(PAGE_VARIANTS.map((v) => `${v}:${MAX_W.dashboard}`));
  });

  /* Ce qui n'est pas une page qu'on parcourt reste plus étroit : la largeur y est dictée par le
     contenu (un champ, une ligne de texte), pas par la fenêtre. */
  it('formulaires, prose, auth et dialogues restent plus étroits', () => {
    for (const v of ['form', 'reading', 'auth', 'dialog'] as const) {
      expect(`${v}<page`).toBe(MAX_W[v] < MAX_W.dashboard ? `${v}<page` : `${v}:${MAX_W[v]}`);
    }
  });
});

describe('les helpers de colonne ne touchent JAMAIS le mobile', () => {
  it.each([
    ['contentWidth', () => contentWidth(false)],
    ['pageColumn', () => pageColumn(false)],
    ['formColumn', () => formColumn(false)],
  ])('%s rend null hors bureau', (_name, fn) => {
    expect(fn()).toBeNull();
  });

  it('en bureau, page et liste rendent exactement la même colonne', () => {
    expect(pageColumn(true, 'list')).toEqual(pageColumn(true, 'dashboard'));
    expect(pageColumn(true, 'settings')).toEqual(pageColumn(true, 'dashboard'));
    expect(contentWidth(true, 'list')?.maxWidth).toBe(MAX_W.dashboard);
  });
});

/**
 * Personne ne recopie la colonne à la main.
 *
 * La liste des transactions portait sa propre `safeDesktop` — `maxWidth: 1000` figé — qui n'a pas
 * suivi l'alignement des pages : elle était plus étroite que le Pilotage, sans raison, et rien ne
 * le signalait. Une largeur de page ne se réécrit pas dans un `StyleSheet` d'écran.
 */
describe('aucune colonne de page recopiée dans un écran', () => {
  const ROOT = process.cwd();
  const files: { path: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      // Chemin RELATIF à la racine du dépôt : c'est lui qu'on affiche en cas d'échec, et il doit
      // pouvoir se coller dans un éditeur.
      else if (entry.endsWith('.tsx')) {
        files.push({ path: full.slice(ROOT.length + 1).replace(/\\/g, '/'), body: readFileSync(full, 'utf8') });
      }
    }
  };
  for (const d of ['app', 'components']) walk(join(ROOT, d));

  /* Les valeurs de PAGE écrites en dur. On ne cherche pas `maxWidth` en général (cartes, modales et
     dialogues en ont légitimement) mais les largeurs de COLONNE DE PAGE, qui n'appartiennent qu'à
     `webLayout`. La page d'accueil marketing (LandingPage) a sa propre grille, hors app. */
  const FORBIDDEN = /maxWidth:\s*(820|1000|1180)\b/;
  const ALLOWED = ['components/marketing/LandingPage.tsx'];

  it('trouve bien les fichiers à inspecter', () => {
    // Sans ce garde-fou, un chemin cassé rendrait le test ci-dessous vert pour de mauvaises raisons.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.path === 'app/(tabs)/transactions/index.tsx')).toBe(true);
  });

  it('aucun écran ne fige 820 / 1000 / 1180 dans ses styles', () => {
    const offenders = files
      .filter((f) => FORBIDDEN.test(f.body) && !ALLOWED.includes(f.path))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
