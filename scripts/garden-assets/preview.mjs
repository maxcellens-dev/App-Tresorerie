/**
 * Aperçus de la scène 3D à partir des découpes (assets/garden-cut) → assets/garden-cut/preview/.
 *
 *   npm run preview
 *
 * Produit : scene_day / scene_dusk / scene_night (été) et seasons.png (4 saisons, jour).
 * Prototype de validation visuelle : les positions et l'étalonnage seront repris dans l'app.
 *
 * Repère = l'image plateau d'origine (928×1152) : plateau x 40 → 884, plaque d'herbe y 580 → 728,
 * dessus de l'herbe (où l'on pose les objets) y ≈ 655 au centre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, blank, clone, resize, over, gradient, blob, grade, footFrac } from './raster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cutDir = path.resolve(here, '../../assets/garden-cut');
const outDir = path.join(cutDir, 'preview');
fs.mkdirSync(outDir, { recursive: true });
const cut = (n) => load(path.join(cutDir, `${n}.png`));

const W = 928, H = 1152, GROUND = 655;

/* ── Saisons : seule la plaque d'herbe change (recoloration à luminance conservée) ── */
const SEASON_TINT = {
  summer: null,
  spring: [176, 214, 120],
  autumn: [206, 156, 86],
  winter: 'snow',
};
function seasonPlate(plate, season) {
  const tint = SEASON_TINT[season];
  if (!tint) return plate;
  const im = clone(plate), d = im.data;
  // la plaque = pixels verts du haut du plateau (jusqu'à la terre, ≈ 160 px sous le bord)
  const idx = []; let sum = 0;
  for (let y = 0; y < Math.min(im.h, 170); y++) for (let x = 0; x < im.w; x++) {
    const i = (y * im.w + x) * 4;
    if (d[i + 3] > 0 && d[i + 1] > d[i] - 4 && d[i + 1] > d[i + 2] + 25) { idx.push(i); sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]; }
  }
  const mean = sum / idx.length;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const i of idx) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / mean;
    if (tint === 'snow') {
      // neige : dessus éclairé blanc, tranche bleu-gris (contraste renforcé), léger grain
      const k = Math.pow(l, 1.6), g = (rnd() - 0.5) * 10;
      d[i] = 236 * k + g; d[i + 1] = 242 * k + g; d[i + 2] = 250 * k + g;
    } else {
      d[i] = tint[0] * l; d[i + 1] = tint[1] * l; d[i + 2] = tint[2] * l;
    }
  }
  return im;
}

/* ── Ciels ── */
async function skies() {
  const day = gradient(W, H, [[0, [196, 220, 232]], [0.6, [222, 232, 230]], [1, [236, 226, 206]]]);
  over(day, blob(300, 300, [255, 230, 180], 0.35, 0.1), 620, 0);
  over(day, blob(140, 140, [255, 236, 190], 1, 0.55), 700, 80);

  const dusk = gradient(W, H, [[0, [92, 86, 150]], [0.45, [232, 150, 120]], [0.75, [250, 196, 140]], [1, [250, 214, 170]]]);
  over(dusk, blob(320, 320, [255, 190, 130], 0.35, 0.1), 590, 260);
  over(dusk, blob(120, 120, [255, 214, 150], 1, 0.6), 690, 360);

  const night = gradient(W, H, [[0, [14, 22, 48]], [0.7, [36, 50, 92]], [1, [58, 64, 104]]]);
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 140; k++) { const x = (rnd() * W) | 0, y = (rnd() * H * 0.5) | 0, v = 150 + rnd() * 105; night.data.set([v, v, v, 255], (y * W + x) * 4); }
  over(night, blob(260, 260, [190, 210, 255], 0.22, 0.1), 636, 6);
  over(night, blob(92, 92, [240, 244, 255], 1, 0.75), 720, 90);
  return { day, dusk, night };
}

/** Étalonnage appliqué à toute la scène (pas au ciel, qui a le sien). */
const GRADE = {
  day: null,
  dusk: [[1.02, 0.82, 0.74], [10, 0, 0]],
  night: [[0.42, 0.5, 0.78], [0, 4, 18]],
};

