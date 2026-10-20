/**
 * Dessin du jardin en « 3D douce » : un TreeState → une chaîne SVG + les zones touchables.
 *
 * Fonction PURE (aucun import React Native) : testable en node, et rendue par `SvgXml` dans
 * components/garden/GardenScene. Le style est celui validé sur l'artefact « Jardin en 3D douce » :
 * volumes par dégradés radiaux, reflets, ombres de contact, île en tranche de terre.
 *
 * ⚠️ AUCUN FILTRE SVG (flou, ombre portée…). Leur prise en charge varie entre Android, iOS et le
 * web ; un filtre non pris en charge peut faire disparaître l'élément qui le porte. Les ombres et
 * halos sont donc des ellipses à dégradé radial transparent, rendues partout à l'identique.
 *
 * Coordonnées : repère fixe 400 × 470 (viewBox par défaut `0 -20 400 470`), herbe avant à y = 262.
 */
import type { TreeState } from './treeState';
import type { Season } from './season';

export interface SceneOptions {
  /** Préfixe unique des identifiants de dégradés (plusieurs scènes sur un écran). */
  id: string;
  sky?: boolean;
  /** Traits 1 / 3 / 6 mois dans la terre. */
  marks?: boolean;
  mascot?: boolean;
  mood?: 'happy' | 'joy';
  /** Halo doré et étincelles (palier franchi). */
  glow?: boolean;
  /** Averse (un virement d'épargne vient d'être enregistré). */
  rain?: boolean;
  /** Saison du dessin (feuillage, fleurs, neige). Absente = été. */
  season?: Season;
  viewBox?: string;
  label?: string;
}

export type HotspotPart = 'can' | 'roots' | 'tree' | 'cabin' | 'brambles' | 'flowers' | 'pico';

export interface Hotspot { part: HotspotPart; x: number; y: number; w: number; h: number }

export interface Scene { svg: string; viewBox: string; hotspots: Hotspot[] }

const f = (n: number) => Math.round(n * 10) / 10;
const GY = 262;
const BASE = GY - 8;
const DEFAULT_VIEWBOX = '0 -20 400 470';

const BLOBS: [number, number, number][] = [[0, 0, .6], [-.55, .15, .44], [.56, .12, .46], [-.3, -.38, .46], [.32, -.4, .44], [0, -.62, .38], [-.78, -.12, .3], [.8, -.1, .3], [-.38, .42, .36], [.42, .42, .36], [0, .35, .42]];
const FRUITS: [number, number][] = [[-.45, .12], [.5, .2], [.12, -.35], [-.15, .36], [.62, -.25], [-.6, -.3], [.3, .46], [-.35, -.56], [.36, -.04], [-.02, .06], [-.72, .26], [.74, .32]];
const ROOTS: [number, number, number][] = [[0, 1, 9], [-26, .8, 7], [28, .76, 7], [-52, .52, 5], [56, .5, 5], [-12, .64, 4], [14, .6, 4]];
const ROOTS_DEEP: [number, number, number][] = [[-38, .95, 4], [40, .92, 4], [-64, .7, 3.4], [68, .68, 3.4]];
const FLOWERS: [number, number][] = [[152, BASE + 1], [170, BASE + 7], [240, BASE + 6], [258, BASE + 1], [138, BASE + 8]];
const LEAF = 'M0 0C5-9 17-11 25-5C18 3 7 4 0 0Z';

function defs(id: string): string {
  const rg = (n: string, stops: [number, string, number?][], a = '') => `<radialGradient id="${id}-${n}" ${a}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('')}</radialGradient>`;
  const lg = (n: string, stops: [number, string, number?][], a: string) => `<linearGradient id="${id}-${n}" ${a}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`).join('')}</linearGradient>`;
  return `<defs>
