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
/** Profondeur du tronc : ce qui est accroché à l'arbre (nichoir, échelle, cabane, pommes) la suit. */
const TREE_Z = GROUND + 6;

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
  /** Profondeur (premier plan) : y du pied sur l'herbe — plus grand = plus près, peint après.
   *  Absent = bas de l'image. Les objets accrochés à l'arbre prennent celle du tronc. */
  z?: number;
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
  /** Fenêtres éclairées de l'intérieur (cabane finie) : dessinées au-dessus du voile de la nuit. */
  windows: Rect[];
}

/** Vitres de la fenêtre dans l'image de la cabane finie (fractions de l'image cabin.webp). */
const CABIN_WINDOW = { x: 0.452, y: 0.378, w: 0.103, h: 0.138 };

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
  /* Voiles LÉGERS : le dessin reste lisible ; c'est le ciel (étoiles, lune, couchant) et les
     lanternes allumées qui disent que c'est le soir, pas une scène assombrie. */
  dusk: { rgb: [200, 104, 74], a: 0.13 },
  night: { rgb: [26, 40, 92], a: 0.3 },
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
/** Champignons : [x du centre, y du pied, largeur, miroir], autour du tronc (x 470), entre les fleurs. */
const MUSHROOM_SLOTS: [number, number, number, boolean][] = [
  [430, 668, 16, false], [516, 666, 15, true], [338, 690, 22, true], [520, 688, 18, false],
  [300, 702, 28, false], [468, 698, 22, true], [362, 712, 34, false], [500, 714, 28, true],
];
const PEPIN_W = 178;
const CAN_W = 205;
/* Herbe semée sur tout le dessus du plateau, du fond (petites, y bas) au bord avant (plus grandes) :
   [x, y du pied, largeur]. Triées par profondeur avec le reste : celles du fond passent derrière. */
