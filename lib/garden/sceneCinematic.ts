/**
 * Dessin du jardin, style « cinématique semi-réaliste » : feuillage dense fait de centaines de
 * feuilles éclairées, arrosoir en verre où l'on voit l'eau, sol en coupe (terre, cailloux, couches),
 * racines ramifiées, ciel qui suit la saison. Remplace la « 3D douce » (lib/garden/sceneSvg, gardée
 * pour la description accessible et en repli).
 *
 * Fonction PURE et DÉTERMINISTE (générateur pseudo-aléatoire à graine fixe) : le même état donne
 * exactement le même dessin, à chaque rendu et sur chaque appareil.
 *
 * ⚠️ AUCUN FILTRE SVG (cf. sceneSvg) : lumière, ombres et halos sont des dégradés.
 * Repère : viewBox `0 -20 400 470`, comme l'ancienne scène (zones touchables compatibles).
 */
import type { TreeState } from './treeState';
import type { Season } from './season';
import type { Hotspot, Scene, SceneOptions } from './sceneSvg';

/** Ce que la boutique ajoute au dessin. */
export interface SceneExtras {
  /** Décor équipé : 'lantern' | 'birdhouse' | 'bench' | 'mushrooms' | 'fence' | 'pond'. */
  decor?: string[];
  /** Garde-robe de Pépin. */
  outfit?: { neck?: string; head?: string; eyes?: string; feet?: string };
}

const f = (n: number) => Math.round(n * 10) / 10;
const DEFAULT_VIEWBOX = '0 -20 400 470';
const BASE = 250;          // sol où les objets sont posés (au milieu du dessus d'herbe)
const TOP = 204;           // bord arrière du dessus d'herbe (vu en perspective)
const FRONT = 276;         // bord avant : début de la coupe de terre
const BOTTOM = 446;

/** Générateur pseudo-aléatoire à graine fixe (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const LEAF_RAMPS: Record<Season, string[]> = {
  spring: ['#2B6332', '#3B7F3D', '#559F4B', '#7DBF5E', '#A9D97E'],
  summer: ['#1F4A28', '#2A6232', '#3A7E3A', '#56A047', '#86C461'],
  autumn: ['#6E2E14', '#9B4119', '#C2621F', '#DE9432', '#F0C057'],
  winter: ['#1C4026', '#27552D', '#356D37', '#4C8A45', '#6FA65C'],
};
const SKY: Record<Season, [string, string]> = {
  spring: ['#BFDCEB', '#F4EFE2'],
  summer: ['#A9D2EA', '#F6EBD4'],
  autumn: ['#B9C2C6', '#EADFCF'],
  winter: ['#C7D3DC', '#EEF1F3'],
};
/* Positions des fruits dans le feuillage (unités de rayon). Les trois premiers sont bien visibles. */
const FRUITS: [number, number][] = [[-.42, .1], [.46, .16], [.08, -.34], [-.14, .4], [.6, -.18], [-.6, -.24], [.3, .44], [-.32, -.56], [.34, -.02], [-.02, .1], [-.7, .22], [.72, .3]];
const FLOWERS: [number, number][] = [[158, BASE + 2], [172, BASE + 6], [244, BASE + 5], [258, BASE + 1], [146, BASE + 7]];

function defs(id: string, season: Season): string {
  const rg = (n: string, stops: [number, string, number?][], a = 'cx="0.35" cy="0.3" r="0.75"') => `<radialGradient id="${id}-${n}" ${a}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('')}</radialGradient>`;
  const lg = (n: string, stops: [number, string, number?][], a: string) => `<linearGradient id="${id}-${n}" ${a}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('')}</linearGradient>`;
  const V = 'x1="0" y1="0" x2="0" y2="1"', H = 'x1="0" y1="0" x2="1" y2="0"';
  const [sk1, sk2] = SKY[season];
  const ramp = LEAF_RAMPS[season];
  return `<defs>
${lg('sky', [[0, sk1], [1, sk2]], V)}
${rg('sun', [[0, '#FFF6D8', 1], [0.35, '#FFE7A8', 0.9], [1, '#FFE7A8', 0]], 'cx="0.5" cy="0.5" r="0.5"')}
${rg('clump', [[0, ramp[3]], [0.5, ramp[2]], [1, ramp[1]]], 'cx="0.32" cy="0.28" r="0.85"')}
${rg('clumpHi', [[0, ramp[4]], [0.45, ramp[3]], [1, ramp[2]]], 'cx="0.32" cy="0.28" r="0.85"')}
${rg('clumpLo', [[0, ramp[2]], [0.55, ramp[1]], [1, ramp[0]]], 'cx="0.32" cy="0.28" r="0.85"')}
${rg('shadow', [[0, '#1E1A12', 0.38], [1, '#1E1A12', 0]], 'cx="0.5" cy="0.5" r="0.5"')}
${rg('canopyShadow', [[0, '#1E2A14', 0.42], [1, '#1E2A14', 0]], 'cx="0.5" cy="0.5" r="0.5"')}
${lg('grassTop', [[0, season === 'autumn' ? '#D2D58A' : season === 'winter' ? '#C2D0A4' : '#D3E894'], [0.6, season === 'autumn' ? '#B9C266' : season === 'winter' ? '#A6BB86' : '#B9DA72'], [1, season === 'autumn' ? '#94A048' : season === 'winter' ? '#879E66' : '#8EBE4E']], V)}
${lg('grassLip', [[0, '#6E9B3C'], [1, '#4E7A2A']], V)}
${lg('soil', [[0, '#7E5A3E'], [0.55, '#6E4C33'], [0.82, '#5E412B'], [0.86, '#A6937C'], [1, '#8C7A64']], V)}
${lg('soilSide', [[0, '#FFFFFF', 0.08], [0.25, '#FFFFFF', 0], [0.75, '#000000', 0], [1, '#000000', 0.25]], H)}
${lg('bark', [[0, '#5A4230'], [0.3, '#9A7757'], [0.55, '#7A5A40'], [1, '#3A2A1C']], H)}
${lg('root', [[0, '#DDBD96'], [0.5, '#B48D68'], [1, '#86644A']], H)}
${rg('apple', [[0, '#FFD4A8'], [0.35, '#F06A3E'], [0.8, '#C2301F'], [1, '#86190F']])}
${rg('appleYoung', [[0, '#FBF7C2'], [0.4, '#D6DC6A'], [0.85, '#97A92E'], [1, '#6B7A1B']])}
${rg('appleGold', [[0, '#FFF7CF'], [0.4, '#F7C843'], [0.85, '#C98A14'], [1, '#8F5F0A']])}
${rg('petal', [[0, '#FFE6EF'], [0.6, '#F2A7C1'], [1, '#C96B8E']])}
${lg('wood', [[0, '#D9B086'], [0.5, '#B98A5E'], [1, '#8C6442']], V)}
${lg('woodDark', [[0, '#8C6442'], [1, '#5E4129']], V)}
${lg('roof', [[0, '#B55A3A'], [1, '#7E3A24']], V)}
${lg('water', [[0, '#8FD0EE'], [0.6, '#4FA3D2'], [1, '#2E78AA']], V)}
${lg('glass', [[0, '#FFFFFF', 0.55], [0.3, '#E6F4FA', 0.22], [0.7, '#CFE8F2', 0.14], [1, '#FFFFFF', 0.4]], H)}
${rg('stone', [[0, '#F2EBE0'], [0.55, '#CFC4B2'], [1, '#948670']])}
${rg('spike', [[0, '#C9AE8C'], [1, '#5A4130']])}
${rg('cream', [[0, '#FBF1E1'], [0.7, '#E9D3B4'], [1, '#C7A985']])}
${rg('pelt', [[0, '#9C7B5C'], [0.55, '#6E5039'], [1, '#3E2C1F']], 'cx="0.4" cy="0.3" r="0.8"')}
${rg('nose', [[0, '#5A5A5A'], [0.4, '#1E1E1E'], [1, '#000000']])}
${rg('glow', [[0, '#FFE9A6', 0.95], [0.5, '#FFD978', 0.4], [1, '#FFD978', 0]], 'cx="0.5" cy="0.5" r="0.5"')}
${rg('nappe', [[0, '#CFEFFF', 0.95], [0.6, '#7DC4E6', 0.6], [1, '#7DC4E6', 0]], 'cx="0.5" cy="0.5" r="0.5"')}
</defs>`;
}

