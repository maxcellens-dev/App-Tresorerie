/**
 * Mise en page de la scène 3D du Jardin : un TreeState (+ options) → la liste ordonnée des calques
 * à superposer et les zones touchables. Fonction PURE (aucun import React Native) : testable en
 * node, et rendue par components/garden/GardenScene.
 *
 * Repère : le « cadre » des images sources, 928 × 1152, dont on affiche le haut (FRAME_H) ; le
 * composant convertit tout en POURCENTAGES, la scène suit donc la largeur de son conteneur.
 *
 * Images : lib/garden/scene3dAssets (généré par scripts/garden-assets/build.mjs). Aucune variante
 * n'est dessinée ici : on choisit, on place, on coupe (niveau d'eau, cabane en construction).
 */
import type { TreeState } from './treeState';
import type { Season } from './season';
import type { Moment } from './daylight';
import type { HotspotPart } from './sceneSvg';
import type { SceneExtras } from './sceneCinematic';
import { SCENE3D as M, type Scene3dImage } from './scene3dAssets';

export const FRAME_W = 928;
export const FRAME_H = 1110;
/** Sol : là où les objets posés sur l'herbe ont leur pied (milieu du dessus du plateau). */
export const GROUND = 655;

export type PepinMood = 'happy' | 'joy' | 'thinking' | 'sleep';

export interface Scene3dOptions extends SceneExtras {
  season: Season;
  moment: Moment;
  /** Traits 1 / 3 / 6 mois dans la terre. */
  marks?: boolean;
  mascot?: boolean;
  mood?: PepinMood;
  /** Halo doré (palier franchi). */
  glow?: boolean;
  /** Averse (un virement d'épargne vient d'être enregistré). */
  rain?: boolean;
  /** Ciel dessiné (sinon fond transparent). */
  sky?: boolean;
}

