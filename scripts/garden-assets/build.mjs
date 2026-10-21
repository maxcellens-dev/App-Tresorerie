/**
 * Fabrique les images du Jardin 3D utilisées par l'app, à partir des découpes (assets/garden-cut) :
 *   → assets/garden3d/*.webp        (images allégées)
 *   → lib/garden/scene3dAssets.ts   (manifeste GÉNÉRÉ : tailles, ancrages, require)
 *
 *   npm run cut && npm run build
 *
 * Toutes les variantes sont DÉRIVÉES ici, jamais redemandées à l'IA (sinon elles ne s'alignent pas) :
 *   - plateau : la terre de chaque niveau de racines + la plaque d'herbe recolorée par saison ;
 *   - arbre : 3 images sources × 4 saisons (feuillage recoloré, fleurs au printemps, neige en hiver),
 *     + l'adulte « sans branche » quand il n'y a pas de cabane ;
 *   - pommes mûre / jeune / dorée par recoloration, paniers garnis ;
 *   - arrosoir : vide + calque d'eau (le niveau est coupé à l'affichage) ;
 *   - Pépin : humeurs alignées sur un même cadre, accessoires en calques (seule la zone qui change).
 *
 * Repère de la scène (« cadre ») : l'image plateau d'origine, 928 × 1152 ; les ancrages du manifeste
 * sont en fractions de chaque image, les positions dans la scène sont fixées par le composant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { load, blank, clone, resize, over } from './raster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const cutDir = path.join(root, 'assets/garden-cut');
const outDir = path.join(root, 'assets/garden3d');
const manifestFile = path.join(root, 'lib/garden/scene3dAssets.ts');
/* ⚠️ NE PAS vider le dossier : supprimer assets/garden3d entier pendant que le serveur de dev tourne
   lui fait perdre la trace des fichiers (Windows) — il ne les « voit » plus, même recréés, et l'app
   ne charge plus (« Unable to resolve module …webp », erreur 500). On réécrit les fichiers en place
   et on ne retire, à la fin, que ceux qui ne sont plus produits. */
fs.mkdirSync(outDir, { recursive: true });

const OFF = JSON.parse(fs.readFileSync(path.join(cutDir, 'offsets.json'), 'utf8'));
const cut = (n) => load(path.join(cutDir, `${n}.png`));
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
let seed = 20261020;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ── Sortie ───────────────────────────────────────────────────────────────────────────────────── */
const files = [];
/** Écrit une image en WebP, réduite si son plus grand côté dépasse `max`. Renvoie ses dimensions finales. */
async function emit(name, im, max) {
  let out = im;
  const k = Math.min(1, max / Math.max(im.w, im.h));
  if (k < 1) out = await resize(im, Math.round(im.w * k), Math.round(im.h * k));
  const buf = await sharp(Buffer.from(out.data.buffer), { raw: { width: out.w, height: out.h, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 90, effort: 5 }).toBuffer();
  // n'écrit que si l'image a changé (le serveur de dev et git ne voient que les vrais changements)
  const file = path.join(outDir, `${name}.webp`);
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(buf)) fs.writeFileSync(file, buf);
  files.push(name);
  return { w: out.w, h: out.h };
}