/* ── Éléments ─────────────────────────────────────────────────────────────────────────────────── */

function leafPath(len: number, wid: number) { return `M0 0Q${f(len * .5)} ${f(-wid)} ${f(len)} 0Q${f(len * .5)} ${f(wid)} 0 0Z`; }

function apple(id: string, x: number, y: number, r: number, kind: 'apple' | 'appleYoung' | 'appleGold'): string {
  return `<path d="M${f(x)} ${f(y - r * .8)}Q${f(x + r * .15)} ${f(y - r * 1.4)} ${f(x + r * .35)} ${f(y - r * 1.55)}" stroke="#4A3220" stroke-width="${f(Math.max(1.1, r * .14))}" fill="none" stroke-linecap="round"/>`
    + `<path transform="translate(${f(x + r * .3)} ${f(y - r * 1.35)}) rotate(-25)" d="${leafPath(r * 1.1, r * .32)}" fill="#3E7F3A"/>`
    + `<path d="M${f(x)} ${f(y - r * .75)}C${f(x + r * 1.15)} ${f(y - r * 1.25)} ${f(x + r * 1.25)} ${f(y + r * .55)} ${f(x + r * .3)} ${f(y + r * .95)}Q${f(x)} ${f(y + r * 1.05)} ${f(x - r * .3)} ${f(y + r * .95)}C${f(x - r * 1.25)} ${f(y + r * .55)} ${f(x - r * 1.15)} ${f(y - r * 1.25)} ${f(x)} ${f(y - r * .75)}Z" fill="url(#${id}-${kind})"/>`
    + `<ellipse cx="${f(x - r * .38)}" cy="${f(y - r * .3)}" rx="${f(r * .22)}" ry="${f(r * .34)}" fill="#FFFFFF" opacity=".45" transform="rotate(-20 ${f(x - r * .38)} ${f(y - r * .3)})"/>`;
}

function wateringCan(id: string, x: number, y: number, level: number): string {
  const lv = Math.max(0, Math.min(1, level));
  // corps arrondi : fond plat, flancs bombés, épaules rondes, petit col
  const body = `M${x + 10} ${y}Q${x + 2} ${y} ${x + 2} ${y - 10}L${x + 4} ${y - 34}Q${x + 6} ${y - 50} ${x + 22} ${y - 52}H${x + 44}Q${x + 60} ${y - 50} ${x + 62} ${y - 34}L${x + 64} ${y - 10}Q${x + 64} ${y} ${x + 56} ${y}Z`;
  const wy = y - 2 - 46 * lv;
  let s = `<ellipse cx="${x + 36}" cy="${y + 3}" rx="44" ry="6" fill="url(#${id}-shadow)"/>`;
  // anse (arc en verre épais, derrière)
  s += `<path d="M${x + 10} ${y - 44}C${x + 8} ${y - 74} ${x + 52} ${y - 78} ${x + 58} ${y - 46}" stroke="#A9D4E6" stroke-width="7" fill="none" opacity=".6" stroke-linecap="round"/><path d="M${x + 11} ${y - 46}C${x + 10} ${y - 72} ${x + 50} ${y - 75} ${x + 56} ${y - 48}" stroke="#FFFFFF" stroke-width="1.4" fill="none" opacity=".85"/>`;
  // bec : tube conique qui monte vers la droite, pomme d'arrosoir au bout
  s += `<path d="M${x + 60} ${y - 12}L${x + 98} ${y - 54}L${x + 103} ${y - 50}L${x + 63} ${y - 4}Z" fill="#BFE2F0" opacity=".8" stroke="#8FC0D4" stroke-width="1.2"/><path d="M${x + 62} ${y - 10}L${x + 98} ${y - 51}" stroke="#FFFFFF" stroke-width="1.3" opacity=".8"/>`;
  s += `<ellipse cx="${x + 103}" cy="${y - 55}" rx="7" ry="4.6" transform="rotate(-48 ${x + 103} ${y - 55})" fill="#D9EFF7" stroke="#8FC0D4" stroke-width="1.1"/>`;
  // eau visible à travers le verre
  s += `<clipPath id="${id}-can"><path d="${body}"/></clipPath>`;
  if (lv > 0) s += `<g clip-path="url(#${id}-can)"><rect x="${x}" y="${f(wy)}" width="70" height="70" fill="url(#${id}-water)" opacity=".9"/><ellipse cx="${x + 33}" cy="${f(wy)}" rx="31" ry="3.4" fill="#DDF3FF" opacity=".95"/><path d="M${x + 8} ${f(wy + 6)}Q${x + 33} ${f(wy + 10)} ${x + 60} ${f(wy + 6)}" stroke="#FFFFFF" stroke-width="1" opacity=".4" fill="none"/><circle cx="${x + 20}" cy="${f(wy + 16)}" r="1.6" fill="#FFFFFF" opacity=".55"/><circle cx="${x + 44}" cy="${f(wy + 26)}" r="1.2" fill="#FFFFFF" opacity=".5"/></g>`;
  // paroi de verre, reflets francs
  s += `<path d="${body}" fill="url(#${id}-glass)" stroke="#9FCDE0" stroke-width="1.6"/>`;
  s += `<path d="M${x + 11} ${y - 36}Q${x + 9} ${y - 20} ${x + 12} ${y - 8}" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" fill="none" opacity=".8"/><path d="M${x + 24} ${y - 47}H${x + 40}" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" opacity=".7"/><path d="M${x + 56} ${y - 34}L${x + 57} ${y - 16}" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity=".45"/>`;
  return s;
}

function flower(id: string, x: number, y: number, k: number): string {
  let s = `<path d="M${x} ${y}Q${x - 1} ${y - 9} ${x + 1} ${y - 18}" stroke="#4E7F36" stroke-width="1.6" fill="none"/><path transform="translate(${x} ${y - 8}) rotate(${k % 2 ? -150 : -30})" d="${leafPath(8, 2.6)}" fill="#5E9A42"/>`;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + k; s += `<ellipse cx="${f(x + 1 + Math.cos(a) * 4)}" cy="${f(y - 20 + Math.sin(a) * 3.4)}" rx="3.6" ry="2" transform="rotate(${f(a * 57.3)} ${f(x + 1 + Math.cos(a) * 4)} ${f(y - 20 + Math.sin(a) * 3.4)})" fill="url(#${id}-petal)"/>`; }
  return s + `<circle cx="${x + 1}" cy="${y - 20}" r="2.2" fill="#E8B23A"/>`;
}