${rg('sky', [[0, '#F7FCFA'], [1, '#DCEDE8']], 'cx="0.5" cy="0.25" r="0.9"')}
${rg('leaf', [[0, '#9BE27F'], [0.55, '#4FB866'], [1, '#237A4A']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('fruit', [[0, '#FFD2B8'], [0.45, '#FF915E'], [1, '#D9582C']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('leafSpring', [[0, '#C8EFA8'], [0.55, '#7CCB7A'], [1, '#3F9A5C']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('leafAutumn', [[0, '#FFD98A'], [0.5, '#E9A23B'], [1, '#B8641F']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('blossom', [[0, '#FFFFFF'], [0.6, '#FBD3E0'], [1, '#EE9BB8']], 'cx="0.35" cy="0.3" r="0.8"')}
${rg('fruitYoung', [[0, '#FFF8C8'], [0.5, '#F5D84A'], [1, '#C29A1E']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('fruitGold', [[0, '#FFF6CF'], [0.45, '#FFC93C'], [1, '#D08A12']], 'cx="0.35" cy="0.3" r="0.75"')}
${rg('petal', [[0, '#FFE3EC'], [0.6, '#F49AB8'], [1, '#D86A93']], 'cx="0.35" cy="0.3" r="0.8"')}
${rg('spec', [[0, '#FFFFFF', 0.9], [1, '#FFFFFF', 0]])}
${rg('shadow', [[0, '#1E3A2C', 0.32], [1, '#1E3A2C', 0]])}
${rg('canopyShadow', [[0, '#174D30', 0.35], [1, '#174D30', 0]])}
${rg('halo', [[0, '#FFF3C4', 0.95], [0.6, '#FFE9A0', 0.45], [1, '#FFE9A0', 0]])}
${rg('glowGold', [[0, '#FFD978', 0.7], [1, '#FFD978', 0]])}
${rg('nappe', [[0, '#FFF6D2'], [0.5, '#FFD978'], [1, '#E7A93A']], 'cx="0.4" cy="0.35" r="0.7"')}
${rg('spike', [[0, '#C79066'], [0.6, '#9A6440'], [1, '#6E4328']], 'cx="0.35" cy="0.3" r="0.8"')}
${rg('cream', [[0, '#FFF7EA'], [0.7, '#F6DDBC'], [1, '#E2BE92']], 'cx="0.4" cy="0.35" r="0.75"')}
${rg('can', [[0, '#F2FBFE'], [0.6, '#BFE5F0'], [1, '#86C6DA']], 'cx="0.3" cy="0.3" r="0.9"')}
${lg('water', [[0, '#8ED6F2'], [1, '#3E9DC8']], 'x1="0" y1="0" x2="0" y2="1"')}
${lg('bark', [[0, '#E2B486'], [0.45, '#B07D52'], [1, '#6E4529']], 'x1="0" y1="0" x2="1" y2="0"')}
${lg('wood', [[0, '#E9C496'], [1, '#A9784A']], 'x1="0" y1="0" x2="1" y2="0"')}
${lg('roof', [[0, '#E98E5E'], [1, '#B95A33']], 'x1="0" y1="0" x2="0" y2="1"')}
${lg('grass', [[0, '#B5EC93'], [1, '#6FC463']], 'x1="0" y1="0" x2="0" y2="1"')}
${lg('soil', [[0, '#B07A55'], [0.5, '#8E6143'], [1, '#6A452E']], 'x1="0" y1="0" x2="0" y2="1"')}
${lg('side', [[0, '#FFFFFF', 0.16], [0.35, '#FFFFFF', 0], [0.7, '#000000', 0], [1, '#000000', 0.22]], 'x1="0" y1="0" x2="1" y2="0"')}
${lg('root', [[0, '#FFE7A6'], [0.5, '#F5B73E'], [1, '#C98626']], 'x1="0" y1="0" x2="1" y2="1"')}
${lg('bramble', [[0, '#9A5E80'], [1, '#55284A']], 'x1="0" y1="0" x2="1" y2="1"')}
${lg('pipe', [[0, '#BFE8F6'], [1, '#6FB6CF']], 'x1="0" y1="0" x2="0" y2="1"')}
</defs>`;
}

const sphere = (id: string, cx: number, cy: number, r: number, fill = 'leaf') => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="url(#${id}-${fill})"/>`;
const spec = (id: string, cx: number, cy: number, rx: number, ry: number, op = 1) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#${id}-spec)" opacity="${op}"/>`;
const shadow = (id: string, cx: number, cy: number, rx: number, ry: number) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="url(#${id}-shadow)"/>`;
const sparkle = (x: number, y: number, r: number) => `<path d="M${f(x)} ${f(y - r)}Q${f(x + r * .18)} ${f(y - r * .18)} ${f(x + r)} ${f(y)}Q${f(x + r * .18)} ${f(y + r * .18)} ${f(x)} ${f(y + r)}Q${f(x - r * .18)} ${f(y + r * .18)} ${f(x - r)} ${f(y)}Q${f(x - r * .18)} ${f(y - r * .18)} ${f(x)} ${f(y - r)}Z" fill="#FFC93C"/>`;
const drop = (x: number, y: number, s: number) => `<path transform="translate(${f(x)} ${f(y)}) scale(${s})" d="M0-9C3-4 5-1 5 2A5 5 0 0 1-5 2C-5-1-3-4 0-9Z" fill="#5DB8E0"/>`;

function hedgehog(id: string, x: number, y: number, s: number, mood: 'happy' | 'joy'): string {
  const cx = 28, cy = -21, rx = 26, ry = 21, pts: string[] = [];
  for (let i = 0; i <= 24; i++) { const a = Math.PI * (.9 + i / 24 * 1.02), r = i % 2 ? .8 : 1.05; pts.push(`${f(cx + Math.cos(a) * rx * r)},${f(cy + Math.sin(a) * ry * r)}`); }
  pts.push('50,-6', '8,-4');
  const eye = mood === 'joy'
    ? '<path d="M44.5-20.5Q47-24 49.5-20.5" stroke="#2A3B33" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
    : '<ellipse cx="47" cy="-21" rx="3" ry="3.6" fill="#1E2A24"/><circle cx="48.2" cy="-22.6" r="1.3" fill="#FFFFFF"/>';
  const arms = mood === 'joy' ? `<path d="M33-14Q27-26 24-31" stroke="url(#${id}-cream)" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M50-14Q58-26 62-30" stroke="url(#${id}-cream)" stroke-width="6" stroke-linecap="round" fill="none"/>` : '';
  return `<g transform="translate(${x} ${y}) scale(${s})">${shadow(id, 32, 1, 34, 6)}<polygon points="${pts.join(' ')}" fill="url(#${id}-spike)" stroke="#8A5634" stroke-width="5" stroke-linejoin="round"/>${spec(id, 18, -34, 10, 5, .55)}<ellipse cx="24" cy="-1" rx="6" ry="3.4" fill="#D9AE82"/><ellipse cx="42" cy="-1" rx="6" ry="3.4" fill="#D9AE82"/><ellipse cx="41" cy="-14" rx="17" ry="12.5" fill="url(#${id}-cream)"/><ellipse cx="54" cy="-15" rx="9" ry="6.5" fill="url(#${id}-cream)"/>${arms}<circle cx="37" cy="-29" r="4.5" fill="url(#${id}-cream)"/><circle cx="37" cy="-29" r="2" fill="#F7A3B5"/><circle cx="62" cy="-16" r="3.6" fill="#1E2A24"/><circle cx="61" cy="-17.3" r="1.1" fill="#FFFFFF"/>${eye}<ellipse cx="50" cy="-11" rx="4" ry="2.4" fill="#F7A3B5" opacity="0.7"/><path d="M55-10Q57-7.5 59.5-10" stroke="#2A3B33" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M24-42L22-48" stroke="#2F8F58" stroke-width="1.8" stroke-linecap="round"/><g transform="translate(22 -48) rotate(-70) scale(0.8)"><path d="${LEAF}" fill="url(#${id}-leaf)"/></g></g>`;
}

function wateringCan(id: string, x: number, y: number, level: number): string {
  const lv = Math.max(0, Math.min(1, level)), wy = -4 - 36 * lv, body = 'M8 0L52 0Q56 0 56-4L52-40Q51-44 47-44L13-44Q9-44 8-40L4-4Q4 0 8 0Z';
  const water = lv > 0 ? `<g clip-path="url(#${id}-cn)"><rect x="0" y="${f(wy)}" width="60" height="60" fill="url(#${id}-water)" opacity="0.92"/><ellipse cx="30" cy="${f(wy)}" rx="30" ry="2.6" fill="#BEEBFA"/></g>` : '';
  return `<g transform="translate(${x} ${y})">${shadow(id, 34, 1, 40, 7)}<path d="M14-44C14-63 46-63 46-44" stroke="#7FC3D8" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M52-14L77-45" stroke="#7FC3D8" stroke-width="7.5" stroke-linecap="round"/><path d="M53-16L76-44" stroke="#D6F1F8" stroke-width="2" stroke-linecap="round"/><ellipse cx="79" cy="-47" rx="7.5" ry="5" transform="rotate(-40 79 -47)" fill="#6DB6CD"/><clipPath id="${id}-cn"><path d="${body}"/></clipPath><path d="${body}" fill="url(#${id}-can)"/>${water}<path d="M12-38L9.5-8" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.85"/></g>`;
}

/**
 * Cabane perchée (crédit sain) : un plancher sur sa poutre, des murs en planches HORIZONTALES qui
 * montent à mesure du remboursement (de 1 à 6 rangs), une porte puis une fenêtre, et le toit
 * quand le crédit est remboursé à 80 %. Une échelle descend jusqu'au sol (`groundY`).
 * (x, y) = coin gauche du plancher.
 */
function cabin(id: string, x: number, y: number, w: number, progress: number, groundY?: number): string {
  const p = Math.max(0, Math.min(1, progress));
  const h = w * 0.66, rows = 6, rh = h / rows, built = Math.max(1, Math.ceil(p * rows));
  let s = '';
  // Échelle (derrière le plancher) jusqu'au sol
  if (groundY != null && groundY > y + 8) {
    const lx = x + w * 0.12, rx = lx + 11;
    s += `<path d="M${f(lx)} ${f(y + 2)}L${f(lx - 2)} ${f(groundY)}M${f(rx)} ${f(y + 2)}L${f(rx + 2)} ${f(groundY)}" stroke="#8A5A36" stroke-width="2.6" stroke-linecap="round"/>`;
    for (let yy = y + 10; yy < groundY - 3; yy += 9) s += `<path d="M${f(lx - 1)} ${f(yy)}H${f(rx + 1)}" stroke="#B07D52" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  s += `<g transform="translate(${f(x)} ${f(y)})">`;
  // Ombre sous le plancher + jambes de force
  s += `<path d="M${f(w * .2)} ${f(w * .1)}L${f(w * .42)} ${f(w * .34)}M${f(w * .8)} ${f(w * .1)}L${f(w * .58)} ${f(w * .34)}" stroke="#7A4E2E" stroke-width="3" stroke-linecap="round"/>`;
  s += `<rect x="${f(-w * .1)}" y="0" width="${f(w * 1.2)}" height="${f(w * .11)}" rx="${f(w * .05)}" fill="#8A5A36"/><rect x="${f(-w * .1)}" y="0" width="${f(w * 1.2)}" height="${f(w * .035)}" rx="${f(w * .02)}" fill="#B98A5E"/>`;
  // Rangs de planches, du bas vers le haut
  for (let i = 0; i < built; i++) {
    const yy = -rh * (i + 1);
    s += `<rect x="0" y="${f(yy)}" width="${f(w)}" height="${f(rh - 0.8)}" rx="1.2" fill="url(#${id}-wood)"/>`;
    s += `<path d="M${f(w * (i % 2 ? .35 : .62))} ${f(yy + 1)}V${f(yy + rh - 1.6)}" stroke="#9B6B43" stroke-width="0.9" opacity="0.7"/>`;
  }
  // Porte (3 rangs), fenêtre (5 rangs)
  if (built >= 3) s += `<rect x="${f(w * .6)}" y="${f(-rh * 3)}" width="${f(w * .24)}" height="${f(rh * 3 - .8)}" rx="${f(w * .06)}" fill="#6E4529"/><circle cx="${f(w * .66)}" cy="${f(-rh * 1.5)}" r="1.2" fill="#F0B54A"/>`;
  if (built >= 5) s += `<rect x="${f(w * .14)}" y="${f(-rh * 4.6)}" width="${f(w * .26)}" height="${f(w * .22)}" rx="2" fill="#BFE5F0" stroke="#7A4E2E" stroke-width="2"/><path d="M${f(w * .27)} ${f(-rh * 4.6)}V${f(-rh * 4.6 + w * .22)}M${f(w * .14)} ${f(-rh * 4.6 + w * .11)}H${f(w * .4)}" stroke="#7A4E2E" stroke-width="1.4"/>`;
  // Toit
  if (p >= 0.8) {
    s += `<path d="M${f(-w * .16)} ${f(-h + 1)}L${f(w / 2)} ${f(-h - w * .44)}L${f(w * 1.16)} ${f(-h + 1)}Z" fill="url(#${id}-roof)"/>`;
    s += `<path d="M${f(-w * .16)} ${f(-h + 1)}L${f(w / 2)} ${f(-h - w * .44)}" stroke="#F4B08A" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`;
  }
  return s + '</g>';
}

/** Un fruit : la sphère, sa petite queue et sa feuille, et le reflet. */
function fruit(id: string, x: number, y: number, r: number, fill: string): string {
  return `<path d="M${f(x)} ${f(y - r * .9)}Q${f(x + r * .1)} ${f(y - r * 1.35)} ${f(x + r * .35)} ${f(y - r * 1.5)}" stroke="#6E4529" stroke-width="${f(Math.max(1.2, r * .16))}" fill="none" stroke-linecap="round"/>`
    + `<g transform="translate(${f(x + r * .3)} ${f(y - r * 1.4)}) rotate(-20) scale(${f(r / 22)})"><path d="${LEAF}" fill="url(#${id}-leaf)"/></g>`
    + sphere(id, x, y, r, fill) + spec(id, x - r * .35, y - r * .4, r * .4, r * .28);
}

/** Panier de récolte (palier 5+) au pied de l'arbre, rempli de fruits. */
function basket(id: string, x: number, y: number, n: number, fill: string): string {
  let s = shadow(id, x, y + 2, 20, 4);
  [[-8, -13], [0, -16], [8, -13], [-4, -20], [4, -20]].slice(0, n).forEach(([dx, dy]) => { s += sphere(id, x + dx, y + dy, 5.4, fill) + spec(id, x + dx - 2, y + dy - 2, 2, 1.4); });
  s += `<path d="M${x - 17} ${y - 12}L${x + 17} ${y - 12}L${x + 13} ${y}L${x - 13} ${y}Z" fill="#C98F55"/>`;
  s += `<path d="M${x - 15.5} ${y - 8}H${x + 15.5}M${x - 14.5} ${y - 4}H${x + 14.5}" stroke="#A86F3C" stroke-width="1.4"/><path d="M${x - 18} ${y - 12}H${x + 18}" stroke="#E2B27A" stroke-width="2.4" stroke-linecap="round"/>`;
  return s;
}

function flower(id: string, x: number, y: number, s: number): string {
  let p = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0Q-1-8 0-16" stroke="#3E9A5C" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M0-6C-5-9-9-8-10-5C-6-3-3-4 0-6Z" fill="#4FB866"/>`;
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 - Math.PI / 2; p += `<circle cx="${f(Math.cos(a) * 4.6)}" cy="${f(-18 + Math.sin(a) * 4.6)}" r="3.6" fill="url(#${id}-petal)"/>`; }
  return p + `<circle cx="0" cy="-18" r="2.6" fill="#FFD24D"/></g>`;
}

export function buildScene(state: TreeState, o: SceneOptions): Scene {
  const id = o.id.replace(/[^a-zA-Z0-9_-]/g, '');
  const g = state.growth, R = 34 + Math.max(0, (g - .27) / .73) * 71, H = 46 + Math.max(0, (g - .27) / .73) * 84;
  const sprout = g < .27;
  const yM = (m: number) => GY + 22 + Math.min(m, 6) / 6 * 116;
  const D = state.roots.beyondSix ? 152 : 18 + state.roots.depth * 116;
  const hot: Hotspot[] = [];
  const viewBox = o.viewBox ?? DEFAULT_VIEWBOX;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${defs(id)}`;

  if (o.sky !== false) s += `<rect x="-20" y="-40" width="440" height="520" fill="url(#${id}-sky)"/><circle cx="330" cy="40" r="46" fill="#FFE9A0" opacity="0.35"/><circle cx="330" cy="40" r="30" fill="#FFE07A"/>`;
  s += `<ellipse cx="200" cy="452" rx="160" ry="16" fill="url(#${id}-shadow)"/>`;

  // Tranche de terre
  const front = `M22 ${GY}L22 400Q22 440 70 442L330 442Q378 440 378 400L378 ${GY}Z`;
  s += `<clipPath id="${id}-front"><path d="${front}"/></clipPath><path d="${front}" fill="url(#${id}-soil)"/><g clip-path="url(#${id}-front)">`;
  s += `<path d="M0 ${GY + 120}Q100 ${GY + 108} 200 ${GY + 120}T400 ${GY + 116}V460H0Z" fill="#7A5137" opacity="0.6"/>`;
  [[70, GY + 52, 8, 5], [300, GY + 66, 10, 6], [118, GY + 104, 7, 4], [330, GY + 112, 8, 5], [255, GY + 96, 6, 4]].forEach(([x, y, rx, ry]) => { s += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#C59A74"/><ellipse cx="${f(x - rx * .3)}" cy="${f(y - ry * .35)}" rx="${f(rx * .45)}" ry="${f(ry * .35)}" fill="#E2C2A0" opacity="0.8"/>`; });
  if (state.roots.beyondSix) {
    const w = 80 + Math.min(1, Math.log(1 + state.roots.extraMonths) / Math.log(40)) * 210;
    s += `<ellipse cx="200" cy="424" rx="${f(w / 2 + 22)}" ry="26" fill="url(#${id}-glowGold)"/><ellipse cx="200" cy="422" rx="${f(w / 2)}" ry="14" fill="url(#${id}-nappe)"/>`;
    const n = Math.min(7, Math.max(1, Math.ceil(state.roots.extraMonths / 6)));
    for (let i = 0; i < n; i++) { const sx = 200 - w / 2 + 18 + (i + .5) * (w - 36) / n; s += `<ellipse cx="${f(sx)}" cy="423" rx="6.5" ry="4.5" fill="#8A5A2E"/><ellipse cx="${f(sx - 2)}" cy="421.5" rx="2.5" ry="1.4" fill="#D9A974"/>`; }
  }
  if (o.marks !== false) {
    ([[1, state.roots.marks.one], [3, state.roots.marks.three], [6, state.roots.marks.six]] as [number, boolean][]).forEach(([m, ok]) => {
      const y = yM(m);
      s += `<path d="M44 ${f(y)}H316" stroke="#FFF2DE" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round" opacity="${ok ? .85 : .4}"/><rect x="320" y="${f(y - 11)}" width="54" height="22" rx="11" fill="${ok ? '#F5B73E' : '#5E3D28'}"/><text x="347" y="${f(y + 4.5)}" text-anchor="middle" font-family="Nunito_800ExtraBold, Nunito, sans-serif" font-size="12" fill="${ok ? '#5A3A08' : '#F3DCC0'}">${m} mois</text>`;
    });
  }
  // Racines (tube doré + lueur + reflet)
  const rs = state.roots.beyondSix ? ROOTS.concat(ROOTS_DEEP) : ROOTS;
  const thick = .55 + .45 * Math.min(1, state.roots.months / 3 + .3);
  let rp = '';
  rs.forEach(([deg, len, w], i) => {
    const a = deg * Math.PI / 180, L = len * D, wig = (i % 2 ? -1 : 1) * (6 + L * .08);
    rp += `<path d="M200 ${GY}Q${f(200 + Math.sin(a) * L * .35 + wig)} ${f(GY + Math.cos(a) * L * .55)} ${f(200 + Math.sin(a) * L * 1.15)} ${f(GY + Math.cos(a) * L)}" stroke-width="${f(w * thick)}"/>`;
  });
  s += `<g fill="none" stroke-linecap="round" stroke="#FFD46A" opacity="0.35" transform="translate(0 1)">${rp.replace(/stroke-width="([\d.]+)"/g, (_m, w) => `stroke-width="${f(Number(w) * 2)}"`)}</g>`;
  s += `<g fill="none" stroke-linecap="round" stroke="url(#${id}-root)">${rp}</g>`;
  s += `<g fill="none" stroke-linecap="round" stroke="#FFF1C8" opacity="0.7" transform="translate(-1.2 -1)">${rp.replace(/stroke-width="([\d.]+)"/g, (_m, w) => `stroke-width="${f(Math.max(1, Number(w) * .28))}"`)}</g>`;
  if (state.drip.roots) s += `<path d="M200 ${GY + 2}V${GY + 34}" stroke="#7CCBEB" stroke-width="3" stroke-dasharray="3 6" stroke-linecap="round" opacity="0.9"/>` + drop(200, GY + 46, .8);
  s += `</g><path d="${front}" fill="url(#${id}-side)"/>`;
  hot.push({ part: 'roots', x: 22, y: GY + 14, w: 356, h: 428 - GY });

  // Plateau d'herbe
  const TOP = GY - 26;
  const season = o.season ?? 'summer';
  s += `<path d="M22 ${GY}Q22 ${TOP} 70 ${TOP - 8}Q200 ${TOP - 22} 330 ${TOP - 8}Q378 ${TOP} 378 ${GY}Q378 ${GY + 10} 330 ${GY + 12}L70 ${GY + 12}Q22 ${GY + 10} 22 ${GY}Z" fill="url(#${id}-grass)"/>`;
  // Hiver : la neige recouvre le dessus du plateau (l'herbe reste visible sur les bords).
  if (season === 'winter') s += `<path d="M34 ${GY - 6}Q40 ${TOP + 2} 76 ${TOP - 4}Q200 ${TOP - 18} 324 ${TOP - 4}Q360 ${TOP + 2} 366 ${GY - 6}Q300 ${GY - 2} 200 ${GY - 4}Q100 ${GY - 2} 34 ${GY - 6}Z" fill="#FFFFFF" opacity="0.9"/>`;
  s += `<path d="M22 ${GY}Q22 ${GY + 10} 70 ${GY + 12}L330 ${GY + 12}Q378 ${GY + 10} 378 ${GY}L378 ${GY + 8}Q378 ${GY + 20} 330 ${GY + 22}L70 ${GY + 22}Q22 ${GY + 20} 22 ${GY + 8}Z" fill="#4FA457"/>`;
  s += `<path d="M60 ${TOP - 2}Q200 ${TOP - 18} 340 ${TOP - 2}" stroke="#FFFFFF" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.45"/>`;
  [[54, GY - 4], [126, TOP - 6], [290, TOP - 6], [350, GY - 6]].forEach(([x, y]) => { s += `<path d="M${x - 6} ${y}Q${x - 5} ${y - 11} ${x - 1} ${y - 14}Q${x} ${y - 6} ${x + 1} ${y}M${x} ${y}Q${x + 3} ${y - 10} ${x + 8} ${y - 12}Q${x + 5} ${y - 4} ${x + 6} ${y}Z" fill="#5DB55E"/>`; });

  // Arrosoir + arrosage régulier (tuyau jusqu'au pied de l'arbre)
  s += shadow(id, 210, BASE + 2, sprout ? 22 : R * .85, 11);
  s += wateringCan(id, 50, BASE - 2, state.water);
  hot.push({ part: 'can', x: 40, y: BASE - 70, w: 100, h: 78 });
  if (state.drip.roots || state.drip.branches) {
    s += `<path d="M106 ${BASE - 4}Q150 ${BASE + 6} 192 ${BASE}" stroke="url(#${id}-pipe)" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M108 ${BASE - 5.5}Q150 ${BASE + 4} 190 ${BASE - 1.5}" stroke="#FFFFFF" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.7"/>`;
    s += drop(150, BASE - 6, .55) + drop(176, BASE - 8, .45);
  }

  // Ronces au sol (pousse) ou autour du tronc (arbre)
  const bramble = (d: string) => `<path d="${d}" stroke="url(#${id}-bramble)" stroke-width="5" fill="none" stroke-linecap="round"/>`;

  // Panier de récolte (5 placements et plus), au pied de l'arrosoir.
  if (state.fruitTier >= 5) s += basket(id, 124, BASE + 6, state.fruitTier >= 10 ? 5 : 3, state.ripe ? 'fruit' : 'fruitYoung');

  // Fleurs du confort
  FLOWERS.slice(0, state.flowers).forEach(([x, y], i) => { s += flower(id, x, y, i % 2 ? 1.1 : 1.3); });
  if (state.flowers > 0) {
    const used = FLOWERS.slice(0, state.flowers), xs = used.map(([x]) => x);
    hot.push({ part: 'flowers', x: Math.min(...xs) - 14, y: BASE - 34, w: Math.max(...xs) - Math.min(...xs) + 28, h: 44 });
  }

  if (sprout) {
    const hh = 24 + g * 70;
    s += `<path d="M200 ${BASE}Q196 ${f(BASE - hh * .5)} 202 ${f(BASE - hh)}" stroke="#4FB866" stroke-width="4.5" fill="none" stroke-linecap="round"/><g transform="translate(202 ${f(BASE - hh)}) rotate(-35) scale(${f(1 + g * 2.4)})"><path d="${LEAF}" fill="url(#${id}-leaf)"/></g><g transform="translate(202 ${f(BASE - hh)}) scale(-1 1) rotate(-30) scale(${f(.9 + g * 2)})"><path d="${LEAF}" fill="url(#${id}-leaf)"/></g>`;
    if (state.fruits > 0) s += fruit(id, 212, BASE - hh * .55, 5.5, state.ripe ? 'fruit' : 'fruitYoung');
    hot.push({ part: 'tree', x: 170, y: BASE - hh - 30, w: 60, h: hh + 34 });
    if (state.brambles > 0) {
      s += bramble(`M150 ${BASE}Q156 ${BASE - 26} 168 ${BASE - 12}Q176 ${BASE - 2} 184 ${BASE - 18}`) + bramble(`M250 ${BASE}Q244 ${BASE - 26} 232 ${BASE - 12}Q224 ${BASE - 2} 216 ${BASE - 18}`);
      ([[156, BASE - 14, 1], [176, BASE - 8, 1], [244, BASE - 14, -1], [224, BASE - 8, -1]] as [number, number, number][]).forEach(([x, y, d]) => { s += `<path d="M${x} ${y}l${-4 * d} -5l${5 * d} 1Z" fill="#55284A"/>`; });
      ([[160, BASE - 24], [184, BASE - 20], [240, BASE - 24], [216, BASE - 20]] as [number, number][]).forEach(([x, y]) => { s += sphere(id, x, y, 3.6, 'fruit').replace(`url(#${id}-fruit)`, '#4A2A55'); });
      hot.push({ part: 'brambles', x: 140, y: BASE - 34, w: 120, h: 40 });
    }
    if (state.cabin) { s += cabin(id, 320, BASE - 4, 46, state.cabin.progress); hot.push({ part: 'cabin', x: 308, y: BASE - 74, w: 68, h: 78 }); }
  } else {
    const top = BASE - H, tx = 205, wB = 12 + g * 24, wT = wB * .42, bx = 200, cx = tx, cy = top - R * .3;
    s += `<path d="M${f(bx - wB / 2 - 8)} ${BASE + 3}Q${f(bx - wB / 2)} ${BASE} ${f(bx - wB / 2 + 1)} ${BASE - 12}C${f(bx - wB / 2 + 3)} ${f(BASE - H * .45)} ${f(tx - wT / 2 - 3)} ${f(BASE - H * .75)} ${f(tx - wT / 2)} ${f(top)}L${f(tx + wT / 2)} ${f(top)}C${f(tx + wT / 2 + 3)} ${f(BASE - H * .75)} ${f(bx + wB / 2 - 3)} ${f(BASE - H * .45)} ${f(bx + wB / 2 - 1)} ${BASE - 12}Q${f(bx + wB / 2)} ${BASE} ${f(bx + wB / 2 + 8)} ${BASE + 3}Z" fill="url(#${id}-bark)"/>`;
    if (state.drip.branches) s += `<path d="M${f(bx + wB / 2 + 2)} ${BASE - 2}C${f(bx + wB / 2 + 6)} ${f(BASE - H * .4)} ${f(tx + wT / 2 + 4)} ${f(BASE - H * .7)} ${f(tx + wT / 2 + 3)} ${f(top + 4)}" stroke="#7CCBEB" stroke-width="2.6" stroke-dasharray="3 5" fill="none" stroke-linecap="round"/>`;
    if (state.brambles > 0) {
      const hb = H * (.25 + .6 * state.brambles), n = Math.round(3 + state.brambles * 4);
      let d = `M${f(bx - wB * .9)} ${BASE}`;
      for (let i = 1; i <= n; i++) { const yy = BASE - hb * i / n; d += `Q${f(bx)} ${f(yy + hb / n * .2)} ${f(i % 2 ? bx + wB * .85 : bx - wB * .85)} ${f(yy)}`; }
      s += bramble(d);
      for (let i = 1; i <= n; i++) s += `<circle cx="${f(bx + (i % 2 ? 7 : -7))}" cy="${f(BASE - hb * (i - .5) / n - 3)}" r="3.4" fill="#4A2A55"/>`;
      hot.push({ part: 'brambles', x: bx - wB - 10, y: BASE - hb - 6, w: wB * 2 + 20, h: hb + 10 });
    }
    const B = BLOBS;
    if (o.glow) s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 1.5)}" fill="url(#${id}-halo)"/>`;
    s += `<ellipse cx="${f(cx + R * .06)}" cy="${f(cy + R * .2)}" rx="${f(R * 1.15)}" ry="${f(R * .95)}" fill="url(#${id}-canopyShadow)"/>`;
    /* Feuillage selon la saison : plus tendre au printemps, doré à l'automne (jamais de feuilles qui
       tombent), vert sous la neige en hiver. */
    const leafFill = season === 'spring' ? 'leafSpring' : season === 'autumn' ? 'leafAutumn' : 'leaf';
    [...B].sort((a, b) => a[1] - b[1]).forEach(([dx, dy, r]) => { s += sphere(id, cx + dx * R, cy + dy * R, r * R, leafFill); });
    if (season === 'winter') B.filter(([, dy]) => dy <= 0.15).forEach(([dx, dy, r]) => { s += `<ellipse cx="${f(cx + dx * R)}" cy="${f(cy + dy * R - r * R * 0.62)}" rx="${f(r * R * 0.62)}" ry="${f(r * R * 0.26)}" fill="#FFFFFF" opacity="0.92"/>`; });
    if (season === 'spring') FRUITS.slice(-6).forEach(([dx, dy]) => { s += sphere(id, cx + dx * R * 0.95, cy + dy * R * 0.95 - 4, 3.6, 'blossom'); });
    ([[-.42, -.5, .16], [-.05, -.74, .12], [-.74, -.22, .1], [.26, -.56, .12]] as [number, number, number][]).forEach(([dx, dy, k]) => { s += spec(id, cx + dx * R, cy + dy * R, R * k, R * k * .6, .75); });
    /* Fruits = placements. Peu de placements → de gros fruits bien visibles ; beaucoup → plus de
       fruits, plus petits. Mûrs (orange) s'il y a des gains, jeunes (vert-jaune) sinon — jamais
       abîmés ni tombés. Palier 10+ : les trois premiers deviennent dorés. */
    const fr = (state.fruits <= 3 ? 7.5 : state.fruits <= 6 ? 6.2 : 5.2) + R * .03 + 2 * state.branches;
    const fill = state.ripe ? 'fruit' : 'fruitYoung';
    FRUITS.slice(0, state.fruits).forEach(([dx, dy], i) => {
      const x = cx + dx * R, y = cy + dy * R;
      s += fruit(id, x, y, fr, state.fruitTier >= 10 && i < 3 ? 'fruitGold' : fill);
      if (state.fruitTier >= 10 && i < 3) s += sparkle(x + fr * 1.1, y - fr * 1.1, 4.5);
    });

    hot.push({ part: 'tree', x: cx - R * 1.1, y: cy - R, w: R * 2.2, h: BASE - (cy - R) });
    if (state.cabin) {
      const cw = Math.max(46, R * .7), cxx = cx + R * .12, cyy = Math.min(cy + R * .5, BASE - 34);
      // (Plus de grosse branche sous la cabane : le plancher, ses jambes de force et l'échelle suffisent.)
      s += cabin(id, cxx, cyy, cw, state.cabin.progress, BASE - 2);
      hot.push({ part: 'cabin', x: cxx - 8, y: cyy - cw * 1.15, w: cw * 1.25, h: cw * 1.25 });
    }
    if (o.glow) ([[-1.2, -.55, 9], [1.15, -.75, 7], [1, .35, 6], [0, -1.25, 8]] as [number, number, number][]).forEach(([dx, dy, r]) => { s += sparkle(cx + dx * R, cy + dy * R, r); });
  }

  if (o.rain) ([[110, 40], [150, 70], [190, 30], [230, 62], [270, 36], [310, 76], [130, 110], [250, 104]] as [number, number][]).forEach(([x, y], i) => { s += drop(x, y, .9 + (i % 3) * .15); });
  if (o.mascot !== false) {
    const px = !state.cabin ? 250 : sprout ? 238 : 292;
    s += hedgehog(id, px, BASE + 2, 1, o.mood ?? 'happy');
    hot.push({ part: 'pico', x: px - 4, y: BASE - 50, w: 72, h: 54 });
  }
  return { svg: s + '</svg>', viewBox, hotspots: hot };
}

/** Description courte de la scène, pour les lecteurs d'écran. */
export function describeScene(state: TreeState): string {
  const parts: string[] = [];
  parts.push({ sprout: 'Une jeune pousse', young: 'Un jeune arbre', tree: 'Un arbre', fruiting: 'Un arbre en fruits', grand: 'Un grand arbre' }[state.stage]);
  const m = state.roots.months;
  parts.push(m > 6 ? `racines au-delà de 6 mois (${Math.round(m)} mois)` : `racines à ${m.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mois`);
  if (state.investments) parts.push(`${state.investments} placement${state.investments > 1 ? 's' : ''} en fruits${state.ripe ? ' mûrs' : ''}`);
  if (state.flowers) parts.push(`${state.flowers} fleurs`);
  if (state.drip.roots || state.drip.branches) parts.push('arrosage régulier');
  if (state.cabin) parts.push(`une cabane construite à ${Math.round(state.cabin.progress * 100)} %${state.cabin.count > 1 ? ` (${state.cabin.count} crédits)` : ''}`);
  if (state.brambles > 0) parts.push('des ronces autour du tronc');
  return parts.join(', ') + '.';
}
