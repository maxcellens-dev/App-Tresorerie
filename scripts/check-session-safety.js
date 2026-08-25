/**
 * GARDE-FOU DE PUBLICATION — « est-ce que cette mise à jour va déconnecter tout le monde ? »
 *
 * À lancer AVANT chaque `eas update` (OTA) et AVANT chaque `eas build`. Il ne teste pas l'app : il
 * vérifie les quelques réglages qui, s'ils changent sans qu'on y prenne garde, font perdre leur
 * session à TOUS les utilisateurs installés — un incident qui ne se voit qu'après la publication,
 * quand les gens se plaignent de devoir se reconnecter.
 *
 * Ce qui déconnecte tout le monde, et que ce script surveille :
 *   1. l'URL du projet Supabase — la clé de stockage de la session en est dérivée
 *      (`sb-<ref>-auth-token`) : en changer, c'est chercher la session au mauvais endroit ;
 *   2. `storageKey` posé à la main dans le client — même effet, en une ligne ;
 *   3. `persistSession` / `autoRefreshToken` désactivés — la session ne survit plus à la fermeture ;
 *   4. le stockage natif : perdre la lecture des formats HÉRITÉS, ou réintroduire un effacement
 *      avant écriture, casse la session des installations existantes (cf. lib/platform/secureStorage) ;
 *   5. un `AsyncStorage.clear()` égaré — il emporte la session avec le reste ;
 *   6. le rechargement OTA piloté depuis le JS, qui coupait l'app en plein démarrage ;
 *   7. `runtimeVersion` : le bumper est une décision de BUILD. Publier un OTA après l'avoir bumpé
 *      n'atteint plus personne (et donne l'illusion d'une publication réussie).
 *
 * Usage :
 *   node scripts/check-session-safety.js ota      → avant `eas update`
 *   node scripts/check-session-safety.js build    → avant `eas build`
 *   node scripts/check-session-safety.js --accept → enregistre l'état courant comme nouvelle
 *                                                   référence (à ne faire QU'en connaissance de cause)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REF_FILE = path.join(__dirname, 'release-invariants.json');
const mode = (process.argv[2] || '').replace(/^--/, '').toLowerCase();

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const problems = [];
const warnings = [];
const fail = (title, why) => problems.push({ title, why });
const warn = (title, why) => warnings.push({ title, why });

// ── Ce que l'état courant dit ────────────────────────────────────────────────────────────────
const appJson = readJson('app.json');
const easJson = readJson('eas.json');
const supabaseSrc = read('lib/platform/supabase.ts');
const storageSrc = read('lib/platform/secureStorage.ts');
const otaSrc = read('lib/platform/otaUpdate.ts');

const runtimeVersion = typeof appJson.expo?.runtimeVersion === 'string' ? appJson.expo.runtimeVersion : null;
const profiles = Object.entries(easJson.build || {});
const urls = profiles.map(([name, p]) => [name, p?.env?.EXPO_PUBLIC_SUPABASE_URL || null]);
const prodUrl = (easJson.build?.production?.env?.EXPO_PUBLIC_SUPABASE_URL) || null;

// ── 1. Projet Supabase : la clé de session en dépend ─────────────────────────────────────────
if (!prodUrl) {
  fail('EXPO_PUBLIC_SUPABASE_URL absente du profil production',
    'Sans elle, le client Supabase n\'est pas créé : personne ne peut se connecter.');
}
for (const [name, url] of urls) {
  if (url && prodUrl && url !== prodUrl && name === 'preview') {
    warn(`Profil « ${name} » sur un autre projet Supabase`,
      'Normal si c\'est voulu (bac à sable) — mais une build preview ne partagera pas les sessions.');
  }
}

// ── 2 & 3. Client Supabase : persistance de session ──────────────────────────────────────────
if (/\bstorageKey\s*:/.test(supabaseSrc)) {
  fail('`storageKey` posé à la main dans lib/platform/supabase.ts',
    'La clé par défaut est dérivée de l\'URL du projet. En fixer une autre déplace la session : toutes '
    + 'les installations existantes chercheront la leur à un emplacement vide → déconnexion générale.');
}
if (!/persistSession\s*:\s*true/.test(supabaseSrc)) {
  fail('`persistSession: true` introuvable dans lib/platform/supabase.ts',
    'Sans persistance, la session ne survit pas à la fermeture de l\'app : reconnexion à chaque ouverture.');
}
if (!/autoRefreshToken\s*:\s*true/.test(supabaseSrc)) {
  fail('`autoRefreshToken: true` introuvable dans lib/platform/supabase.ts',
    'Sans rafraîchissement, le jeton expire (≈1 h) et la session tombe en pleine utilisation.');
}
if (!/SecureSessionStore/.test(supabaseSrc)) {
  fail('Le stockage de session natif n\'est plus branché (SecureSessionStore)',
    'Changer de stockage sans passerelle de lecture vers l\'ancien = sessions existantes introuvables.');
}

// ── 4. Stockage natif : lecture des formats hérités + écriture non destructive ────────────────
const heritage = [
  ['.__i', 'format courant (index de génération)'],
  ['.__n', 'format chiffré historique'],
];
for (const [marker, label] of heritage) {
  if (!storageSrc.includes(marker)) {
    fail(`lib/platform/secureStorage.ts ne lit plus le ${label} (« ${marker} »)`,
      'Les installations existantes stockent leur session dans CE format. Ne plus savoir le lire les '
      + 'déconnecte toutes à la mise à jour.');
  }
}
if (!/AsyncStorage\.getItem\(key\)/.test(storageSrc)) {
  fail('lib/platform/secureStorage.ts ne relit plus la copie AsyncStorage',
    'C\'est le repli des builds sans coffre natif (OTA vers une ancienne build) ET la copie héritée '
    + 'd\'avant le chiffrement. Sans elle : déconnexion.');
}
// L'écriture doit basculer sur une nouvelle génération, jamais effacer avant d'écrire.
if (/await\s+clearChunked\(key\);?\s*\n\s*if\s*\(value/.test(storageSrc)) {
  fail('lib/platform/secureStorage.ts efface la session AVANT de la réécrire',
    'Toute interruption dans cette fenêtre (app tuée, OTA appliquée au lancement, crash) laisse un jeu '
    + 'de morceaux incomplet → session illisible au redémarrage. L\'écriture doit passer par une '
    + 'nouvelle génération et ne basculer l\'index qu\'à la fin.');
}
if (!/POINT DE BASCULE/.test(storageSrc)) {
  warn('Le commentaire « POINT DE BASCULE » a disparu de secureStorage.ts',
    'Il marque l\'écriture atomique de l\'index. Vérifie que l\'écriture reste non destructive.');
}

// ── 5. Purges de stockage égarées ────────────────────────────────────────────────────────────
const SCAN_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'services'];
const offenders = [];
function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (/AsyncStorage\s*\.\s*clear\s*\(/.test(src)) offenders.push(path.relative(ROOT, full));
  }
}
for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
for (const f of offenders) {
  fail(`AsyncStorage.clear() dans ${f}`,
    'Une purge globale emporte la session (et le thème, et le cache) de tout le monde. Supprime des '
    + 'clés nommées, jamais tout le stockage.');
}

// ── 6. Rechargement OTA piloté depuis le JS ──────────────────────────────────────────────────
if (!/OTA_UPDATE_ON_LAUNCH_ENABLED\s*=\s*false/.test(otaSrc)) {
  fail('Le rechargement OTA depuis le JS a été réactivé',
    'Un `reloadAsync()` en parallèle du téléchargement natif ferme l\'app en plein démarrage — et peut '
    + 'l\'interrompre pendant l\'écriture de la session. Le natif s\'en charge (app.json → updates).');
}

// ── 7. runtimeVersion : OTA ou nouvelle build ? ──────────────────────────────────────────────
let ref = null;
try { ref = JSON.parse(fs.readFileSync(REF_FILE, 'utf8')); } catch { ref = null; }

if (ref) {
  if (prodUrl && ref.supabaseUrl && prodUrl !== ref.supabaseUrl) {
    fail('Le projet Supabase a changé depuis la dernière publication',
      `Référence : ${ref.supabaseUrl}\n     Maintenant : ${prodUrl}\n     La clé de session est dérivée de `
      + 'cette URL : publier en l\'état déconnecte 100 % des installations. Si c\'est volontaire, '
      + 'ré-enregistre la référence avec `--accept` et préviens les utilisateurs.');
  }
  if (runtimeVersion && ref.runtimeVersion && runtimeVersion !== ref.runtimeVersion) {
    if (mode === 'ota') {
      fail(`runtimeVersion modifiée (${ref.runtimeVersion} → ${runtimeVersion}) : cet OTA n'atteindra personne`,
        'Une update OTA n\'est servie qu\'aux installations dont le runtime est IDENTIQUE. Soit tu remets '
        + `« ${ref.runtimeVersion} » (si le natif n'a pas changé), soit c'est une nouvelle BUILD qu'il faut publier.`);
    } else {
      warn(`runtimeVersion : ${ref.runtimeVersion} → ${runtimeVersion}`,
        'Nouvelle build obligatoire : les installations existantes ne recevront plus d\'OTA tant qu\'elles '
        + 'n\'auront pas installé ce binaire. À ne faire que si le natif a réellement changé.');
    }
  }
} else if (mode !== 'accept') {
  warn('Aucune référence enregistrée (scripts/release-invariants.json)',
    'Lance `node scripts/check-session-safety.js --accept` pour figer l\'état courant.');
}

// ── Enregistrement volontaire d'une nouvelle référence ───────────────────────────────────────
if (mode === 'accept') {
  const next = { supabaseUrl: prodUrl, runtimeVersion, acceptedAt: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(REF_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log('Référence enregistrée :', JSON.stringify(next));
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────
const label = mode === 'ota' ? 'OTA' : mode === 'build' ? 'BUILD' : 'publication';
console.log(`\nSession — contrôle avant ${label}\n`);
for (const w of warnings) console.log(`  ⚠  ${w.title}\n     ${w.why}\n`);
for (const p of problems) console.log(`  ✖  ${p.title}\n     ${p.why}\n`);

if (problems.length) {
  console.log(`✖ ${problems.length} point(s) bloquant(s) : publier en l'état peut déconnecter les utilisateurs.\n`);
  process.exit(1);
}
console.log(`✔ Rien qui déconnecte les utilisateurs${warnings.length ? ` (${warnings.length} avertissement(s) à lire)` : ''}.\n`);