function cabin(id: string, x: number, y: number, w: number, progress: number, groundY: number): string {
  const p = Math.max(0, Math.min(1, progress)), h = w * .62, rows = 6, rh = h / rows, built = Math.max(1, Math.ceil(p * rows));
  const lx = x + w * .14, rx = lx + 12;
  let s = `<path d="M${f(lx)} ${f(y + 3)}L${f(lx - 2)} ${f(groundY)}M${f(rx)} ${f(y + 3)}L${f(rx + 2)} ${f(groundY)}" stroke="#6E4D30" stroke-width="2.6" stroke-linecap="round"/>`;
  for (let yy = y + 11; yy < groundY - 3; yy += 9) s += `<path d="M${f(lx - 1)} ${f(yy)}H${f(rx + 1)}" stroke="#A47A50" stroke-width="2.2" stroke-linecap="round"/>`;
  s += `<g transform="translate(${f(x)} ${f(y)})">`;
  s += `<path d="M${f(w * .2)} ${f(w * .1)}L${f(w * .42)} ${f(w * .32)}M${f(w * .8)} ${f(w * .1)}L${f(w * .58)} ${f(w * .32)}" stroke="#5E4129" stroke-width="3" stroke-linecap="round"/>`;
  s += `<rect x="${f(-w * .12)}" y="0" width="${f(w * 1.24)}" height="${f(w * .1)}" rx="1.5" fill="url(#${id}-woodDark)"/>`;
  for (let i = 0; i < 7; i++) s += `<path d="M${f(-w * .12 + i * w * 1.24 / 7)} 0V${f(w * .1)}" stroke="#4A3220" stroke-width=".6" opacity=".6"/>`;
  for (let i = 0; i < built; i++) {
    const yy = -rh * (i + 1);
    s += `<rect x="0" y="${f(yy)}" width="${f(w)}" height="${f(rh - .7)}" rx=".8" fill="url(#${id}-wood)"/><path d="M${f(w * (i % 2 ? .3 : .64))} ${f(yy + 1)}V${f(yy + rh - 1.4)}" stroke="#8C6442" stroke-width=".8" opacity=".8"/><path d="M2 ${f(yy + rh * .45)}H${f(w * .25)}M${f(w * .7)} ${f(yy + rh * .55)}H${f(w - 2)}" stroke="#A47A50" stroke-width=".5" opacity=".7"/>`;
  }
  if (built >= 3) s += `<rect x="${f(w * .6)}" y="${f(-rh * 3)}" width="${f(w * .24)}" height="${f(rh * 3 - .7)}" rx="1.5" fill="#4A3220"/><circle cx="${f(w * .66)}" cy="${f(-rh * 1.5)}" r="1.1" fill="#E2B04A"/>`;
  if (built >= 5) s += `<rect x="${f(w * .12)}" y="${f(-rh * 4.7)}" width="${f(w * .28)}" height="${f(w * .22)}" rx="1" fill="#F6D98E" stroke="#5E4129" stroke-width="1.6"/><path d="M${f(w * .26)} ${f(-rh * 4.7)}V${f(-rh * 4.7 + w * .22)}M${f(w * .12)} ${f(-rh * 4.7 + w * .11)}H${f(w * .4)}" stroke="#5E4129" stroke-width="1.2"/>`;
  if (p >= .8) {
    s += `<path d="M${f(-w * .18)} ${f(-h + 1)}L${f(w / 2)} ${f(-h - w * .46)}L${f(w * 1.18)} ${f(-h + 1)}Z" fill="url(#${id}-roof)"/>`;
    for (let i = 1; i < 4; i++) { const yy = -h + 1 - (w * .46) * i / 4; const half = (w * .68) * (1 - i / 4); s += `<path d="M${f(w / 2 - half)} ${f(yy)}H${f(w / 2 + half)}" stroke="#6B2E1C" stroke-width=".8" opacity=".6"/>`; }
  }
  return s + '</g>';
}

/** Pépin, le hérisson jardinier (semi-réaliste) avec sa garde-robe. */
function hedgehog(id: string, x: number, y: number, mood: 'happy' | 'joy' | 'thinking', outfit: SceneExtras['outfit'] = {}): string {
  const r = rng(77);
  let s = `<g transform="translate(${x} ${y})"><ellipse cx="34" cy="2" rx="40" ry="6" fill="url(#${id}-shadow)"/>`;
  // pattes
  if (outfit.feet === 'boots') s += `<path d="M16 0V-8H24V-3H29V0Z" fill="#E2B93A"/><path d="M42 0V-8H50V-3H55V0Z" fill="#D2A92A"/>`;
  else s += `<ellipse cx="22" cy="-1.5" rx="5.5" ry="3" fill="#4A3424"/><ellipse cx="48" cy="-1.5" rx="5.5" ry="3" fill="#4A3424"/>`;
  // ventre/flanc clair sous le pelage
  s += `<ellipse cx="34" cy="-8" rx="26" ry="9" fill="#D8C2A2"/>`;
  // masse du pelage : dôme brun
  s += `<path d="M2 -6Q0 -34 30 -40Q54 -42 60 -22Q62 -10 54 -6Z" fill="url(#${id}-pelt)"/>`;
  // piquants : plusieurs centaines, couchés vers l'arrière, base sombre, pointe crème
  const sp: [number, number, number, number, number][] = [];
  for (let i = 0; i < 300; i++) {
    const u = r(), v = r();
    // point dans le dôme (paramétré du bas-gauche au haut)
    const bx = 4 + u * 52, top = -36 + Math.pow(Math.abs(u - .48) / .52, 2) * 26, by = -6 + (top + 6) * Math.sqrt(v);
    if (bx > 50 && by > -24) continue; // laisse la place au visage
    const ang = Math.PI + .55 + (u - .5) * .9 + (r() - .5) * .35; // vers l'arrière et le haut
    const len = 6 + r() * 5;
    sp.push([bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len, r()]);
  }
  sp.sort((p, q) => q[1] - p[1]).forEach(([bx, by, tx, ty, k]) => {
    const dark = k < .5 ? '#4A3626' : k < .8 ? '#6A4E38' : '#86684E';
    s += `<path d="M${f(bx)} ${f(by)}L${f(tx)} ${f(ty)}" stroke="${dark}" stroke-width="1.1" stroke-linecap="round" opacity=".6"/><path d="M${f(bx + (tx - bx) * .6)} ${f(by + (ty - by) * .6)}L${f(tx)} ${f(ty)}" stroke="${k > .35 ? '#EFE2CC' : '#CDB592'}" stroke-width=".9" stroke-linecap="round"/>`;
  });
  // visage : museau pointu clair, joue ombrée
  s += `<path d="M44 -6Q36 -10 38 -22Q42 -32 54 -30Q64 -27 72 -16Q74 -12 70 -10Q60 -4 44 -6Z" fill="url(#${id}-cream)"/>`;
  s += `<path d="M46 -8Q56 -6 68 -11" stroke="#C7A985" stroke-width="2.2" fill="none" opacity=".6" stroke-linecap="round"/>`;
  s += `<circle cx="73" cy="-15" r="3.2" fill="url(#${id}-nose)"/><circle cx="72.2" cy="-16" r=".9" fill="#FFFFFF" opacity=".8"/>`;
  s += `<ellipse cx="47" cy="-28" rx="3.6" ry="3.2" fill="#A98468"/><ellipse cx="47" cy="-28" rx="2" ry="1.7" fill="#D49E8A"/>`;
  s += mood === 'joy'
    ? `<path d="M53 -22Q56 -26 59 -22" stroke="#1E1712" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="56" cy="-21" rx="2.4" ry="2.6" fill="#0E0A08"/><circle cx="56.8" cy="-22" r=".85" fill="#FFFFFF"/>`;
  if (mood === 'thinking') s += `<path d="M52 -27Q56 -29.5 60 -27" stroke="#4E3828" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  s += `<path d="M64 -10.5Q67 -9 69.5 -11" stroke="#5A4130" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  // lunettes rondes fines (signe distinctif) ou lunettes de soleil
  if (outfit.eyes === 'sunglasses') s += `<circle cx="56" cy="-21" r="5.4" fill="#1E2A30" opacity=".92"/><path d="M50.6 -22L42 -25" stroke="#1E1E1E" stroke-width="1.1"/>`;
  else s += `<circle cx="56" cy="-21" r="5.4" fill="#FFFFFF" fill-opacity=".1" stroke="#7B8287" stroke-width="1.1"/><path d="M50.6 -22L42 -25" stroke="#7B8287" stroke-width=".9"/>`;
  // écharpe fine (verte, ou brique en boutique)
  const sc = outfit.neck === 'scarf_red' ? ['#B9503F', '#8E392C'] : ['#4E8A5E', '#356848'];
  s += `<path d="M40 -9Q52 -3 64 -9L64.5 -5.5Q52 1 39.5 -5Z" fill="${sc[0]}"/><path d="M45 -6L41 4Q44.5 5 47.5 3L48.5 -5Z" fill="${sc[1]}"/>`;
  // pousse sur la tête, ou chapeau de paille
  if (outfit.head === 'straw_hat') s += `<ellipse cx="32" cy="-38" rx="20" ry="5" fill="#D9B46A"/><path d="M21 -38Q22 -53 32 -53Q42 -53 43 -38Z" fill="#E7C985"/><path d="M21.5 -41.5H42.5" stroke="#4C8B5E" stroke-width="3"/>`;
  else s += `<path d="M30 -38Q28 -46 32 -52" stroke="#3E7A44" stroke-width="1.7" fill="none" stroke-linecap="round"/><path transform="translate(32 -51) rotate(-60)" d="${leafPath(11, 3.6)}" fill="#6FAE5E"/><path transform="translate(31 -47) rotate(-150)" d="${leafPath(9, 3)}" fill="#5E9A4E"/>`;
  if (mood === 'joy') s += `<path d="M50 -9Q46 -20 44 -26" stroke="#E2CDAE" stroke-width="4.4" fill="none" stroke-linecap="round"/>`;
  return s + '</g>';
}