export interface Layer {
  key: string;
  img: Scene3dImage;
  /** Rectangle de l'image ENTIÈRE dans le cadre. */
  x: number; y: number; w: number; h: number;
  /** Ne montrer que la part basse de l'image (0 → 1) : niveau d'eau, cabane en construction. */
  showBottom?: number;
  /** Ne montrer que la part haute de l'image (0 → 1) : échelle coupée à la bonne longueur. */
  showTop?: number;
  flip?: boolean;
  opacity?: number;
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Hotspot3d extends Rect { part: HotspotPart }

/** Ce que les calques vectoriels (ciel, repères, ombres, lueurs) doivent dessiner. */
export interface Scene3dVector {
  shadows: { cx: number; cy: number; rx: number; ry: number; o: number }[];
  marks: { y: number; label: string; reached: boolean }[];
  dripRoots: boolean;
  /** Arrosage des branches : trait le long du tronc (de bas en haut). */
  dripBranches: { x: number; y0: number; y1: number } | null;
  /** Halo doré derrière le feuillage. */
  glow: { cx: number; cy: number; r: number } | null;
  /** Lueurs (lanternes) visibles au crépuscule et la nuit. */
  lights: { cx: number; cy: number; r: number }[];
  /** Reflet de la surface de l'eau dans l'arrosoir. */
  waterLine: { x1: number; x2: number; y: number } | null;
  /** « z z » au-dessus de Pépin qui dort. */
  sleepZ: { x: number; y: number } | null;
}

export interface Scene3d {
  /** Calques derrière l'arbre (nuages, clôture, terre, herbe, banc, mare, fleurs). */
  back: Layer[];
  /** Calques devant (arbre et tout ce qui est posé dessus ou devant). */
  front: Layer[];
  vector: Scene3dVector;
  hotspots: Hotspot3d[];
}

/* ── Lumière ──────────────────────────────────────────────────────────────────────────────────────
   Crépuscule et nuit = un voile coloré posé sur TOUTE la scène (les images restent celles du jour).
   Le ciel est dessiné sous ce voile : ses couleurs sont donc « pré-compensées » pour qu'une fois
   voilé il ait exactement la teinte voulue. La lune et les étoiles passent au-dessus du voile. */
export const VEIL: Record<Moment, { rgb: [number, number, number]; a: number } | null> = {
  day: null,
  dusk: { rgb: [190, 90, 70], a: 0.22 },
  night: { rgb: [18, 28, 70], a: 0.55 },
};
const SKY_FINAL: Record<Moment, Record<Season, [string, string, string]>> = {
  day: {
    spring: ['#BFDCEB', '#DCEAEC', '#F4EFE2'], summer: ['#A9D2EA', '#D3E6EC', '#F6EBD4'],
    autumn: ['#BFC9CE', '#D9DCD8', '#EADFCF'], winter: ['#C7D3DC', '#DCE4EA', '#EEF1F3'],
  },
  dusk: {
    spring: ['#5C5696', '#E8967A', '#FAD6AA'], summer: ['#5A5A9C', '#EE9A72', '#FCD9A4'],
    autumn: ['#585070', '#D88A6E', '#F2CBA0'], winter: ['#5A6290', '#D99A94', '#F2D2C2'],
  },
  night: {
    spring: ['#0E1630', '#24325C', '#3A4068'], summer: ['#0C1530', '#22305E', '#38406C'],
    autumn: ['#10142A', '#262C50', '#3A3C5E'], winter: ['#101A34', '#2A3A62', '#46507A'],
  },
};
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Dégradé du ciel (haut, milieu, bas) à peindre SOUS le voile du moment. */
export function skyStops(season: Season, moment: Moment): [string, string, string] {
  const veil = VEIL[moment], fin = SKY_FINAL[moment][season];
  if (!veil) return fin;
  return fin.map((h) => toHex(hex(h).map((v, c) => (v - veil.rgb[c] * veil.a) / (1 - veil.a)))) as [string, string, string];
}

/* ── Choix des images ─────────────────────────────────────────────────────────────────────────── */

/** Taille de l'arbre (1 → 7) d'après sa croissance ; les seuils prolongent les stades du moteur. */
export function treeSize(growth: number): number {
  const cuts = [0.22, 0.27, 0.4, 0.55, 0.7, 0.85];
  let s = 1; for (const c of cuts) if (growth >= c) s++;
  return s;
}
/** Hauteur de l'arbre dans le cadre, par taille. */
const TREE_H = [100, 160, 330, 420, 500, 570, 640];

/** Niveau de racines : le niveau dont la pointe est la plus proche de la profondeur visée. */
export function rootLevel(months: number, beyondSix: boolean): keyof typeof M.soil {
  if (beyondSix) return 'aquifer';
  if (months <= 0.05) return 'r0';
  if (months < 1) return 'r1';
  if (months < 2) return 'r2';
  if (months < 3) return 'r3';
  if (months < 4.5) return 'r4';
  if (months < 6) return 'r5';
  return 'r6';
}

/* Pommes dans le houppier (fractions de la boîte du feuillage) : les premières sont bien visibles. */
const SPOTS: [number, number][] = [[0.3, 0.42], [0.7, 0.34], [0.5, 0.68], [0.22, 0.7], [0.8, 0.62], [0.44, 0.22], [0.62, 0.52], [0.34, 0.56], [0.74, 0.16], [0.54, 0.4]];
/* Fleurs posées devant, sur l'herbe : [x du pied, y du pied, échelle, miroir]. */
const FLOWER_SLOTS: [number, number, number, boolean][] = [[402, 694, 1, false], [436, 706, 0.86, true], [548, 700, 0.95, false], [584, 690, 0.8, true], [616, 706, 0.9, false]];
const PEPIN_W = 178;
const CAN_W = 205;

/**
 * Calques de Pépin, du dessous au dessus, tous dans le MÊME cadre (M.pepin.w × M.pepin.h) : l'humeur,
 * puis la garde-robe. L'écharpe rouge passe en dernier — le calque des bottes reprend le bas du corps
 * et recouvrirait le pan de l'écharpe.
 */
export function pepinLayers(mood: PepinMood, outfit: SceneExtras['outfit'] = {}): Scene3dImage[] {
  const out: string[] = [`pepin_${mood}`];
  if (outfit.feet === 'boots') out.push('pepin_acc_boots');
  if (outfit.eyes === 'sunglasses') out.push('pepin_acc_sunglasses');
  if (outfit.head === 'straw_hat') out.push('pepin_acc_hat');
  if (outfit.neck === 'scarf_red') out.push(`pepin_scarf_red_${mood}`);
  return out as Scene3dImage[];
}

const img = (key: string, name: string, x: number, y: number, w: number, h: number, extra: Partial<Layer> = {}): Layer => ({ key, img: name as Scene3dImage, x, y, w, h, ...extra });

export function layoutScene(state: TreeState, o: Scene3dOptions): Scene3d {
  const back: Layer[] = [], front: Layer[] = [], hot: Hotspot3d[] = [];
  const v: Scene3dVector = { shadows: [], marks: [], dripRoots: state.drip.roots, dripBranches: null, glow: null, lights: [], waterLine: null, sleepZ: null };
  const decor = new Set(o.decor ?? []);
  const night = o.moment !== 'day';

  // ── Nuages (derrière tout) ──
  if (o.sky !== false) {
    const cloudOp = o.moment === 'night' ? 0.32 : o.moment === 'dusk' ? 0.8 : o.season === 'autumn' ? 0.88 : 0.95;
    const [c1, c3] = M.cloud;
    back.push(img('cloud1', 'cloud_1', 30, 92, 290, 290 * c1.h / c1.w, { opacity: cloudOp }));
    back.push(img('cloud3', 'cloud_3', 600, 262, 220, 220 * c3.h / c3.w, { opacity: cloudOp }));
    if (o.season === 'autumn' || o.season === 'winter' || o.rain) back.push(img('cloud1b', 'cloud_1', 330, 30, 250, 250 * c1.h / c1.w, { opacity: cloudOp * 0.9, flip: true }));
  }

  // ── Clôture (bord arrière du plateau) ──
  if (decor.has('fence')) {
    const f = M.decor.fence, w = 175, h = w * f.h / f.w;
    back.push(img('fenceL', 'decor_fence', 62, 614 - h, w, h), img('fenceR', 'decor_fence', 690, 614 - h, w, h, { flip: true }));
  }

  // ── Plateau : terre (niveau de racines) puis plaque d'herbe de la saison ──
  const lvl = rootLevel(state.roots.months, state.roots.beyondSix), soil = M.soil[lvl];
  back.push(img('soil', `soil_${lvl}`, soil.x, soil.y, soil.w, soil.h));
  back.push(img('slab', `slab_${o.season}`, M.slab.x, M.slab.y, M.slab.w, M.slab.h));
  hot.push({ part: 'roots', x: soil.x, y: M.slab.y + M.slab.h - 20, w: soil.w, h: soil.y + soil.h - (M.slab.y + M.slab.h - 20) });
  if (o.marks !== false) {
    const { one, three, six } = state.roots.marks;
    v.marks = [{ y: M.marks.one, label: '1 mois', reached: one }, { y: M.marks.three, label: '3 mois', reached: three }, { y: M.marks.six, label: '6 mois', reached: six }];
  }

  // ── Banc (au fond à droite), mare (devant), champignons ──
  if (decor.has('bench')) { const b = M.decor.bench, w = 150, h = w * b.h / b.w; back.push(img('bench', 'decor_bench', 598, 640 - h, w, h)); }
  if (decor.has('pond')) { const p = M.decor.pond, w = 132, h = w * p.h / p.w; back.push(img('pond', 'decor_pond', 296, 716 - h, w, h)); }

  // ── Fleurs du confort ──
  const fl = M.flower[o.season], fh = 96, fw = fh * fl.w / fl.h;
  const flowers = FLOWER_SLOTS.slice(0, state.flowers);
  flowers.forEach(([x, y, k, flip], i) => back.push(img(`flower${i}`, `flower_${o.season}`, x - fw * k / 2, y - fh * k, fw * k, fh * k, { flip })));
  if (flowers.length) {
    const xs = flowers.map(([x]) => x);
    hot.push({ part: 'flowers', x: Math.min(...xs) - 26, y: 610, w: Math.max(...xs) - Math.min(...xs) + 52, h: 104 });
  }

  // ── Arbre ──
  const size = treeSize(state.growth);
  const cabin = state.cabin;
  const kind = size <= 2 ? 'sprout' : size === 3 ? 'young' : cabin ? 'adult' : 'adultBare';
  const t = M.tree[kind], th = TREE_H[size - 1], tw = th * t.w / t.h;
  const tx = 470 - tw * t.foot, ty = GROUND + 6 - th;
  v.shadows.push({ cx: 470 + 8, cy: GROUND + 4, rx: Math.max(48, tw * (kind === 'sprout' ? 0.3 : 0.42)), ry: 18, o: 0.5 });
  front.push(img('tree', `tree_${kind}_${o.season}`, tx, ty, tw, th));
  const cb = t.canopy, canopy: Rect = { x: tx + cb.x0 * tw, y: ty + cb.y0 * th, w: (cb.x1 - cb.x0) * tw, h: (cb.y1 - cb.y0) * th };
  hot.push({ part: 'tree', x: canopy.x, y: canopy.y, w: canopy.w, h: GROUND - canopy.y });
  if (o.glow) v.glow = { cx: canopy.x + canopy.w / 2, cy: canopy.y + canopy.h / 2, r: Math.max(canopy.w, canopy.h) * 0.75 };
  if (state.drip.branches && kind !== 'sprout') v.dripBranches = { x: 470 + t.trunkHalf * tw + 6, y0: GROUND - 6, y1: canopy.y + canopy.h - 10 };

  // nichoir accroché au tronc
  if (decor.has('birdhouse') && kind !== 'sprout') {
    const b = M.decor.birdhouse, w = Math.max(48, tw * 0.13), h = w * b.h / b.w;
    front.push(img('birdhouse', 'decor_birdhouse', 470 - t.trunkHalf * tw - w * 0.9, ty + th * 0.74 - h, w, h));
  }

  // ronces : au sol autour de la pousse, au pied du tronc pour un arbre
  if (state.brambles > 0) {
    const n = 1 + Math.round(state.brambles * 2), bw = (kind === 'sprout' ? 58 : 78) + 56 * state.brambles, bh = bw * M.brambles.h / M.brambles.w;
    const xs = kind === 'sprout' ? [-1, 1].map((s) => 470 + s * (bw * 0.62)) : [0, -0.5, 0.5].slice(0, n).map((k) => 470 + k * bw);
    xs.forEach((x, i) => front.push(img(`bramble${i}`, 'brambles', x - bw / 2, GROUND + 16 - bh, bw, bh, { flip: i % 2 === 1 })));
    hot.push({ part: 'brambles', x: Math.min(...xs) - bw / 2, y: GROUND + 16 - bh, w: Math.max(...xs) - Math.min(...xs) + bw, h: bh });
  }

  // pommes = placements (dans la pousse : une seule, sur la tige)
  if (state.fruits > 0) {
    const kindOf = (i: number) => (state.fruitTier >= 10 && i < 3 ? 'gold' : state.ripe ? 'ripe' : 'young');
    if (kind === 'sprout') {
      const s = 24; front.push(img('apple0', `apple_${kindOf(0)}`, 470 + 6, GROUND - th * 0.45, s, s * M.apple.h / M.apple.w));
    } else {
      const s = canopy.w * (state.fruits <= 3 ? 0.1 : state.fruits <= 6 ? 0.088 : 0.076), ah = s * M.apple.h / M.apple.w;
      SPOTS.slice(0, state.fruits).forEach(([fx, fy], i) => front.push(img(`apple${i}`, `apple_${kindOf(i)}`, canopy.x + fx * canopy.w - s / 2, canopy.y + fy * canopy.h - ah / 2, s, ah)));
    }
  }

  // ── Cabane : sur la branche (grand arbre) ou posée au sol (petit arbre) ──
  let pepinX = 660;
  if (cabin) {
    const c = M.cabin, built = 0.25 + 0.75 * Math.max(0, Math.min(1, cabin.progress));
    let r: Rect;
    if (kind === 'adult' && 'branchTip' in t) {
      const tipX = tx + t.branchTip.x * tw, tipY = ty + t.branchTip.y * th, cw = tw * 0.34, ch = cw * c.h / c.w;
      r = { x: tipX - cw * 0.85, y: tipY - ch * 0.9, w: cw, h: ch };
      // échelle de la plateforme jusqu'à l'herbe (coupée à la bonne longueur)
      const lw = cw * 0.1, lh = lw * M.ladder.h / M.ladder.w, top = r.y + ch * 0.8, len = GROUND + 12 - top;
      front.push(img('ladder', 'ladder', r.x + cw * 0.24, top, lw, lh, { showTop: Math.min(1, len / lh) }));
    } else {
      const cw = 150, ch = cw * c.h / c.w;
      r = { x: 512, y: GROUND + 20 - ch, w: cw, h: ch };
      v.shadows.push({ cx: r.x + cw / 2, cy: GROUND + 14, rx: cw * 0.5, ry: 12, o: 0.45 });
      pepinX = 700;
    }
    front.push(img('cabin', 'cabin', r.x, r.y, r.w, r.h, { showBottom: built }));
    hot.push({ part: 'cabin', ...r });
    // la petite lanterne sous le toit ne s'allume que la cabane finie
    if (night && cabin.progress >= 0.8) v.lights.push({ cx: r.x + r.w * 0.47, cy: r.y + r.h * 0.2, r: r.w * 0.22 });
  }

  // ── Lanterne posée, champignons, panier de récolte ──
  if (decor.has('lantern')) {
    const l = M.decor.lantern, w = 44, h = w * l.h / l.w, x = 530, y = 668 - h;
    front.push(img('lantern', 'decor_lantern', x, y, w, h));
    v.shadows.push({ cx: x + w / 2, cy: 666, rx: 26, ry: 6, o: 0.4 });
    if (night) v.lights.push({ cx: x + w / 2, cy: y + h * 0.66, r: 46 });
  }
  if (decor.has('mushrooms')) { const m = M.decor.mushrooms, w = 58, h = w * m.h / m.w; front.push(img('mushrooms', 'decor_mushrooms', 330, 694 - h, w, h)); }
  if (state.fruitTier >= 5) {
    const k = `basket_${state.ripe ? 'ripe' : 'young'}_${state.fruitTier >= 10 ? 5 : 3}`, w = 78, h = w * M.basket.h / M.basket.w;
    front.push(img('basket', k, 50, 714 - h, w, h));
    v.shadows.push({ cx: 89, cy: 712, rx: 40, ry: 8, o: 0.4 });
  }

  // ── Arrosoir en verre : vide + eau coupée au niveau ──
  {
    const c = M.can, w = CAN_W, h = w * c.h / c.w, x = 105, y = 668 - h;
    v.shadows.push({ cx: x + w * 0.42, cy: 666, rx: w * 0.42, ry: 12, o: 0.45 });
    front.push(img('can', 'can_empty', x, y, w, h));
    const lv = Math.max(0, Math.min(1, state.water));
    if (lv > 0.01) {
      const cut = c.waterTop + (1 - lv) * (c.waterBottom - c.waterTop);
      front.push(img('water', 'can_water', x, y, w, h, { showBottom: 1 - cut }));
      // reflet de la surface : largeur intérieure interpolée entre le haut et le bas du corps
      const u = (cut - c.waterTop) / (c.waterBottom - c.waterTop);
      const l = c.bodyTop[0] + (c.bodyBottom[0] - c.bodyTop[0]) * u, r = c.bodyTop[1] + (c.bodyBottom[1] - c.bodyTop[1]) * u;
      if (lv < 0.99) v.waterLine = { x1: x + (l + 0.02) * w, x2: x + (r - 0.02) * w, y: y + cut * h };
    }
    hot.push({ part: 'can', x: x - 10, y: y - 10, w: w + 20, h: h + 16 });
  }

  // ── Pépin et sa garde-robe ──
  if (o.mascot !== false) {
    const p = M.pepin, mood: PepinMood = o.mood ?? (o.moment === 'night' ? 'sleep' : 'happy');
    const w = PEPIN_W / p.bodyW, h = w * p.h / p.w, x = pepinX - p.bodyX * w, y = 672 - p.foot * h;
    v.shadows.push({ cx: pepinX + PEPIN_W * 0.5, cy: 670, rx: PEPIN_W * 0.46, ry: 12, o: 0.45 });
    pepinLayers(mood, o.outfit).forEach((name, i) => front.push(img(`pepin${i}`, name, x, y, w, h)));
    if (mood === 'sleep') v.sleepZ = { x: pepinX + PEPIN_W * 0.62, y: y + h * 0.12 };
    hot.push({ part: 'pico', x: pepinX - 6, y: y + h * 0.08, w: PEPIN_W + 12, h: h * 0.92 });
  }

  return { back, front, vector: v, hotspots: hot };
}