/* ── Outils d'analyse ─────────────────────────────────────────────────────────────────────────── */
const A = (im, x, y) => im.data[(y * im.w + x) * 4 + 3];
const isLeaf = (d, i) => d[i + 3] > 0 && d[i + 1] > d[i] + 6 && d[i + 1] > d[i + 2] + 6;
const lum = (d, i) => (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Pied : abscisse moyenne des pixels opaques de la dernière ligne pleine (fraction de largeur). */
function foot(im) {
  for (let y = im.h - 1; y > 0; y--) { let s = 0, c = 0; for (let x = 0; x < im.w; x++) if (A(im, x, y) > 200) { s += x; c++; } if (c > 12) return s / c / im.w; }
  return 0.5;
}
/** Boîte du feuillage (pixels de feuille), en fractions. */
function canopyBox(im) {
  let x0 = im.w, y0 = im.h, x1 = 0, y1 = 0;
  for (let y = 0; y < im.h; y++) {
    let c = 0; for (let x = 0; x < im.w; x++) if (isLeaf(im.data, (y * im.w + x) * 4)) c++;
    if (c > im.w * 0.04) { if (y < y0) y0 = y; y1 = y; }
  }
  for (let y = y0; y <= y1; y++) for (let x = 0; x < im.w; x++) if (isLeaf(im.data, (y * im.w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { x0: round3(x0 / im.w), y0: round3(y0 / im.h), x1: round3(x1 / im.w), y1: round3(y1 / im.h) };
}
/** Bout de la branche droite (pixel opaque le plus à droite entre 55 % et 85 % de la hauteur). */
function branchTip(im) {
  let tx = 0, ty = 0;
  for (let y = Math.round(im.h * 0.55); y < im.h * 0.85; y++) for (let x = im.w - 1; x > tx; x--) if (A(im, x, y) > 200) { tx = x; ty = y; break; }
  return { x: round3(tx / im.w), y: round3(ty / im.h) };
}
/** Demi-largeur du tronc à une hauteur donnée (fraction), autour du pied. */
function trunkHalf(im, fy) {
  const y = Math.round(im.h * fy), cx = Math.round(foot(im) * im.w);
  let l = cx, r = cx; while (l > 0 && A(im, l - 1, y) > 128) l--; while (r < im.w - 1 && A(im, r + 1, y) > 128) r++;
  return (r - l) / 2 / im.w;
}

/* ── Couleurs ─────────────────────────────────────────────────────────────────────────────────── */
const lerpRamp = (ramp, t) => {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const k = Math.min(ramp.length - 2, Math.floor(t)), u = t - k;
  return ramp[k].map((v, c) => v + (ramp[k + 1][c] - v) * u);
};
const AUTUMN = [[96, 40, 14], [190, 92, 28], [236, 160, 52], [255, 212, 110]];

/** Feuillage selon la saison : seuls les pixels de feuille changent (jamais de feuilles mortes). */
async function seasonTree(src, season, blossom) {
  const im = clone(src), d = im.data;
  if (season === 'summer') return im;
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4; if (!isLeaf(d, i)) continue;
    const l = lum(d, i), r = d[i], g = d[i + 1], b = d[i + 2];
    if (season === 'spring') { d[i] = r * 1.04 + 14; d[i + 1] = g * 1.06 + 12; d[i + 2] = b * 0.9; }
    else if (season === 'autumn') d.set(lerpRamp(AUTUMN, l * 1.35), i);
    else { // hiver : neige sur les feuilles éclairées, surtout en haut ; le reste reste vert
      const top = Math.max(0, 1 - (y / im.h) * 1.4), w = Math.max(0, Math.min(1, (l - 0.42) / 0.18)) * Math.min(1, 0.35 + top);
      d[i] = r + (246 - r) * w; d[i + 1] = g + (249 - g) * w; d[i + 2] = b + (255 - b) * w;
    }
  }
  if (season === 'spring' && blossom) {
    // fleurs de pommier posées sur des feuilles éclairées du houppier
    const box = canopyBox(src), n = Math.round(14 + 40 * (box.x1 - box.x0) * (src.w / 700));
    const size = Math.max(10, Math.round(src.w * 0.045));
    const fl = await resize(blossom, size, Math.round(size * blossom.h / blossom.w));
    for (let k = 0, tries = 0; k < n && tries < n * 40; tries++) {
      const x = Math.round((box.x0 + rnd() * (box.x1 - box.x0)) * im.w), y = Math.round((box.y0 + rnd() * (box.y1 - box.y0)) * im.h);
      const i = (y * im.w + x) * 4; if (!isLeaf(src.data, i) || lum(src.data, i) < 0.38) continue;
      over(im, fl, x - fl.w / 2, y - fl.h / 2); k++;
    }
  }
  return im;
}

/** Retire la branche droite de l'adulte (écorce à droite du tronc, sous le feuillage) : arbre sans cabane. */
function removeBranch(src) {
  const im = clone(src), d = im.data, cx = foot(src) * im.w, half = trunkHalf(src, 0.9) * im.w;
  const box = canopyBox(src);
  for (let y = Math.round(im.h * 0.5); y < im.h * 0.86; y++) {
    // le tronc s'affine vers le haut : on garde une marge proportionnelle
    const edge = cx + half * (0.75 + 0.25 * (y / im.h)) + 3;
    for (let x = Math.ceil(edge); x < im.w; x++) {
      const i = (y * im.w + x) * 4;
      if (isLeaf(d, i) && y < box.y1 * im.h + 4) continue;
      d[i + 3] = 0;
    }
  }
  return im;
}

/* ── Plateau ──────────────────────────────────────────────────────────────────────────────────── */
const isGreen = (d, i) => d[i + 3] > 0 && d[i + 1] > d[i] - 4 && d[i + 1] > d[i + 2] + 25;
/** Masque de la plaque d'herbe (haut du plateau), dilaté de `grow` px. */
function slabMask(im, grow = 0) {
  const m = new Uint8Array(im.w * im.h);
  for (let y = 0; y < Math.min(im.h, 175); y++) for (let x = 0; x < im.w; x++) if (isGreen(im.data, (y * im.w + x) * 4)) m[y * im.w + x] = 1;
  for (let g = 0; g < grow; g++) {
    const n = m.slice();
    for (let y = 1; y < im.h - 1; y++) for (let x = 1; x < im.w - 1; x++) if (!m[y * im.w + x] && (m[y * im.w + x - 1] || m[y * im.w + x + 1] || m[(y - 1) * im.w + x] || m[(y + 1) * im.w + x])) n[y * im.w + x] = 1;
    m.set(n);
  }
  return m;
}
/** roots_r0 : roots_r1 dont le petit germe est recouvert par la terre voisine (fondu sur les bords). */
function eraseGerm(r1) {
  const im = clone(r1), d = im.data, cx = Math.round(im.w / 2), x0 = cx - 70, x1 = cx + 70, y0 = 140, y1 = 230, shift = 170;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const fx = Math.min(x - x0, x1 - x, 20) / 20, fy = Math.min(y - y0, y1 - y, 16) / 16, a = Math.min(fx, fy);
    const i = (y * im.w + x) * 4, j = (y * im.w + x - shift) * 4;
    if (isGreen(d, i)) continue;
    for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - a) + r1.data[j + c] * a;
  }
  return im;
}
/** Profondeur réelle des racines (y dans le cadre) : dernière ligne, au-dessus des galets, qui compte
 *  nettement plus de pixels « couleur racine » (beige clair) que la même ligne du niveau 0. Les images
 *  diffèrent un peu partout (régénérations successives) : on compare des comptes, pas des pixels. */
const GRAVEL_TOP = 410; // ligne (dans la découpe) où commencent les galets
function rootTip(im, ref, oy) {
  // bande centrale : là où descend la racine principale, la plus longue
  const pale = (d, i) => d[i] > 150 && d[i + 1] > 122 && d[i + 2] > 88 && d[i] - d[i + 2] < 80 && d[i] - d[i + 2] > 25;
  const count = (src, y) => { let c = 0; for (let x = Math.round(src.w * 0.38); x < src.w * 0.62; x++) if (pale(src.data, (y * src.w + x) * 4)) c++; return c; };
  let tip = 150;
  for (let y = 151; y < GRAVEL_TOP; y++) {
    // lissé sur 5 lignes : une racine traverse plusieurs lignes, un caillou isolé non
    let ex = 0; for (let k = -2; k <= 2; k++) ex += count(im, y + k) - count(ref, y + k);
    if (ex / 5 >= 4) tip = y;
  }
  return tip + oy;
}

const M = { frame: { w: 928, h: 1152 } };

// niveaux de racines
const r1 = await cut('roots_r1');
const r0 = eraseGerm(r1);
const slabSrc = r0, slabM = slabMask(slabSrc, 2);
const levels = [['r0', r0], ...await Promise.all(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'aquifer'].map(async (k) => [k, await cut(`roots_${k}`)]))];
M.soil = {};
for (const [k, im] of levels) {
  const o = OFF[`roots_${k === 'r0' ? 'r1' : k}`];
  const soil = clone(im), m = slabMask(im, 1);
  for (let p = 0; p < soil.w * soil.h; p++) if (m[p]) soil.data[p * 4 + 3] = 0;
  const dim = await emit(`soil_${k}`, soil, 1000);
  // référence = r1 (un simple germe) : les cailloux clairs, communs aux deux images, s'annulent
  M.soil[k] = { x: o.x, y: o.y, w: im.w, h: im.h, px: dim, tipY: k === 'r0' ? o.y + 150 : k === 'r1' ? o.y + 185 : rootTip(im, r1, o.y) };
}
/* Repères 1 / 3 / 6 mois = pointes réelles des niveaux r2, r4, r6 : la racine touche toujours le trait
   qu'elle est censée atteindre. */