/** Décor acheté en boutique. */
function decorItem(id: string, key: string, cx: number, top: number, R: number, trunkX: number): string {
  switch (key) {
    case 'lantern': {
      const x = cx - R * .62, y = top + R * .62;
      return `<path d="M${f(x)} ${f(y - 22)}V${f(y - 8)}" stroke="#3A2A1E" stroke-width="1"/><circle cx="${f(x)}" cy="${f(y + 2)}" r="14" fill="url(#${id}-glow)"/><path d="M${f(x - 5)} ${f(y - 8)}H${f(x + 5)}L${f(x + 3)} ${f(y - 11)}H${f(x - 3)}Z" fill="#2E2A26"/><rect x="${f(x - 4.5)}" y="${f(y - 8)}" width="9" height="13" rx="1.5" fill="#FBE3A0" stroke="#2E2A26" stroke-width="1.3"/><path d="M${f(x - 5)} ${f(y + 5)}H${f(x + 5)}L${f(x + 3)} ${f(y + 8)}H${f(x - 3)}Z" fill="#2E2A26"/>`;
    }
    case 'birdhouse': {
      const x = trunkX - 22, y = BASE - 70;
      return `<path d="M${x + 14} ${y + 6}H${trunkX - 4}" stroke="#5E4129" stroke-width="2"/><path d="M${x - 2} ${y - 4}L${x + 9} ${y - 14}L${x + 20} ${y - 4}Z" fill="#9E4A30"/><rect x="${x}" y="${y - 4}" width="18" height="16" fill="url(#${id}-wood)"/><circle cx="${x + 9}" cy="${y + 3}" r="3" fill="#2E2014"/><path d="M${x + 9} ${y + 7}V${y + 10}" stroke="#5E4129" stroke-width="1.4"/>`;
    }
    case 'bench':
      return `<g transform="translate(-270 -8)"><ellipse cx="338" cy="${BASE + 2}" rx="28" ry="3.5" fill="url(#${id}-shadow)"/><rect x="312" y="${BASE - 22}" width="52" height="5" rx="1.5" fill="url(#${id}-wood)"/><rect x="312" y="${BASE - 14}" width="52" height="5" rx="1.5" fill="url(#${id}-wood)"/><path d="M317 ${BASE - 9}V${BASE}M359 ${BASE - 9}V${BASE}M317 ${BASE - 22}V${BASE - 28}M359 ${BASE - 22}V${BASE - 28}" stroke="#4A3220" stroke-width="2.6"/><rect x="314" y="${BASE - 32}" width="48" height="5" rx="1.5" fill="url(#${id}-wood)"/></g>`;
    case 'mushrooms':
      return `<path d="M112 ${BASE + 9}V${BASE}" stroke="#F1E6D2" stroke-width="5" stroke-linecap="round"/><path d="M104 ${BASE + 1}Q112 ${BASE - 12} 120 ${BASE + 1}Z" fill="#C7432F"/><circle cx="110" cy="${BASE - 4}" r="1.4" fill="#FFF"/><circle cx="115" cy="${BASE - 2}" r="1.1" fill="#FFF"/><path d="M124 ${BASE + 10}V${BASE + 4}" stroke="#F1E6D2" stroke-width="3.6" stroke-linecap="round"/><path d="M119 ${BASE + 5}Q124 ${BASE - 3} 129 ${BASE + 5}Z" fill="#D25A3A"/>`;
    case 'fence': {
      let s = `<path d="M40 ${TOP + 4}H120M280 ${TOP + 4}H360M40 ${TOP - 4}H120M280 ${TOP - 4}H360" stroke="#C9A77E" stroke-width="2.4"/>`;
      for (const x0 of [40, 280]) for (let i = 0; i < 6; i++) { const x = x0 + i * 16; s += `<path d="M${x} ${TOP + 8}V${TOP - 12}L${x + 3} ${TOP - 15}L${x + 6} ${TOP - 12}V${TOP + 8}Z" fill="#E3C9A2" stroke="#A9865E" stroke-width=".6"/>`; }
      return s;
    }
    case 'pond':
      return `<ellipse cx="350" cy="${BASE + 10}" rx="20" ry="5" fill="#5E8FA6"/><ellipse cx="350" cy="${BASE + 9.5}" rx="16" ry="3.6" fill="url(#${id}-water)" opacity=".9"/><ellipse cx="345" cy="${BASE + 8.5}" rx="6" ry="1.4" fill="#FFFFFF" opacity=".5"/><circle cx="358" cy="${BASE + 9}" r="2.8" fill="#5E9A4E"/><path d="M358 ${BASE + 9}L361 ${BASE + 7}" stroke="#5E9A4E" stroke-width="1"/>`;
    default: return '';
  }
}

/* ── Scène ────────────────────────────────────────────────────────────────────────────────────── */