/* ── Feuillage selon la saison : seuls les pixels de feuille (vert dominant) changent ── */
const lerpRamp = (ramp, t) => {
  t = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const k = Math.min(ramp.length - 2, Math.floor(t)), u = t - k;
  return ramp[k].map((v, c) => v + (ramp[k + 1][c] - v) * u);
};
const AUTUMN_RAMP = [[96, 40, 14], [190, 92, 28], [236, 160, 52], [255, 212, 110]];
function seasonTree(im, season) {
  if (season === 'summer') return im;
  const out = clone(im), d = out.data;
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const i = (y * out.w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    if (d[i + 3] === 0 || !(g > r + 6 && g > b + 6)) continue;
    const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    if (season === 'spring') { d[i] = r * 1.04 + 14; d[i + 1] = g * 1.06 + 12; d[i + 2] = b * 0.9; }
    else if (season === 'autumn') d.set(lerpRamp(AUTUMN_RAMP, l * 1.35), i);
    else if (season === 'winter') {
      // neige posée sur les feuilles éclairées, surtout en haut du houppier ; le reste reste vert
      const top = Math.max(0, 1 - (y / out.h) * 1.4);
      const w = Math.max(0, Math.min(1, (l - 0.42) / 0.18)) * Math.min(1, 0.35 + top);
      d[i] = r + (246 - r) * w; d[i + 1] = g + (249 - g) * w; d[i + 2] = b + (255 - b) * w;
    }
  }
  return out;
}

/* ── Pommes : une seule image, trois maturités par recoloration de la peau (rouge dominant) ── */
const APPLE_RAMP = {
  young: [[70, 96, 20], [150, 176, 52], [214, 226, 120], [250, 250, 210]],
  gold: [[110, 70, 8], [206, 150, 30], [250, 214, 90], [255, 248, 210]],
};
function appleKind(im, kind) {
  if (kind === 'ripe') return im;
  const out = clone(im), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0 || !(d[i] > d[i + 1] + 30)) continue;
    const l = (0.45 * d[i] + 0.45 * d[i + 1] + 0.1 * d[i + 2]) / 255;
    d.set(lerpRamp(APPLE_RAMP[kind], l * 1.25), i);
  }
  return out;
}

/** Bout de la branche droite (point le plus à droite entre 55 % et 80 % de la hauteur), en px de l'image. */
function branchTip(im) {
  let tx = 0, ty = 0;
  for (let y = Math.round(im.h * 0.55); y < im.h * 0.8; y++) for (let x = im.w - 1; x > tx; x--) if (im.data[(y * im.w + x) * 4 + 3] > 200) { tx = x; ty = y; break; }
  return { x: tx, y: ty };
}

/* ── Arrosoir : vide + eau de l'arrosoir plein, coupée au niveau voulu ── */
const WATER_TOP = 0.25, WATER_BOTTOM = 0.93; // fractions de hauteur de can_full (surface, fond)
async function canAt(level, width = 205) {
  const full = await resize(await cut('can_full'), width);
  const empty = await resize(await cut('can_empty'), width);
  const out = blank(width, Math.max(full.h, empty.h));
  over(out, empty, 0, out.h - empty.h);
  if (level <= 0) return out;
  const top = full.h * WATER_TOP, cutY = Math.round(top + (1 - Math.min(1, level)) * (full.h * WATER_BOTTOM - top));
  const dy = out.h - full.h;
  for (let y = cutY; y < full.h; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 4, o = ((y + dy) * width + x) * 4;
    if (full.data[s + 3] === 0) continue;
    out.data.set(full.data.subarray(s, s + 4), o);
    // reflet de la surface : liseré clair sur les 2 premières lignes
    if (y - cutY < 2 && level < 1) for (let c = 0; c < 3; c++) out.data[o + c] += (255 - out.data[o + c]) * 0.45;
  }
  return out;
}

const plateR4 = await cut('roots_r4');
const pepin = await resize(await cut('pepin_base'), 175);
const appleSrc = await cut('apple');
const cabinSrc = await cut('cabin_full');
const sky = await skies();
const shadow = (w, h) => blob(w, h, [40, 52, 16], 0.55, 0.15);

