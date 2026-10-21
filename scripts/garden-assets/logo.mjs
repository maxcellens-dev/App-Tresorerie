/**
 * Fichiers du logo Relyka à partir de la découpe assets/garden-cut/logo_v1.png :
 *   assets/logo.png              512, transparent      (logo DANS l'app : accueil, connexion, menu…)
 *   assets/icon.png              1024, fond crème      (icône iOS / store — natif : prochaine build)
 *   assets/adaptive-icon.png     1024, transparent     (avant-plan Android, dans la zone sûre 66 %)
 *   assets/notification-icon.png 96, silhouette blanche (Android exige une icône monochrome)
 *   public/favicon.png 256, public/icon-192.png 192     (web)
 * ⚠️ assets/splash-logo.png (écran de démarrage) n'est PAS touché ici : il doit rester identique à
 * l'image du splash NATIF déjà installée → on le remplace au moment d'une nouvelle build.
 *
 *   npm run logo
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'assets/garden-cut/logo_v1.png');
const CREAM = { r: 244, g: 239, b: 230, alpha: 1 };
const fit = (size, frac) => sharp(src).resize(Math.round(size * frac), Math.round(size * frac), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const canvas = (size, bg) => sharp({ create: { width: size, height: size, channels: 4, background: bg } });
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const out = async (file, size, frac, bg) => { await canvas(size, bg).composite([{ input: await fit(size, frac), gravity: 'center' }]).png().toFile(path.join(root, file)); console.log('✓', file); };
await out('assets/logo.png', 512, 0.92, transparent);
await out('assets/icon.png', 1024, 0.7, CREAM);
await out('assets/adaptive-icon.png', 1024, 0.58, transparent);
/* Favicon : le logo seul se perdait en 16-32 px (fond transparent, traits fins) → posé sur un ROND
   crème uni, coins transparents. */
{
  const S = 256;
  const disc = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="rgb(${CREAM.r},${CREAM.g},${CREAM.b})"/></svg>`);
  await sharp(disc).composite([{ input: await fit(S, 0.74), gravity: 'center' }]).png().toFile(path.join(root, 'public/favicon.png'));
  console.log('✓ public/favicon.png');
}
await out('public/icon-192.png', 192, 0.72, CREAM);
// notification : silhouette blanche pleine (l'alpha du logo, couleur blanche)
{
  const { data, info } = await sharp(await fit(96, 0.86)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = data[i + 3] > 110 ? 255 : 0; }
  const sil = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  await canvas(96, transparent).composite([{ input: sil, gravity: 'center' }]).png().toFile(path.join(root, 'assets/notification-icon.png'));
  console.log('✓ assets/notification-icon.png');
}