export function buildCinematicScene(state: TreeState, o: SceneOptions & SceneExtras): Scene {
  const id = o.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const season: Season = o.season ?? 'summer';
  const decor = new Set(o.decor ?? []);
  const viewBox = o.viewBox ?? DEFAULT_VIEWBOX;
  const g = state.growth, sprout = g < .27;
  const R = 46 + Math.max(0, (g - .27) / .73) * 74;
  /* Le feuillage ne sort jamais du cadre : on raccourcit le tronc plutôt que de couper la cime. */
  const H = Math.min(56 + Math.max(0, (g - .27) / .73) * 74, BASE + 4 - R * 1.45);
  const yM = (m: number) => FRONT + 18 + Math.min(m, 6) / 6 * 122;
  const rootDepth = state.roots.beyondSix ? 150 : 24 + state.roots.depth * 122;
  const hot: Hotspot[] = [];
  const rand = rng(1234);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs(id, season)}`;

  // ── Ciel et météo de saison ──
  if (o.sky !== false) {
    s += `<rect x="-20" y="-40" width="440" height="520" fill="url(#${id}-sky)"/>`;
    const sunOp = season === 'autumn' ? .55 : season === 'winter' ? .6 : 1;
    s += `<circle cx="318" cy="46" r="62" fill="url(#${id}-sun)" opacity="${sunOp}"/><circle cx="318" cy="46" r="24" fill="#FFF3D0" opacity="${sunOp}"/>`;
    const cloud = (x: number, y: number, k: number, c: string, op: number) => `<g opacity="${op}"><ellipse cx="${x}" cy="${y}" rx="${26 * k}" ry="${10 * k}" fill="${c}"/><ellipse cx="${x - 12 * k}" cy="${y - 6 * k}" rx="${13 * k}" ry="${10 * k}" fill="${c}"/><ellipse cx="${x + 8 * k}" cy="${y - 9 * k}" rx="${15 * k}" ry="${12 * k}" fill="${c}"/></g>`;
    if (season === 'spring') s += cloud(90, 40, 1, '#FFFFFF', .85) + cloud(220, 22, .7, '#FFFFFF', .7);
    if (season === 'summer') s += cloud(80, 34, .7, '#FFFFFF', .6);
    if (season === 'autumn') s += cloud(80, 36, 1.3, '#E4E6E6', .95) + cloud(210, 20, 1.1, '#D8DCDD', .95) + cloud(330, 50, 1.2, '#E4E6E6', .9);
    if (season === 'winter') s += cloud(100, 30, 1.2, '#F4F6F8', .9) + cloud(260, 18, 1, '#EEF1F4', .9);
    if (season === 'autumn') for (let i = 0; i < 46; i++) { const x = rand() * 420 - 10, y = rand() * 220 - 10; s += `<path d="M${f(x)} ${f(y)}l-3 9" stroke="#8FA3B0" stroke-width=".9" opacity=".45" stroke-linecap="round"/>`; }
  }

  // ── Coupe de terre : couches, terre, cailloux ──
  s += `<ellipse cx="200" cy="${BOTTOM + 10}" rx="170" ry="12" fill="url(#${id}-shadow)"/>`;
  const front = `M28 ${FRONT}L28 ${BOTTOM - 26}Q28 ${BOTTOM} 56 ${BOTTOM}L344 ${BOTTOM}Q372 ${BOTTOM} 372 ${BOTTOM - 26}L372 ${FRONT}Z`;
  s += `<clipPath id="${id}-front"><path d="${front}"/></clipPath><path d="${front}" fill="url(#${id}-soil)"/><g clip-path="url(#${id}-front)">`;
  [[FRONT + 56, '#6A4A31'], [FRONT + 108, '#5E4028']].forEach(([y, c]) => { s += `<path d="M20 ${y}Q120 ${(y as number) - 6} 200 ${y}T380 ${(y as number) - 2}V${(y as number) + 30}Q280 ${(y as number) + 24} 200 ${(y as number) + 30}T20 ${(y as number) + 26}Z" fill="${c}" opacity=".45"/>`; });
  for (let i = 0; i < 300; i++) { const x = 28 + rand() * 344, y = FRONT + 4 + rand() * (BOTTOM - FRONT - 8); s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(.5 + rand() * 1.5)}" fill="${['#A98463', '#4A3220', '#C2A483', '#6A4A30', '#8E7058'][i % 5]}" opacity=".75"/>`; }
  for (let i = 0; i < 34; i++) { const x = 40 + rand() * 320, y = FRONT + 14 + rand() * 120; s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(2 + rand() * 3)}" ry="${f(1.6 + rand() * 2)}" fill="url(#${id}-stone)" opacity=".85"/>`; }
  for (let i = 0; i < 46; i++) { const x = 30 + (i % 23) * 15 + rand() * 6, y = BOTTOM - 22 + Math.floor(i / 23) * 11 + rand() * 4; s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(5 + rand() * 4)}" ry="${f(3.6 + rand() * 2)}" fill="url(#${id}-stone)"/>`; }
  if (state.roots.beyondSix) s += `<ellipse cx="200" cy="${BOTTOM - 24}" rx="${f(70 + Math.min(1, state.roots.extraMonths / 36) * 90)}" ry="16" fill="url(#${id}-nappe)"/>`;
  // racines : formes pleines qui s'affinent, larges au pied, de plus en plus fines en profondeur
  const rootPaths: string[] = [];
  const seg = (x: number, y: number, ang: number, len: number, w0: number, w1: number) => {
    const bend = (rand() - .5) * .5;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    const cxm = (x + x2) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * .35, cym = (y + y2) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * .35;
    const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
    const d = `M${f(x + nx * w0 / 2)} ${f(y + ny * w0 / 2)}Q${f(cxm + nx * (w0 + w1) / 4)} ${f(cym + ny * (w0 + w1) / 4)} ${f(x2 + nx * w1 / 2)} ${f(y2 + ny * w1 / 2)}L${f(x2 - nx * w1 / 2)} ${f(y2 - ny * w1 / 2)}Q${f(cxm - nx * (w0 + w1) / 4)} ${f(cym - ny * (w0 + w1) / 4)} ${f(x - nx * w0 / 2)} ${f(y - ny * w0 / 2)}Z`;
    rootPaths.push(`<path d="${d}" fill="#A9825E"/><circle cx="${f(x2)}" cy="${f(y2)}" r="${f(w1 / 2)}" fill="#A9825E"/>`);
    if (w0 > 2.2) rootPaths.push(`<path d="M${f(x - nx * w0 * .25)} ${f(y - ny * w0 * .25)}Q${f(cxm - nx * (w0 + w1) * .13)} ${f(cym - ny * (w0 + w1) * .13)} ${f(x2 - nx * w1 * .25)} ${f(y2 - ny * w1 * .25)}" stroke="#DCC09C" stroke-width="${f(Math.max(.6, w0 * .22))}" fill="none" stroke-linecap="round" opacity=".85"/>`);
    return [x2, y2, cxm, cym] as const;
  };
  const grow = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    const w1 = Math.max(.6, w * .62);
    const [x2, y2] = seg(x, y, ang, len, w, w1);
    if (depth <= 0 || w1 < 1.6) return;
    grow(x2, y2, ang + (rand() - .5) * .35, len * .82, w1, depth - 1);
    if (rand() > .45) grow(x2, y2, ang + (rand() > .5 ? .5 : -.5) + (rand() - .5) * .2, len * .62, w1 * .7, depth - 1);
    if (depth >= 4 && rand() > .7) grow(x2, y2, ang + (rand() > .5 ? .9 : -.9), len * .45, w1 * .5, depth - 2);
  };
  // éventail large, comme sur un vrai arbre : les racines extérieures partent presque à l'horizontale
  const mains = [-1.25, -.95, -.62, -.3, 0, .3, .62, .95, 1.25];
  mains.forEach((d, i) => grow(200 + d * 14, FRONT - 2, Math.PI / 2 + d * .9, rootDepth * (.5 - Math.abs(d) * .07), 16 - Math.abs(d) * 5, i % 2 ? 3 : 4));
  s += rootPaths.join('');
  if (state.drip.roots) s += `<path d="M200 ${FRONT}V${FRONT + 30}" stroke="#8ED0EA" stroke-width="2.4" stroke-dasharray="3 5" stroke-linecap="round" opacity=".9"/>`;
  // repères 1, 3, 6 mois (étiquettes en bois)
  if (o.marks !== false) ([[1, state.roots.marks.one], [3, state.roots.marks.three], [6, state.roots.marks.six]] as [number, boolean][]).forEach(([m, ok]) => {
    const y = yM(m);
    s += `<path d="M40 ${f(y)}H300" stroke="#F4E6CC" stroke-width="1.4" stroke-dasharray="4 6" stroke-linecap="round" opacity="${ok ? .9 : .45}"/><rect x="304" y="${f(y - 12)}" width="60" height="24" rx="7" fill="url(#${id}-wood)" stroke="#8C6442" stroke-width="1"/><text x="334" y="${f(y + 4.5)}" text-anchor="middle" font-family="Nunito_800ExtraBold, Nunito, sans-serif" font-size="12.5" fill="${ok ? '#3E2A17' : '#6E5639'}">${m} mois</text>`;
  });
  s += `</g><path d="${front}" fill="url(#${id}-soilSide)"/>`;
  hot.push({ part: 'roots', x: 28, y: FRONT + 6, w: 344, h: BOTTOM - FRONT - 6 });

  // ── Plateau d'herbe ──
  s += `<path d="M26 ${FRONT + 4}V${TOP + 30}Q28 ${TOP} 72 ${TOP}H328Q372 ${TOP} 374 ${TOP + 30}V${FRONT + 4}Q374 ${FRONT + 12} 360 ${FRONT + 12}H40Q26 ${FRONT + 12} 26 ${FRONT + 4}Z" fill="url(#${id}-grassTop)"/>`;
  s += `<path d="M26 ${FRONT}Q26 ${FRONT + 12} 40 ${FRONT + 12}H360Q374 ${FRONT + 12} 374 ${FRONT}V${FRONT + 6}Q374 ${FRONT + 16} 360 ${FRONT + 16}H40Q26 ${FRONT + 16} 26 ${FRONT + 6}Z" fill="#86AE45"/>`;
  [[96, BASE + 4], [276, BASE - 22], [120, BASE - 24], [300, BASE + 12]].forEach(([x, y]) => { for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k - 1) * 2.1; s += `<circle cx="${f(x + Math.cos(a) * 3)}" cy="${f(y + Math.sin(a) * 3)}" r="3.2" fill="#5E9A42"/>`; } s += `<path d="M${x} ${y}v6" stroke="#4E7F36" stroke-width="1"/>`; });
  s += `<path d="M44 ${TOP + 8}Q200 ${TOP + 2} 356 ${TOP + 8}" stroke="#FFFFFF" stroke-width="3" fill="none" opacity=".35" stroke-linecap="round"/>`;
  for (let i = 0; i < 26; i++) { const x = 50 + rand() * 300, y = TOP + 10 + rand() * (FRONT - TOP - 20); s += `<path d="M${f(x)} ${f(y)}l1.2 -4M${f(x + 2)} ${f(y)}l-.6 -3.4" stroke="#7FAE45" stroke-width="1" stroke-linecap="round" opacity=".7"/>`; }
  for (let i = 0; i < 0; i++) { const x = 30 + i * 4.9 + rand() * 2, h = 4 + rand() * 6; s += `<path d="M${f(x)} ${FRONT + 4}q${f(rand() * 2 - 1)} ${f(-h * .6)} ${f(rand() * 3 - 1.5)} ${f(-h)}" stroke="${i % 3 ? '#5E8F33' : '#87B84E'}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`; }
  if (season === 'winter') s += `<path d="M30 ${FRONT - 4}V${TOP + 26}Q32 ${TOP + 1} 70 ${TOP + 1}H330Q368 ${TOP + 1} 370 ${TOP + 26}V${FRONT - 4}Q300 ${FRONT - 1} 200 ${FRONT - 3}Q100 ${FRONT - 1} 30 ${FRONT - 4}Z" fill="#FBFDFF" opacity=".92"/>`;
  if (decor.has('fence')) s += decorItem(id, 'fence', 0, 0, R, 200);

  if (decor.has('bench')) s += decorItem(id, 'bench', 0, 0, R, 200);
  // ── Arrosoir en verre (l'eau = le Relyka) ──
  s += wateringCan(id, 54, BASE, state.water);
  hot.push({ part: 'can', x: 44, y: BASE - 80, w: 104, h: 86 });
  if (state.drip.roots || state.drip.branches) s += `<path d="M112 ${BASE + 1}Q156 ${BASE + 9} 194 ${BASE + 2}" stroke="#2F4A2A" stroke-width="3.6" fill="none" stroke-linecap="round"/><path d="M112 ${BASE}Q156 ${BASE + 8} 194 ${BASE + 1}" stroke="#5E7F4E" stroke-width="1" fill="none" stroke-linecap="round" opacity=".7"/>`;
  if (decor.has('mushrooms')) s += decorItem(id, 'mushrooms', 0, 0, R, 200);

  // ── Fleurs du confort ──
  FLOWERS.slice(0, state.flowers).forEach(([x, y], i) => { s += flower(id, x, y, i); });
  if (state.flowers > 0) { const xs = FLOWERS.slice(0, state.flowers).map(([x]) => x); hot.push({ part: 'flowers', x: Math.min(...xs) - 12, y: BASE - 30, w: Math.max(...xs) - Math.min(...xs) + 24, h: 38 }); }

  const bramble = (d: string) => `<path d="${d}" stroke="#4A2340" stroke-width="3.6" fill="none" stroke-linecap="round"/><path d="${d}" stroke="#7A4766" stroke-width="1" fill="none" stroke-linecap="round" opacity=".7"/>`;
  const trunkX = 200;
  let canopyTop = BASE - 60;

  if (sprout) {
    const hh = 26 + g * 70;
    s += `<path d="M200 ${BASE}Q196 ${f(BASE - hh * .5)} 202 ${f(BASE - hh)}" stroke="#4E7F36" stroke-width="3.4" fill="none" stroke-linecap="round"/><path transform="translate(202 ${f(BASE - hh)}) rotate(-38)" d="${leafPath(20 + g * 30, 7 + g * 9)}" fill="#5E9A42"/><path transform="translate(202 ${f(BASE - hh)}) rotate(-148)" d="${leafPath(17 + g * 26, 6 + g * 8)}" fill="#4E8A38"/>`;
    if (state.fruits > 0) s += apple(id, 213, BASE - hh * .55, 5.5, state.ripe ? 'apple' : 'appleYoung');
    hot.push({ part: 'tree', x: 170, y: BASE - hh - 30, w: 60, h: hh + 34 });
    canopyTop = BASE - hh;
    if (state.brambles > 0) { s += bramble(`M150 ${BASE}Q156 ${BASE - 26} 168 ${BASE - 12}Q176 ${BASE - 2} 184 ${BASE - 18}`) + bramble(`M250 ${BASE}Q244 ${BASE - 26} 232 ${BASE - 12}Q224 ${BASE - 2} 216 ${BASE - 18}`); hot.push({ part: 'brambles', x: 140, y: BASE - 34, w: 120, h: 40 }); }
    if (state.cabin) { s += cabin(id, 318, BASE - 4, 44, state.cabin.progress, BASE); hot.push({ part: 'cabin', x: 306, y: BASE - 74, w: 66, h: 78 }); }
  } else {
    const top = BASE - H, wB = 18 + g * 30, wT = wB * .55, cx = trunkX, cy = top - R * .45;
    canopyTop = cy - R;
    // ombre du feuillage sur l'herbe
    s += `<ellipse cx="${f(cx + 10)}" cy="${BASE + 2}" rx="${f(R * 1.05)}" ry="${f(R * .16)}" fill="url(#${id}-canopyShadow)"/>`;
    // tronc : évasement au pied, écorce
    s += `<path d="M${f(cx - wB / 2 - 9)} ${BASE + 2}Q${f(cx - wB / 2)} ${BASE - 2} ${f(cx - wB / 2 + 1)} ${BASE - 14}C${f(cx - wB / 2 + 3)} ${f(BASE - H * .5)} ${f(cx - wT / 2 - 3)} ${f(BASE - H * .8)} ${f(cx - wT / 2)} ${f(top - 10)}L${f(cx + wT / 2)} ${f(top - 10)}C${f(cx + wT / 2 + 3)} ${f(BASE - H * .8)} ${f(cx + wB / 2 - 3)} ${f(BASE - H * .5)} ${f(cx + wB / 2 - 1)} ${BASE - 14}Q${f(cx + wB / 2)} ${BASE - 2} ${f(cx + wB / 2 + 9)} ${BASE + 2}Z" fill="url(#${id}-bark)"/>`;
    for (let i = 0; i < 12; i++) { const x0 = cx - wB * .4 + i * wB * .07; s += `<path d="M${f(x0)} ${BASE - 6}Q${f(x0 + (rand() - .5) * 4)} ${f(BASE - H * .45)} ${f(cx - wT * .3 + i * wT * .1)} ${f(top)}" stroke="#3A2919" stroke-width="${f(.6 + rand() * .7)}" fill="none" opacity=".55"/>`; }
    if (state.drip.branches) s += `<path d="M${f(cx + wB / 2 + 2)} ${BASE - 2}C${f(cx + wB / 2 + 6)} ${f(BASE - H * .4)} ${f(cx + wT / 2 + 4)} ${f(BASE - H * .7)} ${f(cx + wT / 2 + 3)} ${f(top + 2)}" stroke="#8ED0EA" stroke-width="2" stroke-dasharray="3 5" fill="none" stroke-linecap="round"/>`;
    if (decor.has('birdhouse')) s += decorItem(id, 'birdhouse', cx, top, R, cx - wB / 2);
    if (state.brambles > 0) {
      const hb = H * (.25 + .55 * state.brambles), n = Math.round(3 + state.brambles * 4);
      let d = `M${f(cx - wB * .9)} ${BASE}`;
      for (let i = 1; i <= n; i++) { const yy = BASE - hb * i / n; d += `Q${f(cx)} ${f(yy + hb / n * .2)} ${f(i % 2 ? cx + wB * .85 : cx - wB * .85)} ${f(yy)}`; }
      s += bramble(d);
      for (let i = 1; i <= n * 2; i++) { const yy = BASE - hb * i / (n * 2); s += `<path d="M${f(cx + (i % 2 ? wB * .7 : -wB * .7))} ${f(yy)}l${i % 2 ? 4 : -4} -3" stroke="#3A1A30" stroke-width="1.2" stroke-linecap="round"/>`; }
      hot.push({ part: 'brambles', x: cx - wB - 10, y: BASE - hb - 6, w: wB * 2 + 20, h: hb + 10 });
    }
    // feuillage : volumes sombres, puis centaines de feuilles éclairées depuis le haut à gauche
    if (o.glow) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 1.6)}" fill="url(#${id}-glow)"/>`;
    const ramp = LEAF_RAMPS[season];
    // masse sombre du houppier (les « trous » entre les grappes restent dans l'ombre)
    s += `<ellipse cx="${f(cx)}" cy="${f(cy + R * .06)}" rx="${f(R * .97)}" ry="${f(R * .88)}" fill="${ramp[1]}"/>`;
    // grappes : intérieur + couronne, pour une silhouette bosselée
    const clusters: [number, number, number, number][] = [];
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 + rand() * .2; clusters.push([Math.cos(a) * .8, Math.sin(a) * .74, .26 + rand() * .06, 0]); }
    for (let i = 0; i < 18; i++) { let px = 0, py = 0; for (let t = 0; t < 6; t++) { px = rand() * 1.4 - .7; py = rand() * 1.3 - .65; if (px * px + py * py < .5) break; } clusters.push([px, py, .28 + rand() * .08, 0]); }
    // lumière de chaque grappe sur la boule : en haut à gauche = éclairée
    clusters.forEach((c) => { const nz = Math.sqrt(Math.max(0, 1 - c[0] * c[0] - c[1] * c[1])); c[3] = Math.max(0, Math.min(1, (-c[0] * .5 - c[1] * .62 + nz * .6 + .3) / 1.2)); });
    clusters.sort((p, q) => p[3] - q[3]);
    const L = 7 + R * .055;
    clusters.forEach(([px, py, k, lit]) => {
      const gx = cx + px * R, gy = cy + py * R * .92, rc = k * R;
      // volume de la grappe (sombre en bas à droite)
      s += `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f(rc)}" fill="url(#${id}-clump${lit > .62 ? 'Hi' : lit > .35 ? '' : 'Lo'})"/>`;
      const n = 7 + Math.round(rc / 9);
      const ls: [number, number, number, number, number][] = [];
      for (let j = 0; j < n; j++) {
        let lx = 0, ly = 0; for (let t = 0; t < 5; t++) { lx = rand() * 1.6 - 1.1; ly = rand() * 1.6 - 1.1; if (lx * lx + ly * ly < .9) break; }
        const lnz = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly));
        const local = Math.max(0, Math.min(1, (-lx * .55 - ly * .7 + lnz * .5 + .3) / 1.25));
        const shade = Math.max(0, Math.min(4, Math.round((lit * .55 + local * .45) * 4.2 + (rand() - .5) * .9)));
        ls.push([gx + lx * rc * .95, gy + ly * rc * .95, rand() * 360, shade, .8 + rand() * .45]);
      }
      ls.sort((p, q) => p[3] - q[3]).forEach(([x, y, rot, sh, kk]) => { s += `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(kk)})" d="${leafPath(L, L * .44)}" fill="${ramp[sh]}"/>`; });
      if (season === 'winter' && lit > .55) s += `<ellipse cx="${f(gx - rc * .1)}" cy="${f(gy - rc * .62)}" rx="${f(rc * .7)}" ry="${f(rc * .28)}" fill="#FFFFFF" opacity=".92"/>`;
    });
    if (season === 'spring') for (let i = 0; i < 26; i++) { let px = rand() * 2 - 1, py = rand() * 2 - 1; if (px * px + py * py > 1) { px *= .7; py *= .7; } const x = cx + px * R, y = cy + py * R * .86; for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; s += `<circle cx="${f(x + Math.cos(a) * 2.2)}" cy="${f(y + Math.sin(a) * 2.2)}" r="1.8" fill="${k % 2 ? '#FFFFFF' : '#F9D3E1'}"/>`; } s += `<circle cx="${f(x)}" cy="${f(y)}" r="1" fill="#E8B23A"/>`; }
    // fruits = placements
    const fr = (state.fruits <= 3 ? 10.5 : state.fruits <= 6 ? 8.8 : 7.6) + 2 * state.branches;
    FRUITS.slice(0, state.fruits).forEach(([dx, dy], i) => {
      const gold = state.fruitTier >= 10 && i < 3;
      s += apple(id, cx + dx * R, cy + dy * R, fr, gold ? 'appleGold' : state.ripe ? 'apple' : 'appleYoung');
      if (gold) s += `<path d="M${f(cx + dx * R + fr * 1.3)} ${f(cy + dy * R - fr * 1.6)}l2 -5l2 5l5 2l-5 2l-2 5l-2 -5l-5 -2Z" fill="#FFE07A"/>`;
    });
    if (decor.has('lantern')) s += decorItem(id, 'lantern', cx, cy, R, cx);
    hot.push({ part: 'tree', x: cx - R * 1.1, y: cy - R, w: R * 2.2, h: BASE - (cy - R) });
    if (state.cabin) {
      const cw = Math.max(46, R * .7), cxx = cx + R * .14, cyy = Math.min(cy + R * .52, BASE - 34);
      s += cabin(id, cxx, cyy, cw, state.cabin.progress, BASE - 1);
      hot.push({ part: 'cabin', x: cxx - 8, y: cyy - cw * 1.15, w: cw * 1.3, h: cw * 1.25 });
    }
    if (o.glow) ([[-1.2, -.55, 9], [1.15, -.75, 7], [1, .35, 6], [0, -1.25, 8]] as [number, number, number][]).forEach(([dx, dy, r]) => { s += `<path d="M${f(cx + dx * R)} ${f(cy + dy * R - r)}Q${f(cx + dx * R + r * .18)} ${f(cy + dy * R - r * .18)} ${f(cx + dx * R + r)} ${f(cy + dy * R)}Q${f(cx + dx * R + r * .18)} ${f(cy + dy * R + r * .18)} ${f(cx + dx * R)} ${f(cy + dy * R + r)}Q${f(cx + dx * R - r * .18)} ${f(cy + dy * R + r * .18)} ${f(cx + dx * R - r)} ${f(cy + dy * R)}Q${f(cx + dx * R - r * .18)} ${f(cy + dy * R - r * .18)} ${f(cx + dx * R)} ${f(cy + dy * R - r)}Z" fill="#FFD460"/>`; });
  }

  // ── Panier de récolte (5 placements et plus) ──
  if (state.fruitTier >= 5) {
    const bx = 128, by = BASE + 8, kind = state.ripe ? 'apple' : 'appleYoung';
    s += `<ellipse cx="${bx}" cy="${by + 2}" rx="20" ry="4" fill="url(#${id}-shadow)"/>`;
    ([[-8, -13], [0, -16], [8, -13], [-4, -20], [4, -20]] as [number, number][]).slice(0, state.fruitTier >= 10 ? 5 : 3).forEach(([dx, dy]) => { s += apple(id, bx + dx, by + dy, 5, kind); });
    s += `<path d="M${bx - 17} ${by - 12}H${bx + 17}L${bx + 13} ${by}H${bx - 13}Z" fill="#B88A50"/><path d="M${bx - 15.5} ${by - 8}H${bx + 15.5}M${bx - 14.5} ${by - 4}H${bx + 14.5}" stroke="#8C6234" stroke-width="1.2"/><path d="M${bx - 18} ${by - 12}H${bx + 18}" stroke="#D9AE72" stroke-width="2.6" stroke-linecap="round"/>`;
  }

  // ── Automne : quelques feuilles posées sur l'herbe ; hiver : flocons ──
  if (season === 'autumn') for (let i = 0; i < 12; i++) { const x = 60 + rand() * 290, y = TOP + 6 + rand() * 20; s += `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rand() * 360)})" d="${leafPath(6, 2.6)}" fill="${LEAF_RAMPS.autumn[2 + (i % 3)]}" opacity=".9"/>`; }

  // ── Décor posé au sol ──
  if (decor.has('pond')) s += decorItem(id, 'pond', 0, 0, R, trunkX);

  if (o.rain) ([[110, 40], [150, 70], [190, 30], [230, 62], [270, 36], [310, 76], [130, 110], [250, 104]] as [number, number][]).forEach(([x, y]) => { s += `<path transform="translate(${x} ${y})" d="M0-9C3-4 5-1 5 2A5 5 0 0 1-5 2C-5-1-3-4 0-9Z" fill="#6FB9DE"/>`; });

  // ── Pépin ──
  if (o.mascot !== false) {
    const px = !state.cabin ? 252 : sprout ? 236 : 286;
    s += `<g transform="translate(${px} ${BASE + 3}) scale(1.22) translate(${-px} ${-(BASE + 3)})">${hedgehog(id, px, BASE + 3, o.mood ?? 'happy', o.outfit)}</g>`;
    hot.push({ part: 'pico', x: px - 4, y: BASE - 56, w: 80, h: 60 });
  }
  if (season === 'winter') for (let i = 0; i < 60; i++) { const x = rand() * 420 - 10, y = -20 + rand() * (canopyTop + 60); s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(.8 + rand() * 1.6)}" fill="#FFFFFF" opacity="${f(.6 + rand() * .4)}"/>`; }
  return { svg: s + '</svg>', viewBox, hotspots: hot };
}