/** Les 7 tailles de l'arbre : 3 images sources, mises à l'échelle. */
const TREE_SIZES = [
  { src: 'tree_sprout', h: 110 }, { src: 'tree_sprout', h: 170 }, { src: 'tree_young', h: 330 },
  { src: 'tree_adult', h: 420 }, { src: 'tree_adult', h: 500 }, { src: 'tree_adult', h: 570 }, { src: 'tree_adult', h: 640 },
];
const treeCache = new Map();
async function treeOf(size) {
  if (!treeCache.has(size)) { const s = TREE_SIZES[size - 1]; treeCache.set(size, await resize(await cut(s.src), null, s.h)); }
  return treeCache.get(size);
}

/** Premier plan (plateau + objets) sur fond transparent. */
async function foreground({ season = 'summer', size = 7, water = 0.75, cabin = false, apples = [] } = {}) {
  const fg = blank(W, H);
  const tree = seasonTree(await treeOf(size), season);
  const can = await canAt(water);
  over(fg, seasonPlate(plateR4, season), 40, 580);
  over(fg, shadow(Math.max(90, tree.w * 0.42), 50), 470 - Math.max(90, tree.w * 0.42) / 2, 632);
  over(fg, shadow(200, 30), 102, 652);
  over(fg, shadow(170, 26), 668, 658);
  const tx = 470 - tree.w * footFrac(tree), ty = GROUND - tree.h + 6;
  over(fg, tree, tx, ty);
  if (cabin && size >= 4) {
    const tip = branchTip(tree), cab = await resize(cabinSrc, Math.round(tree.w * 0.3));
    over(fg, cab, tx + tip.x - cab.w * 0.85, ty + tip.y - cab.h * 0.9);
  }
  // pommes dans le houppier (positions en fraction de l'image de l'arbre)
  const SPOTS = [[0.3, 0.3], [0.66, 0.2], [0.5, 0.5], [0.2, 0.55], [0.78, 0.45]];
  for (let k = 0; k < apples.length && size >= 4; k++) {
    const a = await resize(appleKind(appleSrc, apples[k]), Math.round(tree.w * 0.075));
    over(fg, a, tx + tree.w * SPOTS[k][0] - a.w / 2, ty + tree.h * SPOTS[k][1] - a.h / 2);
  }
  over(fg, can, 105, 668 - can.h);
  over(fg, pepin, 660, 672 - pepin.h);
  return fg;
}

const full = { cabin: true, apples: ['ripe', 'ripe', 'ripe'] };
for (const moment of ['day', 'dusk', 'night']) {
  const fg = await foreground(full);
  await save(over(clone(sky[moment]), GRADE[moment] ? grade(fg, ...GRADE[moment]) : fg, 0, 0), path.join(outDir, `scene_${moment}.png`));
}

/** Planche : chaque scène réduite d'un facteur `k`, `cols` colonnes. */
async function board(scenes, cols, k, file) {
  const tw = Math.round(W / k), th = Math.round(H / k), rows = Math.ceil(scenes.length / cols);
  const sheet = blank(tw * cols, th * rows, [255, 255, 255, 255]);
  for (let i = 0; i < scenes.length; i++) over(sheet, await resize(scenes[i], tw, th), (i % cols) * tw, Math.floor(i / cols) * th);
  await save(sheet, path.join(outDir, file));
}
const withDay = async (opts) => over(clone(sky.day), await foreground(opts), 0, 0);

await board(await Promise.all(['spring', 'summer', 'autumn', 'winter'].map((season) => withDay({ season, ...full }))), 2, 2, 'seasons.png');
await board(await Promise.all([1, 2, 3, 4, 5, 6, 7].map((size) => withDay({ size }))), 4, 3, 'sizes.png');
await board(await Promise.all([0, 0.33, 0.66, 1].map((water) => withDay({ water, size: 4, apples: ['young', 'ripe', 'gold'] }))), 4, 3, 'water_apples.png');

console.log(`✓ aperçus dans ${path.relative(process.cwd(), outDir) || outDir}`);