M.marks = { one: M.soil.r2.tipY, three: M.soil.r4.tipY, six: M.soil.r6.tipY };

// plaque d'herbe par saison
{
  const o = OFF.roots_r1;
  let y1 = 0; for (let p = 0; p < slabM.length; p++) if (slabM[p]) y1 = Math.max(y1, Math.floor(p / slabSrc.w));
  const base = blank(slabSrc.w, y1 + 1);
  for (let y = 0; y <= y1; y++) for (let x = 0; x < slabSrc.w; x++) if (slabM[y * slabSrc.w + x]) base.data.set(slabSrc.data.subarray((y * slabSrc.w + x) * 4, (y * slabSrc.w + x) * 4 + 4), (y * base.w + x) * 4);
  let sum = 0, n = 0; for (let i = 0; i < base.data.length; i += 4) if (isGreen(base.data, i)) { sum += lum(base.data, i); n++; }
  const mean = sum / n;
  const TINT = { spring: [176, 214, 120], autumn: [206, 156, 86] };
  const leaf = await cut('leaf_autumn');
  M.slab = { x: o.x, y: o.y, w: base.w, h: base.h };
  for (const s of SEASONS) {
    const im = clone(base), d = im.data;
    if (s !== 'summer') for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const l = lum(d, i) / mean;
      if (s === 'winter') { const k = Math.pow(l, 1.6), g = (rnd() - 0.5) * 10; d[i] = 236 * k + g; d[i + 1] = 242 * k + g; d[i + 2] = 250 * k + g; }
      else { const t = TINT[s]; d[i] = t[0] * l; d[i + 1] = t[1] * l; d[i + 2] = t[2] * l; }
    }
    if (s === 'autumn') for (let k = 0; k < 14; k++) {
      // feuilles mortes posées à plat sur le dessus (écrasées en hauteur : perspective)
      const lw = Math.round(26 + rnd() * 14), lf = await resize(leaf, lw, Math.round(lw * leaf.h / leaf.w * 0.45));
      const x = 60 + rnd() * (im.w - 160), y = 18 + rnd() * 95;
      over(im, lf, x, y);
    }
    M.slab[s] = await emit(`slab_${s}`, im, 1000);
  }
}

