/**
 * UN SEUL ENDROIT PAR RÈGLE — garde structurelle.
 *
 * Presque tous les défauts coûteux de ce dépôt viennent d'une seule et même cause : deux endroits
 * qui décident de la même chose, avec des règles qui divergent en silence. Deux moteurs de profil
 * qui écrivaient `profile_id`. Trois façons de reconnaître une régularisation. Deux mesures du
 * matelas de sécurité. Un seuil réglable en administration et un autre codé en dur.
 *
 * Aucun de ces cas n'échouait : ils produisaient DEUX CHIFFRES JUSTES pour la même réalité, sur
 * deux écrans, et il fallait qu'un utilisateur les compare pour s'en apercevoir. Aucun test unitaire
 * ne peut attraper ça — chaque calcul, isolé, est correct.
 *
 * Ce fichier teste donc le DÉPÔT lui-même. C'est inhabituel, et c'est assumé : la seule façon
 * d'empêcher une classe d'erreur qui vit ENTRE les fichiers est de regarder les fichiers ensemble.
 * Un échec ici n'est pas forcément un bug — c'est une question : « es-tu sûr de vouloir un second
 * endroit qui décide de ça ? »
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { computeProfileFromData } from '../lib/finance/financialProfileEngine';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'build', '__tests__', 'supabase', 'admin']);

function sourceFiles(dir = ROOT, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

/** Fichiers applicatifs (hors tests, hors migrations), avec leur contenu. */
const FILES = sourceFiles().map((path) => ({
  path: path.slice(ROOT.length + 1).replace(/\\/g, '/'),
  body: readFileSync(path, 'utf8'),
}));

/** Fichiers dont le contenu contient le motif, hors ceux explicitement autorisés. */
function filesMatching(pattern: RegExp, allowed: string[]): string[] {
  return FILES
    .filter((f) => pattern.test(f.body))
    .map((f) => f.path)
    .filter((p) => !allowed.includes(p))
    .sort();
}

describe('une seule source de vérité par règle', () => {
  /* LE PROFIL. Deux moteurs écrivaient `profile_id` avec des règles différentes : le palier obtenu
     dépendait de qui avait écrit en dernier. Un seul fichier a le droit d'écrire ce champ. */
  it('un SEUL fichier écrit le profil financier', () => {
    const writers = FILES
      .filter((f) => /'user_financial_profile'/.test(f.body)
        && /\.(update|upsert|insert)\s*\(/.test(f.body))
      .map((f) => f.path)
      .filter((p) => p !== 'hooks/pilotage/useFinancialProfile.ts')
      .sort();
    expect(writers).toEqual([]);
  });

  /* LA RÉGULARISATION. Elle a été reconnue tour à tour à sa note, à l'absence de catégorie, puis à
     `regul_target` — chaque calcul avec sa version. Une régularisation ancienne était comptée comme
     un vrai revenu ici, et exclue là. `isRegul` est la définition ; tout le reste la réutilise. */
  it('personne ne redéfinit « est-ce une régularisation ? »', () => {
    /* Une redéfinition LOCALE est une fonction dont le corps refait le test — typiquement une regex
       sur la note. Un simple alias vers `isRegul` est légitime : il ne crée pas de seconde règle. */
    const rogue = FILES
      .filter((f) => /(const|function)\s+isRegul\w*\s*=?\s*(\(|:)[^=]*=>[\s\S]{0,120}?(r\[ée\]gul|régul|regul)/i.test(f.body))
      .map((f) => f.path)
      .filter((p) => p !== 'lib/finance/regul.ts')
      .sort();
    expect(rogue).toEqual([]);
  });

  /* LE MATELAS DE SÉCURITÉ. Il se mesure en mois de DÉPENSES essentielles couvertes. Il s'est
     mesuré en mois de revenus, et les deux ont coexisté — deux écrans annonçaient « 7 mois » et
     « 4 mois » pour la même personne. */
  it('le matelas ne se calcule qu’avec computeSecurityCushion', () => {
    // Une division de l'épargne par un revenu ou des dépenses, faite à la main, est suspecte.
    const rogue = filesMatching(
      /(availableSavings|savingsBalance|current_savings)\s*\/\s*(avgMonthlyIncome|monthly)/,
      ['lib/finance/securityCushion.ts'],
    );
    expect(rogue).toEqual([]);
  });

  /* LA DATE DU JOUR. `toISOString().slice(0,10)` convertit en UTC : après 22 h en France, il rend
     la VEILLE. Les opérations du jour disparaissaient des filtres « aujourd'hui ». */
  it('« aujourd’hui » se lit en heure locale, jamais en UTC', () => {
    const rogue = FILES
      .filter((f) => /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(f.body))
      .map((f) => f.path)
      // Nom de fichier d'export et aperçu d'administration : aucun calcul n'en dépend.
      .filter((p) => !p.startsWith('app/(tabs)/(secondary)/mes-donnees'))
      .sort();
    expect(rogue).toEqual([]);
  });

  /* LES SEUILS DE PROFIL. L'administration proposait de les régler pendant que le moteur les
     portait en dur : on croyait calibrer, rien ne bougeait. Ils vivent dans
     `DEFAULT_PROFILE_THRESHOLDS` (repli) et dans `profile_matrix_config` (source réelle). */
  /* LES SEUILS SONT DANS LA CONFIGURATION, PAS DANS LE CODE. On lit le corps compilé de la fonction
     de classement : plus aucune comparaison à un nombre littéral ne doit y figurer, sinon un seuil
     est redevenu inatteignable depuis l'administration — le défaut exact qu'on vient de corriger. */
  it('le classement ne compare jamais à un seuil écrit en dur', () => {
    const body = computeProfileFromData.toString();
    expect(body).not.toMatch(/months\s*>=?\s*\d/);
    expect(body).not.toMatch(/wealth\s*>=?\s*\d/);
    expect(body).not.toMatch(/rate\s*>=?\s*\d/);
  });
});
