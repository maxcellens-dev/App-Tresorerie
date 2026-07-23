/**
 * Vérifie qu'un .aab / .apk est compatible avec les pages mémoire de 16 Ko (exigence Google Play
 * depuis le 01/11/2025 pour toute appli ciblant Android 15+).
 *
 * Pourquoi ce script : les outils officiels (zipalign, bundletool, APK Analyzer) exigent le SDK
 * Android / Java. Ici on ne dépend QUE de Node : on lit le ZIP à la main et on parse les en-têtes
 * ELF des .so. Ça permet de valider AVANT d'uploader sur Play, au lieu de découvrir le refus après.
 *
 * Deux contrôles, qui correspondent aux deux causes de refus :
 *   1. ALIGNEMENT ELF  — chaque segment PT_LOAD des .so doit avoir p_align >= 16384 (2**14).
 *   2. ALIGNEMENT ZIP  — les .so stockés NON compressés doivent démarrer à un offset multiple
 *                        de 16384 dans l'archive (équivalent de `zipalign -P 16`).
 *
 * Usage :
 *   node scripts/check-16kb.js chemin/vers/application.aab
 *   node scripts/check-16kb.js chemin/vers/application.apk
 */
const fs = require('fs');
const zlib = require('zlib');

const PAGE = 16384; // 16 Ko
const ELF_MAGIC = 0x464c457f; // 0x7F 'E' 'L' 'F' en little-endian
const PT_LOAD = 1;

/** Lit le catalogue du ZIP (central directory) et renvoie la liste des entrées .so natives. */
function listNativeLibs(buf) {
  // L'EOCD est en fin de fichier, précédé d'un commentaire de taille variable → on remonte.
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive illisible : signature de fin de ZIP introuvable.');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const cmtLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    // On ne garde que les bibliothèques natives : `lib/<abi>/x.so` (APK) ou `base/lib/...` (AAB).
    if (name.endsWith('.so') && /(^|\/)lib\//.test(name)) {
      // L'en-tête local redéclare ses propres longueurs : c'est lui qui donne le vrai offset des données.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataOff = localOff + 30 + lNameLen + lExtraLen;
      entries.push({ name, method, dataOff, compSize });
    }
    ptr += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

/** Renvoie l'alignement minimal des segments PT_LOAD d'un ELF 64 bits (null si non pertinent). */
function minLoadAlign(so) {
  if (so.length < 64 || so.readUInt32LE(0) !== ELF_MAGIC) return null;
  if (so[4] !== 2) return null; // 32 bits : hors périmètre (l'exigence ne vise que le 64 bits)

  const phoff = Number(so.readBigUInt64LE(0x20));
  const phentsize = so.readUInt16LE(0x36);
  const phnum = so.readUInt16LE(0x38);

  let min = null;
  for (let i = 0; i < phnum; i++) {
    const off = phoff + i * phentsize;
    if (off + 56 > so.length) break;
    if (so.readUInt32LE(off) !== PT_LOAD) continue;
    const align = Number(so.readBigUInt64LE(off + 0x30));
    if (min === null || align < min) min = align;
  }
  return min;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage : node scripts/check-16kb.js <fichier.aab|fichier.apk|URL EAS>');
    console.error("  L'URL est celle affichée par `eas build:list` (champ « Application Archive URL »).");
    process.exit(2);
  }

  // Accepte directement l'URL de l'artefact EAS : évite le téléchargement manuel avant vérification.
  let buf;
  if (/^https?:\/\//i.test(file)) {
    console.log(`Téléchargement de l'artefact…\n  ${file}`);
    const res = await fetch(file);
    if (!res.ok) {
      console.error(`Téléchargement impossible (HTTP ${res.status}).`);
      process.exit(2);
    }
    buf = Buffer.from(await res.arrayBuffer());
    console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} Mo reçus`);
  } else {
    if (!fs.existsSync(file)) {
      console.error(`Fichier introuvable : ${file}`);
      console.error("  Donne le chemin RÉEL du .aab, ou colle l'URL de l'artefact EAS.");
      process.exit(2);
    }
    buf = fs.readFileSync(file);
  }

  const libs = listNativeLibs(buf);

  if (libs.length === 0) {
    console.log('Aucune bibliothèque native (.so) trouvée → rien ne bloque le 16 Ko.');
    return;
  }

  const bad = [];
  const skipped = [];
  console.log(`\n${libs.length} bibliothèque(s) native(s) analysée(s) dans ${file}\n`);

  for (const e of libs) {
    let so;
    try {
      const raw = buf.subarray(e.dataOff, e.dataOff + e.compSize);
      so = e.method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch (err) {
      skipped.push(`${e.name} (décompression impossible : ${err.message})`);
      continue;
    }

    const align = minLoadAlign(so);
    // Une lib stockée non compressée doit en plus démarrer sur une frontière de 16 Ko (zipalign -P 16).
    const zipOk = e.method !== 0 || e.dataOff % PAGE === 0;

    if (align === null) {
      skipped.push(`${e.name} (non ELF 64 bits)`);
      continue;
    }

    const elfOk = align >= PAGE;
    const status = elfOk && zipOk ? 'OK  ' : 'KO  ';
    const detail = [
      `ELF 2**${Math.log2(align) || 0}`,
      e.method === 0 ? (zipOk ? 'zip aligné' : 'zip NON aligné') : 'compressé',
    ].join(', ');
    console.log(`  ${status} ${e.name}  [${detail}]`);

    if (!elfOk || !zipOk) bad.push({ ...e, align, elfOk, zipOk });
  }

  if (skipped.length) {
    console.log('\nIgnorées :');
    skipped.forEach((s) => console.log(`  - ${s}`));
  }

  console.log('');
  if (bad.length === 0) {
    console.log('RESULTAT : COMPATIBLE 16 Ko — l\'App Bundle peut être envoyé sur Google Play.\n');
    process.exit(0);
  }

  console.log(`RESULTAT : INCOMPATIBLE 16 Ko — ${bad.length} bibliothèque(s) à corriger :`);
  for (const b of bad) {
    const causes = [];
    if (!b.elfOk) causes.push(`segments ELF alignés sur ${b.align} au lieu de ${PAGE}`);
    if (!b.zipOk) causes.push('offset ZIP non aligné sur 16 Ko');
    console.log(`  - ${b.name} : ${causes.join(' ; ')}`);
  }
  console.log('\nCes .so viennent de dépendances tierces : il faut monter la version du paquet');
  console.log('npm correspondant (son mainteneur doit publier une version compilée en 16 Ko).\n');
  process.exit(1);
}

main().catch((err) => {
  console.error(`Erreur : ${err.message}`);
  process.exit(2);
});
