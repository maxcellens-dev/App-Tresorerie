/**
 * Petite boîte à outils raster pour les assets du Jardin : une image = { w, h, data } (RGBA 8 bits).
 * sharp lit, redimensionne et écrit ; le reste (superposition, étalonnage, dégradés) est fait ici.
 */
import sharp from 'sharp';

export async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data) };
}

export function save(im, file) {
  return sharp(Buffer.from(im.data.buffer), { raw: { width: im.w, height: im.h, channels: 4 } }).png().toFile(file);
}

export function blank(w, h, rgba = [0, 0, 0, 0]) {
  w = Math.round(w); h = Math.round(h);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { w, h, data };
}

export const clone = (im) => ({ w: im.w, h: im.h, data: new Uint8ClampedArray(im.data) });

/** Redimensionne ; une dimension absente (null/undefined) = proportionnel. */
export async function resize(im, w, h) {
  const both = w != null && h != null;
  const { data, info } = await sharp(Buffer.from(im.data.buffer), { raw: { width: im.w, height: im.h, channels: 4 } })
    .resize(w ?? null, h ?? null, { fit: both ? 'fill' : 'inside', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data) };
}

/** Superpose `top` sur `base` en (x, y), alpha « over ». */
export function over(base, top, x, y) {
  x = Math.round(x); y = Math.round(y);
  for (let j = 0; j < top.h; j++) {
    const by = y + j; if (by < 0 || by >= base.h) continue;
    for (let i = 0; i < top.w; i++) {
      const bx = x + i; if (bx < 0 || bx >= base.w) continue;
      const t = (j * top.w + i) * 4, b = (by * base.w + bx) * 4, a = top.data[t + 3] / 255;
      if (a === 0) continue;
      const ba = base.data[b + 3] / 255, oa = a + ba * (1 - a);
      for (let c = 0; c < 3; c++) base.data[b + c] = (top.data[t + c] * a + base.data[b + c] * ba * (1 - a)) / oa;
      base.data[b + 3] = oa * 255;
    }
  }
  return base;
}

/** Dégradé vertical : stops = [[t, [r, g, b]], …]. */
export function gradient(w, h, stops) {
  const im = blank(w, h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1); let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const rgb = c0.map((v, c) => v + (c1[c] - v) * u);
    for (let x = 0; x < w; x++) im.data.set([...rgb, 255], (y * w + x) * 4);
  }
  return im;
}

/** Ellipse floue (soleil, lune, halo, ombre de contact). `hard` = part pleine du rayon. */
export function blob(w, h, rgb, alphaMax, hard = 0.35) {
  w = Math.round(w); h = Math.round(h);
  const im = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)); if (r >= 1) continue;
    const a = r < hard ? 1 : Math.pow(1 - (r - hard) / (1 - hard), 2);
    im.data.set([...rgb, a * alphaMax * 255], (y * w + x) * 4);
  }
  return im;
}

/** Étalonnage de toute une image : couleur × mul + add (crépuscule, nuit). */
export function grade(im, mul, add = [0, 0, 0]) {
  const out = clone(im);
  for (let i = 0; i < out.data.length; i += 4) for (let c = 0; c < 3; c++) out.data[i + c] = out.data[i + c] * mul[c] + add[c];
  return out;
}

/** Abscisse moyenne des pixels opaques de la dernière ligne pleine (pied d'un tronc, pattes…), en fraction de largeur. */
export function footFrac(im) {
  for (let y = im.h - 1; y > 0; y--) {
    let s = 0, c = 0;
    for (let x = 0; x < im.w; x++) if (im.data[(y * im.w + x) * 4 + 3] > 200) { s += x; c++; }
    if (c > 20) return s / c / im.w;
  }
  return 0.5;
}