const DECO_TUFTS: [number, number, number][] = [
  [110, 614, 36], [232, 620, 32], [372, 610, 34], [566, 616, 32], [690, 612, 36], [806, 620, 34],
  [70, 660, 42], [326, 650, 38], [612, 652, 40], [864, 662, 42],
  [74, 704, 52], [204, 710, 46], [302, 714, 40], [524, 714, 42], [712, 716, 44], [862, 702, 50],
];

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
  /** Touffe d'herbe dont le pied est en (cx, footY). */
  const tuft = (list: Layer[], key: string, cx: number, footY: number, w: number, variant = 0) => {
    const h = w * M.tuft.h / M.tuft.w;
    // juste devant ce qu'elle cache (même pied, un cheveu plus près)
    list.push(img(key, `tuft_${o.season}_${variant % M.tuft.variants}`, cx - w / 2, footY - h * M.tuft.foot, w, h, { z: footY + 0.5 }));
  };
  const v: Scene3dVector = { shadows: [], marks: [], dripRoots: state.drip.roots, dripBranches: null, glow: null, lights: [], waterLine: null, sleepZ: null, windows: [] };
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
  /* Une grande clôture continue tout le long du bord ARRIÈRE du plateau : des tronçons bout à bout
     (légèrement chevauchés pour qu'on ne voie pas de jointure), posés derrière la plaque d'herbe —
     son bord avant cache le pied des piquets. Les deux bouts rentrent un peu : les coins sont arrondis. */
  if (decor.has('fence')) {
    const f = M.decor.fence, h = 64, w = h * f.w / f.h, x0 = 78, x1 = 850, foot = 606;
    const step = w * 0.94, n = Math.ceil((x1 - x0 - w) / step) + 1, gap = (x1 - x0 - w) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) back.push(img(`fence${i}`, 'decor_fence', x0 + i * gap, foot - h, w, h, { flip: i % 2 === 1 }));
  }

  // ── Plateau : terre (niveau de racines) puis plaque d'herbe de la saison ──
  const lvl = rootLevel(state.roots.months, state.roots.beyondSix), soil = M.soil[lvl];
  back.push(img('soil', `soil_${lvl}`, soil.x, soil.y, soil.w, soil.h));
  back.push(img('slab', `slab_${o.season}`, M.slab.x, M.slab.y, M.slab.w, M.slab.h));
  // quelques touffes sur le dessus : l'herbe n'est plus une plaque nue
  DECO_TUFTS.forEach(([x, y, w], i) => tuft(front, `tuftDeco${i}`, x, y, w * 1.35, i));
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
  flowers.forEach(([x, y, k, flip], i) => {
    // la tige sort de l'herbe : le pied (bas de l'image) est caché par une touffe posée devant
    front.push(img(`flower${i}`, `flower_${o.season}`, x - fw * k / 2, y - fh * k + 6, fw * k, fh * k, { flip, z: y + 4 }));
    tuft(front, `flowerTuft${i}`, x, y + 4, 56 * k, i);
  });
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

  /* Ronces (crédit cher) : des ronces RAMPANTES, basses et larges, enracinées dans l'herbe. Autour d'un
     arbre, deux nappes PASSENT DERRIÈRE le tronc (il les traverse) et, plus elles sont denses, une
     troisième vient devant ; autour d'une pousse, deux nappes de part et d'autre. */
  const brambleFront: Rect[] = [];
  if (state.brambles > 0) {
    const d = state.brambles, half = t.trunkHalf * tw;
    const bw = (kind === 'sprout' ? 90 : 130) + 80 * d, bh = bw * M.brambles.h / M.brambles.w;
    const behind: number[] = kind === 'sprout' ? [] : [470 - half - bw * 0.2, 470 + half + bw * 0.2];
    const ahead: [number, number][] = kind === 'sprout' ? [[470 - bw * 0.62, bw], [470 + bw * 0.62, bw]] : d > 0.5 ? [[470 + 4, bw * 0.6]] : [];
    // le pied des buissons est enfoncé sous l'herbe (bas de l'image sous le sol, caché par les touffes)
    behind.forEach((x, i) => front.push(img(`brambleB${i}`, 'brambles', x - bw / 2, GROUND + 16 - bh, bw, bh, { flip: i === 1, z: GROUND })));
    ahead.forEach(([x, w]) => brambleFront.push({ x: x - w / 2, y: GROUND + 28 - bh * w / bw, w, h: bh * w / bw }));
    const all = [...behind.map((x) => ({ x: x - bw / 2, w: bw })), ...brambleFront];
    const x0 = Math.min(...all.map((r) => r.x)), x1 = Math.max(...all.map((r) => r.x + r.w));
    hot.push({ part: 'brambles', x: x0, y: GROUND + 16 - bh, w: x1 - x0, h: bh + 8 });
  }

  front.push(img('tree', `tree_${kind}_${o.season}`, tx, ty, tw, th));
  // le pied sort de l'herbe : touffes contre le tronc (ou au pied de la pousse)
  if (kind === 'sprout') tuft(front, 'tuftTree', 470, GROUND + 10, 50, 1);
  else { const half = t.trunkHalf * tw; tuft(front, 'tuftTreeL', 470 - half - 6, GROUND + 12, 58, 0); tuft(front, 'tuftTreeR', 470 + half + 10, GROUND + 14, 52, 2); }
  brambleFront.forEach((r, i) => {
    front.push(img(`brambleF${i}`, 'brambles', r.x, r.y, r.w, r.h, { flip: i % 2 === 1, z: r.y + r.h - 8 }));
    tuft(front, `brambleTuft${i}a`, r.x + r.w * 0.32, r.y + r.h - 6, r.w * 0.62, i + 1);
    tuft(front, `brambleTuft${i}b`, r.x + r.w * 0.7, r.y + r.h - 4, r.w * 0.56, i + 2);
  });
  if (state.brambles > 0 && kind !== 'sprout') {
    const half = t.trunkHalf * tw, bw = 130 + 80 * state.brambles;
    tuft(front, 'brambleTuftL', 470 - half - bw * 0.4, GROUND + 14, bw * 0.7, 2);
    tuft(front, 'brambleTuftR', 470 + half + bw * 0.4, GROUND + 14, bw * 0.7, 0);
  }
  const cb = t.canopy, canopy: Rect = { x: tx + cb.x0 * tw, y: ty + cb.y0 * th, w: (cb.x1 - cb.x0) * tw, h: (cb.y1 - cb.y0) * th };
  hot.push({ part: 'tree', x: canopy.x, y: canopy.y, w: canopy.w, h: GROUND - canopy.y });
  if (o.glow) v.glow = { cx: canopy.x + canopy.w / 2, cy: canopy.y + canopy.h / 2, r: Math.max(canopy.w, canopy.h) * 0.75 };
  if (state.drip.branches && kind !== 'sprout') v.dripBranches = { x: 470 + t.trunkHalf * tw + 6, y0: GROUND - 6, y1: canopy.y + canopy.h - 10 };

  // nichoir accroché au tronc
  if (decor.has('birdhouse') && kind !== 'sprout') {
    const b = M.decor.birdhouse, w = Math.max(48, tw * 0.13), h = w * b.h / b.w;
    front.push(img('birdhouse', 'decor_birdhouse', 470 - t.trunkHalf * tw - w * 0.9, ty + th * 0.74 - h, w, h, { z: TREE_Z + 0.1 }));
  }

  // pommes = placements (dans la pousse : une seule, sur la tige)
  if (state.fruits > 0) {
    const kindOf = (i: number) => (state.fruitTier >= 10 && i < 3 ? 'gold' : state.ripe ? 'ripe' : 'young');
    if (kind === 'sprout') {
      const s = 24; front.push(img('apple0', `apple_${kindOf(0)}`, 470 + 6, GROUND - th * 0.45, s, s * M.apple.h / M.apple.w, { z: TREE_Z + 0.4 }));
    } else {
      const s = canopy.w * (state.fruits <= 3 ? 0.1 : state.fruits <= 6 ? 0.088 : 0.076), ah = s * M.apple.h / M.apple.w;
      SPOTS.slice(0, state.fruits).forEach(([fx, fy], i) => front.push(img(`apple${i}`, `apple_${kindOf(i)}`, canopy.x + fx * canopy.w - s / 2, canopy.y + fy * canopy.h - ah / 2, s, ah, { z: TREE_Z + 0.4 })));
    }
  }

  // ── Cabane : sur la branche (grand arbre) ou posée au sol (petit arbre) ──
  let pepinX = 660;
  if (cabin) {
    const c = M.cabin, p = Math.max(0, Math.min(1, cabin.progress));
    /* 5 étapes LOGIQUES (plancher, garde-corps, ossature, toit, cabane habitée). Les étapes 2 à 4 sont
       des images à part (cabin_stage_k) ; le plancher est le bas de l'étape 2 (même plancher que les
       suivantes : l'ancienne image à part, sur treillis, ne ressemblait à aucune autre et faisait
       croire les étapes inversées). L'étape finale est éclairée de l'intérieur. À défaut d'image :
       la cabane finie révélée de bas en haut. */
    const stage = p < 0.2 ? 1 : p < 0.4 ? 2 : p < 0.6 ? 3 : p < 0.8 ? 4 : 5;
    const stages = M.cabinStages as Record<string, { dx: number; dy: number; sw: number; sh: number } | undefined>;
    const st = stage === 1 ? stages['2'] : stage < 5 ? stages[String(stage)] : undefined;
    let r: Rect, cabinZ: number | undefined;
    if (kind === 'adult' && 'branchTip' in t) {
      const tipX = tx + t.branchTip.x * tw, tipY = ty + t.branchTip.y * th, cw = tw * 0.34, ch = cw * c.h / c.w;
      r = { x: tipX - cw * 0.85, y: tipY - ch * 0.9, w: cw, h: ch };
      // échelle de la plateforme jusqu'à l'herbe (coupée à la bonne longueur)
      const lw = cw * 0.1, lh = lw * M.ladder.h / M.ladder.w, top = r.y + ch * 0.8, len = GROUND + 12 - top;
      front.push(img('ladder', 'ladder', r.x + cw * 0.24, top, lw, lh, { showTop: Math.min(1, len / lh), z: TREE_Z + 0.2 }));
      cabinZ = TREE_Z + 0.3;
    } else {
      const cw = 150, ch = cw * c.h / c.w;
      r = { x: 512, y: GROUND + 20 - ch, w: cw, h: ch };
      v.shadows.push({ cx: r.x + cw / 2, cy: GROUND + 14, rx: cw * 0.5, ry: 12, o: 0.45 });
      pepinX = 700;
    }
    if (st) front.push(img('cabin', `cabin_stage_${stage === 1 ? 2 : stage}`, r.x + st.dx * r.w, r.y + st.dy * r.h, st.sw * r.w, st.sh * r.h, { z: cabinZ, ...(stage === 1 ? { showBottom: 0.3 } : {}) }));
    else front.push(img('cabin', 'cabin', r.x, r.y, r.w, r.h, { z: cabinZ, ...(stage < 5 ? { showBottom: 0.25 + 0.75 * p } : {}) }));
    hot.push({ part: 'cabin', ...r });
    if (stage === 5) {
      // la cabane est habitée : la fenêtre s'allume (de jour comme de nuit), la lanterne la nuit
      v.windows.push({ x: r.x + r.w * CABIN_WINDOW.x, y: r.y + r.h * CABIN_WINDOW.y, w: r.w * CABIN_WINDOW.w, h: r.h * CABIN_WINDOW.h });
      if (night) v.lights.push({ cx: r.x + r.w * 0.47, cy: r.y + r.h * 0.2, r: r.w * 0.22 });
    }
  }

  // ── Lanterne posée, champignons, panier de récolte ──
  if (decor.has('lantern')) {
    const l = M.decor.lantern, w = 44, h = w * l.h / l.w, x = 530, y = 668 - h;
    front.push(img('lantern', 'decor_lantern', x, y, w, h));
    v.shadows.push({ cx: x + w / 2, cy: 666, rx: 26, ry: 6, o: 0.4 });
    if (night) v.lights.push({ cx: x + w / 2, cy: y + h * 0.66, r: 46 });
  }
  if (decor.has('mushrooms')) {
    /* Une zone de pousse autour du pied de l'arbre : plusieurs petites touffes, entre les fleurs,
       plus petites au fond (près du tronc) qu'au bord. Les grosses ont le pied caché par l'herbe. */
    const m = M.decor.mushrooms;
    MUSHROOM_SLOTS.forEach(([cx, foot, w, flip], i) => {
      const h = w * m.h / m.w;
      front.push(img(`mushrooms${i}`, 'decor_mushrooms', cx - w / 2, foot - h, w, h, { flip, z: foot }));
      if (w >= 28) tuft(front, `mushroomTuft${i}`, cx, foot - 2, w * 1.25, i);
    });
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
    /* Deux ombres : un halo doux, et une ombre de CONTACT serrée sous les pattes (sans elle, Pépin
       semblait flotter au-dessus de l'herbe). */
    v.shadows.push({ cx: pepinX + PEPIN_W * 0.5, cy: 674, rx: PEPIN_W * 0.44, ry: 11, o: 0.3 });
    v.shadows.push({ cx: pepinX + PEPIN_W * 0.44, cy: 672, rx: PEPIN_W * 0.3, ry: 6, o: 0.75 });
    pepinLayers(mood, o.outfit).forEach((name, i) => front.push(img(`pepin${i}`, name, x, y, w, h)));
    if (mood === 'sleep') v.sleepZ = { x: pepinX + PEPIN_W * 0.62, y: y + h * 0.12 };
    hot.push({ part: 'pico', x: pepinX - 6, y: y + h * 0.08, w: PEPIN_W + 12, h: h * 0.92 });
  }

  // ── Panier de récolte (5 placements et plus) : la récolte de Pépin, posée devant lui ──
  if (state.fruitTier >= 5) {
    const k = `basket_${state.ripe ? 'ripe' : 'young'}_${state.fruitTier >= 10 ? 5 : 3}`, w = 80, h = w * M.basket.h / M.basket.w;
    const x = pepinX - 44, bottom = 712;
    v.shadows.push({ cx: x + w / 2, cy: bottom - 2, rx: w * 0.5, ry: 9, o: 0.45 });
    front.push(img('basket', k, x, bottom - h, w, h));
  }

  // peintre : du fond vers l'avant, à profondeur égale dans l'ordre d'ajout (eau sur l'arrosoir…)
  const depth = (l: Layer) => l.z ?? l.y + l.h;
  const sorted = front.map((l, i) => [l, i] as const).sort(([a, i], [b, j]) => depth(a) - depth(b) || i - j).map(([l]) => l);
  return { back, front: sorted, vector: v, hotspots: hot };
}