/**
 * Portrait de Pépin hors du jardin (onglet, bulles, conseils) : le MÊME dessin que dans la scène,
 * avec ses propres dégradés. `avatar` : en médaillon, cadré sur la tête.
 */
export function pepinSvg(uid: string, mood: 'happy' | 'joy' | 'thinking' = 'happy', outfit: SceneExtras['outfit'] = {}, avatar = false): string {
  const id = 'pp' + uid.replace(/[^a-zA-Z0-9]/g, '');
  const d = `<defs><radialGradient id="${id}-shadow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#1E1A12" stop-opacity="0.32"/><stop offset="1" stop-color="#1E1A12" stop-opacity="0"/></radialGradient><radialGradient id="${id}-cream" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#FBF1E1"/><stop offset="0.7" stop-color="#E9D3B4"/><stop offset="1" stop-color="#C7A985"/></radialGradient><radialGradient id="${id}-nose" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#5A5A5A"/><stop offset="0.4" stop-color="#1E1E1E"/><stop offset="1" stop-color="#000000"/></radialGradient><radialGradient id="${id}-pelt" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="#9C7B5C"/><stop offset="0.55" stop-color="#6E5039"/><stop offset="1" stop-color="#3E2C1F"/></radialGradient></defs>`;
  const body = hedgehog(id, 0, 0, mood, outfit);
  return avatar
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${d}<circle cx="32" cy="32" r="32" fill="#F3E8D6"/><clipPath id="${id}-c"><circle cx="32" cy="32" r="32"/></clipPath><g clip-path="url(#${id}-c)"><g transform="translate(-8 58) scale(0.98)">${body}</g></g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -60 92 70">${d}${body}</svg>`;
}