/* ── Arbre ────────────────────────────────────────────────────────────────────────────────────── */
const blossom = await cut('blossom');
M.tree = {};
const treeSrc = { sprout: await cut('tree_sprout'), young: await cut('tree_young'), adult: await cut('tree_adult') };
treeSrc.adultBare = removeBranch(treeSrc.adult);
for (const [kind, src] of Object.entries(treeSrc)) {
  const entry = { w: src.w, h: src.h, foot: round3(foot(src)), canopy: canopyBox(src), trunkHalf: round3(trunkHalf(src, 0.9)) };
  if (kind === 'adult') entry.branchTip = branchTip(src);
  for (const s of SEASONS) entry[s] = await emit(`tree_${kind}_${s}`, await seasonTree(src, s, kind === 'sprout' ? null : blossom), kind === 'sprout' ? 420 : 860);
  M.tree[kind] = entry;
}

/* ── Pommes et paniers ────────────────────────────────────────────────────────────────────────── */
const APPLE = {
  young: [[70, 96, 20], [150, 176, 52], [214, 226, 120], [250, 250, 210]],
  gold: [[110, 70, 8], [206, 150, 30], [250, 214, 90], [255, 248, 210]],
};
const appleSrc = await cut('apple');
const apples = {};
for (const kind of ['ripe', 'young', 'gold']) {
  const im = clone(appleSrc), d = im.data;
  if (kind !== 'ripe') for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0 || !(d[i] > d[i + 1] + 30)) continue;
    d.set(lerpRamp(APPLE[kind], (0.45 * d[i] + 0.45 * d[i + 1] + 0.1 * d[i + 2]) / 255 * 1.25), i);
  }
  apples[kind] = im;
}
M.apple = { w: appleSrc.w, h: appleSrc.h };
for (const k of Object.keys(apples)) M.apple[k] = await emit(`apple_${k}`, apples[k], 110);

const basket = await cut('basket');
M.basket = { w: basket.w, h: basket.h };
/* Bourrelet AVANT de l'osier (haut du bord tressé, en fraction de hauteur) : 0,52 sur les côtés,
   0,60 au milieu. Les pommes sont posées dans l'ouverture et tout ce qui passe sous cette courbe est
   caché — elles sont DANS le panier, pas posées sur son bord. */
const frontRim = (fx) => 0.525 + 0.075 * Math.max(0, 1 - ((fx - 0.5) / 0.47) ** 2);
for (const n of [3, 5]) for (const kind of ['ripe', 'young']) {
  const im = clone(basket), aw = Math.round(basket.w * 0.25), a = await resize(apples[kind], aw, Math.round(aw * appleSrc.h / appleSrc.w));
  // tas de pommes : rang du fond plus haut, rang de devant plus bas (centres en fractions du panier)
  const spots = n === 3 ? [[0.36, 0.49], [0.64, 0.49], [0.5, 0.53]] : [[0.3, 0.47], [0.5, 0.44], [0.7, 0.47], [0.4, 0.53], [0.6, 0.53]];
  const layer = blank(im.w, im.h);
  for (const [fx, fy] of spots) over(layer, a, basket.w * fx - a.w / 2, basket.h * fy - a.h * 0.55);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) if (y > frontRim(x / im.w) * im.h) layer.data[(y * im.w + x) * 4 + 3] = 0;
  // ombre douce des pommes sur l'osier du fond, puis les pommes
  over(im, layer, 0, 0);
  M.basket[`${kind}${n}`] = await emit(`basket_${kind}_${n}`, im, 220);
}

