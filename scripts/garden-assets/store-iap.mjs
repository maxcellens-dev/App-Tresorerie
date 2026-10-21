/**
 * Icônes des produits Play Console (packs de noisettes), SANS texte (règle Google : ni texte, ni
 * promotion, ni branding sur l'icône d'un produit) : la quantité se lit au nombre de noisettes.
 *   100 → 1 noisette · 500 → un petit tas (3) · 1000 → un gros tas (6)
 * Sortie : store-assets/play-iap/nuts_<n>.png — 1024 × 1024, PNG 32 bits (fond crème, pour le store) ;
 *         assets/garden-cut/pile_<n>.png — le même tas SANS fond, recadré (pour l'app : boutique, succès).
 *
 *   npm run store-iap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'store-assets/play-iap');
fs.mkdirSync(outDir, { recursive: true });
const nut = path.join(root, 'assets/garden-cut/currency_nut.png');
const S = 1024;

/* Placement de chaque noisette : [x du centre, bas, largeur, rotation°] — du fond vers l'avant. */
const PILES = {
  100: [[512, 830, 640, 0]],
  500: [[350, 700, 420, -14], [680, 690, 420, 12], [512, 860, 470, 0]],
  1000: [[300, 560, 330, -18], [520, 530, 330, 6], [740, 560, 330, 16], [380, 740, 370, -8], [650, 745, 370, 10], [512, 900, 400, 0]],
};

const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><defs>
<radialGradient id="g" cx="0.5" cy="0.42" r="0.7"><stop offset="0" stop-color="#FFF8EC"/><stop offset="1" stop-color="#EADCC4"/></radialGradient>
<radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#5A3A1E" stop-opacity="0.32"/><stop offset="1" stop-color="#5A3A1E" stop-opacity="0"/></radialGradient></defs>
<rect width="${S}" height="${S}" fill="url(#g)"/><ellipse cx="512" cy="900" rx="380" ry="62" fill="url(#sh)"/></svg>`);

for (const [n, pile] of Object.entries(PILES)) {
  const layers = [];
  for (const [cx, bottom, w, rot] of pile) {
    const img = await sharp(nut).resize({ width: w }).rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const m = await sharp(img).metadata();
    layers.push({ input: img, left: Math.round(cx - m.width / 2), top: Math.round(bottom - m.height) });
  }
  const file = path.join(outDir, `nuts_${n}.png`);
  await sharp(bg).composite(layers).ensureAlpha().png().toFile(file);
  // version transparente pour l'app (sans le fond ni l'ombre du store), recadrée au plus juste
  await sharp({ create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer()
    .then((b) => sharp(b).trim({ threshold: 0 }).png().toFile(path.join(root, `assets/garden-cut/pile_${n}.png`)));
  console.log('✓', path.relative(root, file));
}
