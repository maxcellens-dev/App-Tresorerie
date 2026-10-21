/**
 * Rendu de contrôle de la scène 3D, HORS app : exécute la vraie mise en page (lib/garden/scene3dLayout)
 * et superpose les calques dans le même ordre que components/garden/GardenScene, avec le même ciel,
 * le même voile et les mêmes calques vectoriels → assets/garden-cut/preview/render_*.png.
 *
 *   npm run render
 *
 * Sert à vérifier un changement de mise en page ou d'images sans lancer l'app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { load, save, blank, resize, over } from './raster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.join(root, 'assets/garden-cut/preview');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

/* Transpile les modules purs nécessaires ; les `require('…webp')` deviennent le nom de l'image. */
const tmp = path.join(here, '.render');
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'package.json'), '{ "type": "commonjs" }');
for (const f of ['scene3dLayout', 'scene3dAssets', 'daylight', 'season']) {
  let src = fs.readFileSync(path.join(root, 'lib/garden', `${f}.ts`), 'utf8');
  src = src.replace(/require\('\.\.\/\.\.\/assets\/garden3d\/([^']+)\.webp'\)/g, "'$1'");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(tmp, `${f}.js`), js);
}
fs.writeFileSync(path.join(tmp, 'sceneSvg.js'), 'module.exports = {};');
fs.writeFileSync(path.join(tmp, 'sceneCinematic.js'), 'module.exports = {};');
const L = require(path.join(tmp, 'scene3dLayout.js'));
const W = L.FRAME_W, H = L.FRAME_H;

const cache = new Map();
const imgOf = async (name) => { if (!cache.has(name)) cache.set(name, await load(path.join(root, 'assets/garden3d', `${name}.webp`))); return cache.get(name); };

async function drawLayer(canvas, l) {
  let im = await resize(await imgOf(l.img), Math.max(1, Math.round(l.w)), Math.max(1, Math.round(l.h)));
  if (l.flip) { const f = blank(im.w, im.h); for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) f.data.set(im.data.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4), (y * im.w + im.w - 1 - x) * 4); im = f; }
  if (l.opacity != null) for (let i = 3; i < im.data.length; i += 4) im.data[i] *= l.opacity;
  const cut = l.showBottom ?? l.showTop;
  if (cut != null) {
    const vis = Math.round(im.h * Math.max(0, Math.min(1, cut)));
    for (let y = 0; y < im.h; y++) { const keep = l.showBottom != null ? y >= im.h - vis : y < vis; if (!keep) for (let x = 0; x < im.w; x++) im.data[(y * im.w + x) * 4 + 3] = 0; }
  }
  over(canvas, im, l.x, l.y);
}
const svgLayer = async (canvas, body) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  over(canvas, { w: W, h: H, data: new Uint8ClampedArray(data) }, 0, 0);
};