/* ── Touffes d'herbe (dessinées ici) : posées devant le pied des fleurs, champignons, ronces… pour
   qu'ils sortent de l'herbe au lieu d'être posés dessus. Couleurs accordées à la plaque de chaque saison. */
const TUFT = {
  summer: [[70, 108, 34], [132, 166, 60], [200, 222, 128]],
  spring: [[80, 128, 40], [146, 188, 72], [212, 234, 146]],
  autumn: [[112, 86, 34], [170, 132, 58], [224, 190, 112]],
  winter: [[62, 98, 48], [114, 146, 86], [236, 242, 246]],
};
async function tuft(season, variant) {
  const Wt = 200, Ht = 110, [dark, mid, tip] = TUFT[season], rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;
  let s2 = 7 + variant * 31; const r = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  let blades = '', defsG = '';
  const n = 52 + variant * 8;
  // brins du fond (sombres) d'abord, ceux de devant (clairs) ensuite ; touffe dense, plus large que haute
  for (let k = 0; k < n; k++) {
    const depth = k / n, off = (r() - 0.5) * 0.78, bx = Wt * (0.5 + off), bw = 6 + r() * 5;
    const hh = Ht * (0.3 + r() * 0.48) * (1 - Math.abs(off) * 0.75), lean = off * 80 + (r() - 0.5) * 30;
    const tx = bx + lean, ty = Ht - 8 - hh, cx = bx + lean * 0.35, cy = Ht - 8 - hh * 0.55;
    const base = dark.map((v, c) => v + (mid[c] - v) * depth), top = mid.map((v, c) => v + (tip[c] - v) * (0.55 + depth * 0.45));
    defsG += `<linearGradient id="g${k}" gradientUnits="userSpaceOnUse" x1="0" y1="${Ht - 8}" x2="0" y2="${ty}"><stop offset="0" stop-color="${rgb(base)}"/><stop offset="1" stop-color="${rgb(top)}"/></linearGradient>`;
    blades += `<path d="M${bx - bw / 2} ${Ht - 6}Q${cx - bw * 0.3} ${cy} ${tx} ${ty}Q${cx + bw * 0.3} ${cy} ${bx + bw / 2} ${Ht - 6}Z" fill="url(#g${k})"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wt}" height="${Ht}"><defs>${defsG}<radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#1E2A10" stop-opacity="0.35"/><stop offset="1" stop-color="#1E2A10" stop-opacity="0"/></radialGradient></defs><ellipse cx="${Wt / 2}" cy="${Ht - 8}" rx="${Wt * 0.36}" ry="9" fill="url(#sh)"/>${blades}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data) };
}
M.tuft = { w: 200, h: 110, variants: 3, foot: 0.93 };
for (const s of SEASONS) for (let v = 0; v < 3; v++) await emit(`tuft_${s}_${v}`, await tuft(s, v), 200);

/* ── Arrosoir : vide + calque d'eau ────────────────────────────────────────────────────────────────
   Arrosoir en métal avec une FENÊTRE en verre (can_full / can_empty, générés dans le même cadre).
   Cadre commun = celui du vide ; le plein y est recalé par les positions d'origine des découpes.
   - fenêtre = la zone SOMBRE de l'arrosoir vide (l'intérieur vu à travers le verre), ligne par ligne
     autour de l'axe du corps ;
   - calque d'eau = l'arrosoir plein, limité à l'INTÉRIEUR de la fenêtre (les petites différences de
     patine du métal entre les deux images ne se voient donc jamais) ;
   - l'eau de l'image pleine (de sa surface au fond) est ÉTIRÉE sur toute la hauteur de la fenêtre :
     niveau 1 = fenêtre pleine jusqu'en haut, niveau 0 = vide (le niveau se lit sur toute la fenêtre). */
{
  const empty = await cut('can_empty'), fullSrc = await cut('can_full');
  const oe = OFF.can_empty, of = OFF.can_full;
  const full = over(blank(empty.w, empty.h), fullSrc, of.x - oe.x, of.y - oe.y);
  const W = empty.w, H = empty.h, px = (im, x, y) => (y * W + x) * 4;
  const lumAt = (im, x, y) => { const i = px(im, x, y); return 0.3 * im.data[i] + 0.59 * im.data[i + 1] + 0.11 * im.data[i + 2]; };
  // axe du corps : milieu des pixels opaques de la ligne du bas, côté gauche du bec
  const cx = Math.round(foot(empty) * W);
  // intérieur vu à travers le verre : sombre, ou bleuté (les gouttes au fond de l'arrosoir vide)
  const dark = (x, y) => { const i = px(empty, x, y), d = empty.data; return d[i + 3] > 200 && (lumAt(empty, x, y) < 95 || d[i + 2] > d[i] + 35); };
  // fenêtre : lignes où l'axe est sombre ; sur chaque ligne, la bande sombre continue autour de l'axe
  const span = new Map();
  for (let y = 0; y < H; y++) {
    if (!dark(cx, y)) continue;
    let l = cx, r = cx; while (l > 0 && dark(l - 1, y)) l--; while (r < W - 1 && dark(r + 1, y)) r++;
    if (r - l > W * 0.12) span.set(y, [l + 3, r - 3]);
  }
  const rows = [...span.keys()];
  const winTop = Math.min(...rows), winBot = Math.max(...rows);
  // surface de l'eau (image pleine) : première ligne de la fenêtre où l'axe est nettement bleu
  let surf = winBot;
  for (let y = winTop; y <= winBot; y++) { const i = px(full, cx, y); if (full.data[i + 2] > full.data[i] + 40) { surf = y; break; } }
  const water = blank(W, H);
  for (const [y, [l, r]] of span) {
    // ligne source dans l'eau de l'image pleine (sous sa surface), étirée sur la fenêtre entière
    const sy = Math.min(winBot, Math.round(surf + 6 + (y - winTop) * (winBot - surf - 6) / Math.max(1, winBot - winTop)));
    for (let x = l; x <= r; x++) {
      const i = px(full, x, sy), o = px(water, x, y), f = Math.min(1, Math.min(x - l, r - x) / 3);
      water.data.set(full.data.subarray(i, i + 3), o); water.data[o + 3] = 255 * f;
    }
  }
  const bodyAt = (y) => { const s = span.get(y) ?? [cx, cx]; return [round3(s[0] / W), round3(s[1] / W)]; };
  M.can = { w: W, h: H, waterTop: round3(winTop / H), waterBottom: round3((winBot + 1) / H), bodyTop: bodyAt(winTop + 6), bodyBottom: bodyAt(winBot - 14) };
  M.can.empty = await emit('can_empty', empty, 340);
  M.can.water = await emit('can_water', water, 340);
  console.log(`arrosoir : fenêtre y ${winTop}→${winBot}, surface de l'eau y ${surf} (sur ${H})`);
}

/* ── Cabane, échelle, ronces, fleurs, décors, nuages ──────────────────────────────────────────── */
const simple = async (key, src, max) => { const im = await cut(src); M[key] = { w: im.w, h: im.h, ...(await emit(key, im, max)) }; };
await simple('cabin', 'cabin_full', 360);
/* Étapes de la cabane (facultatives) : cabin_2 … cabin_4, retouches de cabin_full générées une à une
   (garde-corps, ossature, toit). Chaque étape REMPLACE l'image entière : on garde sa
   position relative à la cabane finie (même cadre d'origine, ramené à l'échelle de cabin_full). */
M.cabinStages = {};
{
  const full = OFF.cabin_full;
  // pas d'étape 1 à part : le plancher est le bas de l'étape 2 (cf. lib/garden/scene3dLayout)
  for (const k of [2, 3, 4]) {
    const o = OFF[`cabin_${k}`]; if (!o) continue;
    const s = full.srcW / o.srcW, im = await cut(`cabin_${k}`);
    M.cabinStages[k] = {
      dx: round3((o.x * s - full.x) / full.w), dy: round3((o.y * s - full.y) / full.h),
      sw: round3((o.w * s) / full.w), sh: round3((o.h * s) / full.h), ...(await emit(`cabin_stage_${k}`, im, 360)),
    };
  }
}
{
  // échelle longue : deux échelles bout à bout (la longueur visible est coupée à l'affichage)
  const l = await cut('ladder'), ov = Math.round(l.h * 0.04), im = blank(l.w, l.h * 2 - ov);
  over(im, l, 0, 0); over(im, l, 0, l.h - ov);
  M.ladder = { w: im.w, h: im.h, ...(await emit('ladder', im, 520)) };
}
await simple('brambles', 'brambles', 420);
M.flower = {};
for (const s of SEASONS) { const im = await cut(`flower_${s}`); M.flower[s] = { w: im.w, h: im.h, ...(await emit(`flower_${s}`, im, 130)) }; }
M.decor = {};
for (const k of ['lantern', 'birdhouse', 'bench', 'mushrooms', 'fence', 'pond']) { const im = await cut(`decor_${k}`); M.decor[k] = { w: im.w, h: im.h, ...(await emit(`decor_${k}`, im, 300)) }; }
/* ── Boutique : trophée (titres) et flamme (flammes de série), la flamme recolorée par article ── */
M.shop = {};
{
  M.shop.nut = await emit('currency_nut', await cut('currency_nut'), 96);
  // packs de noisettes : les tas des icônes Play Console, en version SANS fond (npm run store-iap)
  for (const n of [100, 500, 1000]) {
    const f = path.join(cutDir, `pile_${n}.png`);
    if (fs.existsSync(f)) await emit(`iap_nuts_${n}`, await load(f), 160);
  }
  // succès : une image 3D par famille (souche, cadran solaire, pot, panneau) + l'arrosoir rempli
  for (const k of ['succ_rings', 'succ_sundial', 'succ_pot', 'succ_sign']) if (OFF[k]) await emit(k, await cut(k), 160);
  {
    const empty = await cut('can_empty'), full = await cut('can_full');
    const can = clone(empty); over(can, await resize(full, empty.w), 0, empty.h - Math.round(full.h * empty.w / full.w));
    await emit('succ_can', can, 160);
  }
  const tr = await cut('trophy');
  M.shop.trophy = await emit('shop_trophy', tr, 160);
  const fl = await cut('flame');
  // rampes sombre → clair ; « orange » = la flamme d'origine
  const FLAME = {
    silver: [[70, 76, 86], [150, 158, 170], [222, 228, 236], [255, 255, 255]],
    gold: [[120, 72, 8], [212, 150, 28], [250, 214, 80], [255, 246, 190]],
    blue: [[16, 40, 120], [40, 110, 220], [110, 190, 255], [220, 244, 255]],
    emerald: [[8, 70, 44], [24, 150, 92], [90, 214, 150], [210, 255, 226]],
    neon: [[90, 10, 120], [220, 40, 200], [80, 230, 255], [230, 255, 255]],
    red: [[90, 6, 14], [176, 18, 30], [236, 70, 60], [255, 190, 150]],
    violet: [[46, 14, 90], [110, 50, 190], [180, 120, 250], [240, 220, 255]],
  };
  M.shop.flame = await emit('shop_flame_orange', fl, 160);
  for (const [k, ramp] of Object.entries(FLAME)) {
    const im = clone(fl), d = im.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d.set(lerpRamp(ramp, Math.min(1, (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 230)), i);
    await emit(`shop_flame_${k}`, im, 160);
  }
}

M.cloud = [];
for (const k of ['cloud_1', 'cloud_3']) { const im = await cut(k); M.cloud.push({ w: im.w, h: im.h, ...(await emit(k, im, 520)) }); }

/* ── Pépin : cadre commun à toutes les humeurs et à tous les accessoires ───────────────────────── */
{
  const keys = ['pepin_base', 'pepin_joy', 'pepin_thinking', 'pepin_sleep', 'acc_scarf_red', 'acc_straw_hat', 'acc_sunglasses', 'acc_boots'];
  const x0 = Math.min(...keys.map((k) => OFF[k].x)), y0 = Math.min(...keys.map((k) => OFF[k].y));
  const x1 = Math.max(...keys.map((k) => OFF[k].x + OFF[k].w)), y1 = Math.max(...keys.map((k) => OFF[k].y + OFF[k].h));
  const W = x1 - x0, H = y1 - y0;
  const framed = async (k) => over(blank(W, H), await cut(k), OFF[k].x - x0, OFF[k].y - y0);
  const base = await framed('pepin_base');
  const MAX = 380;
  M.pepin = { w: W, h: H, foot: round3((OFF.pepin_base.y + OFF.pepin_base.h - y0) / H), bodyW: round3(OFF.pepin_base.w / W), bodyX: round3((OFF.pepin_base.x - x0) / W) };
  const moods = { happy: base, joy: await framed('pepin_joy'), thinking: await framed('pepin_thinking'), sleep: await framed('pepin_sleep') };
  for (const [m, im] of Object.entries(moods)) M.pepin[m] = await emit(`pepin_${m}`, im, MAX);

  /** Calque d'accessoire : la zone où l'image diffère de la base (dans `band`, fractions de hauteur), bords fondus.
   *  `isAcc` (facultatif) : seuls comptent les pixels qui ont la couleur de l'accessoire — sinon le léger
   *  redessin du visage par l'IA élargit la zone jusqu'aux yeux, qui écraseraient ceux des autres humeurs. */
  const patch = (acc, band, isAcc) => {
    const diff = new Uint8Array(W * H);
    for (let y = Math.round(band[0] * H); y < band[1] * H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, dd = Math.abs(acc.data[i] - base.data[i]) + Math.abs(acc.data[i + 1] - base.data[i + 1]) + Math.abs(acc.data[i + 2] - base.data[i + 2]) + Math.abs(acc.data[i + 3] - base.data[i + 3]);
      if (dd > 110 && (!isAcc || isAcc(acc.data, i))) diff[y * W + x] = 1;
    }
    // boîte des différences denses (on ignore le bruit isolé : une ligne compte s'il y a ≥ 6 pixels)
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for (let y = 0; y < H; y++) { let c = 0, lx = W, rx = 0; for (let x = 0; x < W; x++) if (diff[y * W + x]) { c++; lx = Math.min(lx, x); rx = Math.max(rx, x); } if (c >= 6) { by0 = Math.min(by0, y); by1 = y; bx0 = Math.min(bx0, lx); bx1 = Math.max(bx1, rx); } }
    const pad = 10, F = 12, out = blank(W, H);
    bx0 = Math.max(0, bx0 - pad); by0 = Math.max(0, by0 - pad); bx1 = Math.min(W - 1, bx1 + pad); by1 = Math.min(H - 1, by1 + pad);
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = (y * W + x) * 4, f = Math.min(1, Math.min(x - bx0, bx1 - x, y - by0, by1 - y) / F);
      out.data.set(acc.data.subarray(i, i + 3), i); out.data[i + 3] = acc.data[i + 3] * f;
    }
    return out;
  };
  // paille (jaune chaud) ou ruban vert ; verres et monture noirs
  const straw = (d, i) => d[i + 3] > 128 && ((d[i] > 140 && d[i] - d[i + 2] > 45 && d[i + 1] > 100) || (d[i + 1] > d[i] + 15 && d[i + 1] > d[i + 2] + 10));
  const dark = (d, i) => d[i + 3] > 128 && d[i] + d[i + 1] + d[i + 2] < 150;
  M.pepin.hat = await emit('pepin_acc_hat', patch(await framed('acc_straw_hat'), [0, 0.32], straw), MAX);
  M.pepin.sunglasses = await emit('pepin_acc_sunglasses', patch(await framed('acc_sunglasses'), [0.25, 0.5], dark), MAX);
  M.pepin.boots = await emit('pepin_acc_boots', patch(await framed('acc_boots'), [0.75, 1]), MAX);
  // écharpe rouge : recoloration de l'écharpe verte de CHAQUE humeur (la patte de « pensif » reste devant)
  M.pepin.scarfRed = {};
  for (const [m, im] of Object.entries(moods)) {
    const layer = blank(W, H);
    for (let y = Math.round(H * 0.42); y < H * 0.95; y++) for (let x = 0; x < W * 0.85; x++) {
      const i = (y * W + x) * 4, r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
      if (im.data[i + 3] < 128 || !(g > r + 16 && g > b + 6)) continue;
      const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      layer.data.set([Math.min(255, 62 + l * 280), 26 + l * 78, 22 + l * 58, im.data[i + 3]], i);
    }
    M.pepin.scarfRed[m] = await emit(`pepin_scarf_red_${m}`, layer, MAX);
  }
}

/* ── Manifeste TypeScript ─────────────────────────────────────────────────────────────────────── */
const req = (name) => `require('../../assets/garden3d/${name}.webp')`;
const replacer = (k, v) => v;
let json = JSON.stringify(M, replacer, 2);
const ts = `/* eslint-disable */
// ⚠️ FICHIER GÉNÉRÉ par scripts/garden-assets/build.mjs — ne pas modifier à la main.
// Tailles en px des images sources (w, h), ancrages en fractions, positions « x, y, tipY » dans le cadre 928 × 1152.

export const SCENE3D = ${json} as const;

/** Images (require statiques : Metro les embarque dans le bundle et dans les mises à jour OTA). */
export const SCENE3D_IMG = {
${files.map((f) => `  ${JSON.stringify(f)}: ${req(f)},`).join('\n')}
} as const;

export type Scene3dImage = keyof typeof SCENE3D_IMG;
`;
fs.writeFileSync(manifestFile, ts);
// les images qui ne sont plus produites (article retiré, image renommée)
for (const f of fs.readdirSync(outDir)) if (f.endsWith('.webp') && !files.includes(f.slice(0, -5))) fs.rmSync(path.join(outDir, f));

const total = files.reduce((s, f) => s + fs.statSync(path.join(outDir, `${f}.webp`)).size, 0);
console.log(`✓ ${files.length} images, ${(total / 1024 / 1024).toFixed(2)} Mo → assets/garden3d ; manifeste → lib/garden/scene3dAssets.ts`);
console.log('pointes des racines (y cadre) :', Object.entries(M.soil).map(([k, v]) => `${k}=${v.tipY}`).join(' '));
