#!/usr/bin/env node
/**
 * LE BUNDLE PUBLIÉ CONTIENT-IL DE QUOI JOINDRE LE BACKEND ?
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * À lancer APRÈS `eas update` : la commande laisse derrière elle, dans `dist/`, exactement ce qui
 * vient d'être téléversé. On y cherche l'URL Supabase et la clé anonyme de production.
 *
 * ── POURQUOI CE CONTRÔLE EXISTE (4 septembre 2026) ─────────────────────────────────────────────
 * Une OTA est partie sans `EXPO_PUBLIC_SUPABASE_URL` ni `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Le client
 * Supabase vaut `null` sans elles : l'app s'ouvrait sur un écran noir (le thème vient de la base) et
 * toute tentative de connexion répondait « Backend non configuré ». Autrement dit : une application
 * parfaitement inutilisable, publiée pour 100 % des installations, sans qu'aucun contrôle ne
 * bronche — `eas update` avait réussi, les tests passaient, le contrôle de session était au vert.
 *
 * La cause : `eas update --environment production` résout les variables depuis l'ENVIRONNEMENT EAS
 * (côté serveur) et cesse alors de lire le `.env` local. Cet environnement ne contenait que
 * `JITPACK_TOKEN`. Les variables y ont été ajoutées depuis — mais une configuration qui peut
 * disparaître d'un côté sans que rien ne le signale mérite un contrôle, pas une consigne.
 *
 * Ce script ne suppose rien du chemin emprunté : il regarde le RÉSULTAT.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', '_expo', 'static', 'js');

/** Valeurs de PRODUCTION attendues — la même source que le contrôle de session (eas.json). */
function expectedValues() {
  const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
  const env = (eas.build && eas.build.production && eas.build.production.env) || {};
  return [
    ['EXPO_PUBLIC_SUPABASE_URL', env.EXPO_PUBLIC_SUPABASE_URL],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', env.EXPO_PUBLIC_SUPABASE_ANON_KEY],
  ];
}

/* Hermes range les chaînes en UTF-8 ou en UTF-16 selon leur contenu : on cherche les deux, sinon un
   bundle parfaitement valide passerait pour vide. */
function bundleContains(buf, value) {
  return buf.includes(Buffer.from(value, 'utf8')) || buf.includes(Buffer.from(value, 'utf16le'));
}

function bundlesFor(platform) {
  const dir = path.join(DIST, platform);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.hbc') || n.endsWith('.js'))
    .map((n) => path.join(dir, n));
}

const expected = expectedValues();
const missingConfig = expected.filter(([, v]) => !v).map(([n]) => n);
if (missingConfig.length) {
  console.error(`\n✖ eas.json ne définit pas ${missingConfig.join(', ')} pour le profil production.`);
  process.exit(1);
}

if (!fs.existsSync(DIST)) {
  console.error('\n✖ Aucun `dist/` à vérifier : lance ce script juste après `eas update` (il y laisse le bundle publié).');
  process.exit(1);
}

let ok = true;
const lines = [];
for (const platform of ['android', 'ios']) {
  const files = bundlesFor(platform);
  if (files.length === 0) { lines.push(`  ${platform.padEnd(8)} aucun bundle exporté`); continue; }
  for (const [name, value] of expected) {
    // Une seule plateforme suffit à trancher, mais on les regarde toutes : un export partiel est
    // exactement le genre de détail qu'on ne voit pas passer.
    const found = files.some((f) => bundleContains(fs.readFileSync(f), value));
    if (!found) ok = false;
    lines.push(`  ${platform.padEnd(8)} ${name.padEnd(30)} ${found ? '✔' : '✖ ABSENTE'}`);
  }
}

console.log('\nBundle publié — configuration du backend\n');
console.log(lines.join('\n'));

if (ok) {
  console.log('\n✔ L\'app publiée sait joindre son backend.\n');
  process.exit(0);
}

console.error(`
✖ LE BUNDLE PUBLIÉ NE SAIT PAS JOINDRE LE BACKEND.

  Tel quel, il ouvre un écran noir et répond « Backend non configuré » à toute connexion —
  pour toutes les installations, dès leur prochaine ouverture.

  À FAIRE MAINTENANT, dans cet ordre :
   1. rétablir la version précédente :
        npx eas update:list --branch production --limit 3
        npx eas update:republish --group <ID du groupe précédent> --message "Retour version precedente"
   2. vérifier l'environnement EAS visé par la publication :
        npx eas env:list --environment production
      Il doit contenir EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY. Sinon :
        npx eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "…" --visibility plaintext
   3. republier, puis relancer ce contrôle.
`);
process.exit(1);
