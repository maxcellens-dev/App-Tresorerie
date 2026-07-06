/**
 * Incrémente le numéro de VERSION affiché de l'app (app.json → expo.version), patch +1.
 *   1.0.3 → 1.0.4 → 1.0.5 …
 *
 * À lancer AVANT `eas build` (le versionCode Android, lui, est auto-incrémenté par EAS via
 * `autoIncrement: true`). On NE touche PAS `runtimeVersion` (fixe pour que les OTA touchent tout le monde).
 *
 * Usage :
 *   node scripts/bump-version.js            → bump le patch (1.0.3 → 1.0.4)
 *   node scripts/bump-version.js minor      → bump le minor (1.0.3 → 1.1.0)
 *   node scripts/bump-version.js major      → bump le major (1.0.3 → 2.0.0)
 */
const fs = require('fs');
const path = require('path');

const APP_JSON = path.join(__dirname, '..', 'app.json');
const kind = (process.argv[2] || 'patch').toLowerCase();

const raw = fs.readFileSync(APP_JSON, 'utf8');
const json = JSON.parse(raw);
const current = String(json.expo?.version ?? '1.0.0');

const parts = current.split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);
let [major, minor, patch] = parts;

if (kind === 'major') { major += 1; minor = 0; patch = 0; }
else if (kind === 'minor') { minor += 1; patch = 0; }
else { patch += 1; }

const next = `${major}.${minor}.${patch}`;
json.expo.version = next;

// Réécrit en préservant l'indentation à 2 espaces + newline finale (comme le fichier d'origine).
fs.writeFileSync(APP_JSON, JSON.stringify(json, null, 2) + '\n', 'utf8');
console.log(`Version : ${current} → ${next}  (versionCode auto-incrémenté par EAS au build)`);
