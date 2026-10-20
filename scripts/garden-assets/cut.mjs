/**
 * Détourage des images brutes du Jardin : assets/garden-raw/*.jpg|png → assets/garden-cut/*.png (fond transparent).
 *
 *   cd scripts/garden-assets && npm install   (une fois)
 *   npm run cut                               (toutes les images)
 *   npm run cut -- tree_adult.jpg can_full.jpg
 *
 * 1. Modèle de détourage ISNet (local, @imgly/background-removal-node) : gère les zones enfermées
 *    (anse, verres de lunettes) et retire l'ombre portée au sol.
 * 2. Objets sans aucune couleur proche du fond (arbre, plateau) : on retire en plus les pixels proches
 *    du fond et les gris clairs sans couleur — les trous entre les feuilles que le modèle laisse.
 * 3. Décontamination des bords : C = (I − (1−a)·Fond) / a, sinon un liseré gris reste autour.
 */
import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.resolve(here, '../../assets/garden-raw');
const outDir = path.resolve(here, '../../assets/garden-cut');
fs.mkdirSync(outDir, { recursive: true });

/** Images de référence ou abandonnées : jamais détourées. */
const SKIP = /^(Gemini_Generated_Image|plate_)|_v\d+\./;
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(rawDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !SKIP.test(f));

/** Familles pour lesquelles l'étape 2 est sûre (aucune couleur de l'objet n'approche le fond gris).
 *  Exclus volontairement : verre (arrosoir, lanterne), eau (mare), blanc (fleurs blanches, champignons, Pépin). */
const COLOR_KEY = /^(tree|roots|plate|decor_(bench|fence|birdhouse)|ladder|basket|brambles|leaf_autumn|flower_(summer|autumn))/;

/** Position de chaque découpe dans son image d'origine (pour réaligner des images générées dans le même cadre). */
const offsetsFile = path.join(outDir, 'offsets.json');
const offsets = fs.existsSync(offsetsFile) ? JSON.parse(fs.readFileSync(offsetsFile, 'utf8')) : {};

for (const name of names) {
  const src = path.join(rawDir, name);
  const { data: rgb, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  // couleur du fond = moyenne des quatre coins
  const bg = [0, 0, 0];
  for (const [cx, cy] of [[4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5]]) for (let c = 0; c < 3; c++) bg[c] += rgb[(cy * W + cx) * 3 + c] / 4;

  const png = await sharp(src).png().toBuffer();
  const blob = await removeBackground(new Blob([png], { type: 'image/png' }), { model: 'medium', output: { format: 'image/png', quality: 1 } });
  const { data: rgba } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (COLOR_KEY.test(name)) {
    for (let p = 0; p < W * H; p++) {
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      const greyish = Math.max(r, g, b) - Math.min(r, g, b) < 22 && (r + g + b) / 3 > 165;
      const k = greyish ? 0 : Math.max(0, Math.min(1, (dist - 12) / 26));
      rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3] * k);
      // voiles très transparents laissés par le modèle (feuilles « fantômes » autour de l'objet)
      if (rgba[p * 4 + 3] < 64) rgba[p * 4 + 3] = 0;
    }
  }
  // ronces : l'IA les a posées sur une planchette en bois → on retire tout ce qui a la couleur du bois
  // (brun chaud ; les tiges sont violettes et les feuilles vertes, jamais confondues)
  if (/^brambles\./.test(name)) for (let p = 0; p < W * H; p++) {
    const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
    if (r > g + 8 && g > b + 8 && r - b > 35 && g > 60) rgba[p * 4 + 3] = 0;
    // dans la moitié basse (la planche et ses arêtes claires), on ne garde que feuilles, tiges et épines
    const leaf = g > r + 8, stem = r > g + 15 && b > g - 5;
    if (p / W > H * 0.5 && !leaf && !stem) rgba[p * 4 + 3] = 0;
  }
  // fleurs : les feuilles à l'ombre sortent en voile semi-transparent (pâle sur fond clair) → tout ou rien
  if (/^flower_/.test(name)) for (let p = 0; p < W * H; p++) rgba[p * 4 + 3] = rgba[p * 4 + 3] < 150 ? 0 : 255;

  for (let p = 0; p < W * H; p++) {
    const a = rgba[p * 4 + 3] / 255;
    if (a <= 0.02) { rgba[p * 4 + 3] = 0; continue; }
    if (a >= 0.98) continue;
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.max(0, Math.min(255, Math.round((rgb[p * 3 + c] - (1 - a) * bg[c]) / a)));
  }

  const base = path.basename(name, path.extname(name));
  const out = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).trim({ threshold: 0 }).png().toFile(path.join(outDir, `${base}.png`));
  offsets[base] = { x: -(out.trimOffsetLeft ?? 0), y: -(out.trimOffsetTop ?? 0), w: out.width, h: out.height, srcW: W, srcH: H };
  console.log(`✓ ${base}.png  (fond ${bg.map(Math.round).join(',')})`);
}
fs.writeFileSync(offsetsFile, JSON.stringify(offsets, null, 1));
