/**
 * GARDE — un libellé posé sur la couleur d'accent ne doit jamais être peint avec le fond de l'app.
 *
 * La couleur d'accent est choisie librement dans Apparence (couleur personnalisée des abonnés,
 * couleurs du pack définies par l'administration) : rien ne garantit qu'elle soit sombre. Peindre le
 * texte d'un bouton avec `bg` marchait tant que le thème sombre était le seul usage réel — en thème
 * clair, le fond est un crème très pâle, et un accent clair (jaune, lime, cyan) donnait un libellé
 * illisible sur TOUS les boutons de l'application. `onAccent` choisit, entre le fond et l'encre,
 * celle qui se lit vraiment.
 *
 * Ce test relit le code source plutôt que le rendu : c'est la seule façon d'empêcher la régression
 * de revenir fichier par fichier, un copier-coller à la fois.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const DIRS = ['app', 'components'];
const ACCENT_BG = /backgroundColor:\s*(?:c|COLORS)\.(?:emerald|accent|primary)\b/;
/* Deux façons de se tromper, et il faut surveiller les DEUX : peindre le texte avec le fond de
   l'app (`c.bg`) — invisible en thème clair — ou le peindre en blanc figé — invisible dès que la
   couleur d'accent est claire. La première passe de ce chantier n'avait attrapé que `c.bg`, et
   dix-neuf boutons en blanc dur étaient passés au travers. */
const BG_TEXT = /color:\s*(?:(?:c|COLORS)\.bg\b|'#(?:fff|ffffff|FFF|FFFFFF)')/;

/** Retire les suffixes de rôle : `saveBtnText` et `saveBtn` désignent le même bouton. */
const norm = (n: string) => n.replace(/(Text|Label|Txt|Tx|Btn|Button|Primary|Disabled)/g, '').toLowerCase();

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
      if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out;
}

describe('lisibilité sur la couleur d’accent', () => {
  it('aucun texte de bouton d’accent n’est peint avec le fond de l’app ni en blanc figé', () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (!ACCENT_BG.test(src) || !BG_TEXT.test(src)) continue;

      const accentNames = new Set<string>();
      const bgTextNames: string[] = [];
      const re = /^\s{2,}(\w+):\s*\{([\s\S]*?)\},?\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (ACCENT_BG.test(m[2])) accentNames.add(norm(m[1]));
        if (BG_TEXT.test(m[2])) bgTextNames.push(m[1]);
      }
      for (const name of bgTextNames) {
        if (accentNames.has(norm(name))) {
          offenders.push(`${path.relative(ROOT, f).replace(/\\/g, '/')} → ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