export async function render(state, opts, file) {
  const o = { season: 'summer', moment: 'day', ...opts };
  const s = L.layoutScene(state, o), v = s.vector, sky = L.skyStops(o.season, o.moment), veil = L.VEIL[o.moment];
  const c = blank(W, H, [255, 255, 255, 255]);
  const rg = (id, stops) => `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops.map(([of, col, op]) => `<stop offset="${of}" stop-color="${col}" stop-opacity="${op}"/>`).join('')}</radialGradient>`;
  await svgLayer(c, `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="0.55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>${rg('sun', [[0, '#FFF4D2', 1], [0.3, '#FFE6A8', 0.85], [1, '#FFE6A8', 0]])}${rg('glow', [[0, '#FFE9A6', 0.9], [0.55, '#FFD978', 0.35], [1, '#FFD978', 0]])}</defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${o.moment === 'day' ? '<circle cx="800" cy="112" r="130" fill="url(#sun)"/><circle cx="800" cy="112" r="44" fill="#FFF0C4" opacity="0.95"/>' : ''}
    ${o.moment === 'dusk' ? '<circle cx="790" cy="430" r="150" fill="url(#sun)"/><circle cx="790" cy="430" r="40" fill="#FFD9A0"/>' : ''}
    ${o.moment === 'night' ? (() => { let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647; return Array.from({ length: 70 }, (_, i) => `<circle cx="${r() * W}" cy="${r() * 520}" r="${(0.9 + r() * 1.8) * 1.15}" fill="#fff" opacity="${0.65 + (i % 5) * 0.07}"/>`).join(''); })() : ''}
    ${v.glow ? `<circle cx="${v.glow.cx}" cy="${v.glow.cy}" r="${v.glow.r}" fill="url(#glow)"/>` : ''}`);
  for (const l of s.back) await drawLayer(c, l);
  await svgLayer(c, `<defs>${rg('sh', [[0, '#1E2A10', 0.55], [1, '#1E2A10', 0]])}</defs>
    ${v.marks.map((m) => `<g opacity="${m.reached ? 1 : 0.55}"><line x1="74" y1="${m.y}" x2="726" y2="${m.y}" stroke="#F4E6CC" stroke-width="2.6" stroke-dasharray="8 10" stroke-linecap="round" opacity="0.9"/><rect x="736" y="${m.y - 21}" width="124" height="42" rx="13" fill="#D9B086" stroke="#8C6442" stroke-width="2"/><text x="798" y="${m.y + 8}" text-anchor="middle" font-family="Nunito, Arial" font-weight="800" font-size="23" fill="${m.reached ? '#3E2A17' : '#6E5639'}">${m.label}</text></g>`).join('')}
    ${v.dripRoots ? '<line x1="470" y1="742" x2="470" y2="808" stroke="#8ED0EA" stroke-width="5" stroke-dasharray="7 11" stroke-linecap="round" opacity="0.9"/>' : ''}
    ${v.shadows.map((sh) => `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}" fill="url(#sh)" opacity="${Math.min(1, sh.o * 1.6)}"/>`).join('')}`);
  for (const l of s.front) await drawLayer(c, l);
  await svgLayer(c, `${v.dripBranches ? `<line x1="${v.dripBranches.x}" y1="${v.dripBranches.y0}" x2="${v.dripBranches.x}" y2="${v.dripBranches.y1}" stroke="#8ED0EA" stroke-width="4.5" stroke-dasharray="7 11" stroke-linecap="round" opacity="0.9"/>` : ''}
    ${v.waterLine ? `<line x1="${v.waterLine.x1}" y1="${v.waterLine.y}" x2="${v.waterLine.x2}" y2="${v.waterLine.y}" stroke="#E4F6FF" stroke-width="3" stroke-linecap="round" opacity="0.8"/>` : ''}`);
  if (veil) await svgLayer(c, `<rect width="${W}" height="${H}" fill="rgb(${veil.rgb.join(',')})" opacity="${veil.a}"/>`);
  if (v.windows.length) await svgLayer(c, `<defs>${rg('win', [[0, '#FFD98A', o.moment === 'day' || !o.moment ? 0.45 : 0.8], [1, '#FFC870', 0]])}</defs>
    ${v.windows.map((w) => `<circle cx="${w.x + w.w / 2}" cy="${w.y + w.h / 2}" r="${w.w * 1.5}" fill="url(#win)"/><rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="${w.w * 0.06}" fill="#FFD36E" opacity="0.95"/><line x1="${w.x + w.w / 2}" y1="${w.y}" x2="${w.x + w.w / 2}" y2="${w.y + w.h}" stroke="#7A5A3A" stroke-width="${w.w * 0.09}"/><line x1="${w.x}" y1="${w.y + w.h / 2}" x2="${w.x + w.w}" y2="${w.y + w.h / 2}" stroke="#7A5A3A" stroke-width="${w.w * 0.09}"/>`).join('')}`);
  if (o.moment !== 'day') {
    await svgLayer(c, `<defs>${rg('moon', [[0, '#E8EEFF', 0.55], [1, '#E8EEFF', 0]])}${rg('lamp', [[0, '#FFE4A0', 0.95], [0.4, '#FFC870', 0.45], [1, '#FFC870', 0]])}</defs>
      ${o.moment === 'night' ? `<circle cx="800" cy="112" r="120" fill="url(#moon)"/><circle cx="800" cy="112" r="40" fill="#F2F5FF"/>` : ''}
      ${v.lights.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}" fill="url(#lamp)"/>`).join('')}
      ${v.sleepZ ? `<text x="${v.sleepZ.x}" y="${v.sleepZ.y}" font-family="Arial" font-weight="800" font-size="26" fill="#EEF2FF">z</text><text x="${v.sleepZ.x + 22}" y="${v.sleepZ.y - 26}" font-family="Arial" font-weight="800" font-size="34" fill="#EEF2FF">z</text>` : ''}`);
  }
  if (opts.hotspots) for (const h of s.hotspots) await svgLayer(c, `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" fill="none" stroke="#FF00AA" stroke-width="3"/><text x="${h.x + 6}" y="${h.y + 22}" font-size="20" fill="#FF00AA">${h.part}</text>`);
  if (file) await save(c, path.join(outDir, file));
  return c;
}

/* ── Scénarios ── */
const base = {
  growth: 1, stage: 'grand', roots: { months: 6.5, depth: 1, marks: { one: true, three: true, six: true }, beyondSix: true, extraMonths: 0.5 },
  branches: 1, fruits: 3, fruitTier: 3, investments: 3, ripe: true, flowers: 3, water: 0.6,
  drip: { roots: false, branches: false }, cabin: { progress: 1, count: 1 }, brambles: 0, rings: 4,
};
const S = (over) => ({ ...base, ...over, roots: { ...base.roots, ...(over.roots ?? {}) } });
const board = async (items, cols, file) => {
  const k = 3, tw = Math.round(W / k), th = Math.round(H / k), sheet = blank(tw * cols, th * Math.ceil(items.length / cols), [255, 255, 255, 255]);
  for (let i = 0; i < items.length; i++) over(sheet, await resize(await render(...items[i]), tw, th), (i % cols) * tw, Math.floor(i / cols) * th);
  await save(sheet, path.join(outDir, file));
};

await board([0.1, 0.4, 0.6, 1].map((p) => [S({ cabin: { progress: p, count: 1 } }), { decor: ['mushrooms'], season: 'autumn' }]), 4, 'render_cabin.png');
await render(base, { moment: 'day', decor: [], hotspots: true }, 'render_hotspots.png');
await board(['day', 'dusk', 'night'].map((moment) => [base, { moment }]), 3, 'render_moments.png');
await board(['spring', 'summer', 'autumn', 'winter'].map((season) => [base, { season }]), 4, 'render_seasons.png');
const growths = [0.16, 0.24, 0.3, 0.45, 0.6, 0.75, 0.95];
const months = [0, 0.5, 1.2, 2.4, 3.5, 5, 6];
await board(growths.map((g, i) => [S({ growth: g, fruits: i > 2 ? 2 : 0, cabin: null, flowers: i % 3, water: i / 6, roots: { months: months[i], beyondSix: false, marks: { one: months[i] >= 1, three: months[i] >= 3, six: months[i] >= 6 } } }), {}]), 4, 'render_growth.png');
await board([
  [S({ cabin: { progress: 0.1, count: 1 } }), {}], [S({ cabin: { progress: 0.5, count: 1 } }), {}], [S({ cabin: { progress: 0.9, count: 1 }, growth: 0.3 }), {}],
  [S({ brambles: 0.3, cabin: null }), {}], [S({ brambles: 1, cabin: null, growth: 0.2 }), {}], [S({ fruits: 6, fruitTier: 5 }), {}], [S({ fruits: 10, fruitTier: 10, ripe: false }), {}],
  [S({ drip: { roots: true, branches: true }, water: 0 }), { glow: true, rain: true }],
], 4, 'render_states.png');
await board([
  [base, { decor: ['lantern', 'birdhouse', 'bench', 'mushrooms', 'fence', 'pond'], outfit: { neck: 'scarf_red', head: 'straw_hat', eyes: 'sunglasses', feet: 'boots' } }],
  [base, { decor: ['lantern', 'birdhouse', 'bench', 'mushrooms', 'fence', 'pond'], moment: 'night' }],
  [base, { mood: 'joy' }], [base, { mood: 'thinking', outfit: { neck: 'scarf_red' } }],
], 4, 'render_shop.png');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ rendus dans assets/garden-cut/preview/render_*.png');
