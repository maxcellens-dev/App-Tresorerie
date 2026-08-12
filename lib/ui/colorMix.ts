/**
 * Composition de couleurs — utilitaires PURS.
 *
 * Sert à poser une couleur translucide sur un fond et à en obtenir l'équivalent OPAQUE : sur
 * Android, une surface non opaque laisse transparaître l'ombre d'elevation et produit un voile gris.
 * Extraits de `app/(tabs)/tresorerie.tsx` ; testés dans `__tests__/colorMix.test.ts`.
 */

/** Lit `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` ou `rgba(...)`. `null` si non reconnu. */
export function parseColor(c: string | undefined): { r: number; g: number; b: number; a: number } | null {
  if (!c) return null;
  const s = c.trim();
  const rgba = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const p = rgba[1].split(',').map((v) => parseFloat(v.trim()));
    if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  }
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/** Compose `overlay` (éventuellement translucide) sur `base` et renvoie une couleur OPAQUE. */
export function compositeOver(overlay: string | undefined, base: string): string {
  const o = parseColor(overlay);
  const b = parseColor(base);
  if (!o || !b) return base;           // teinte inconnue → au moins un fond opaque
  if (o.a >= 1) return overlay!;
  const mix = (x: number, y: number) => Math.round(x * o.a + y * (1 - o.a));
  return `rgb(${mix(o.r, b.r)}, ${mix(o.g, b.g)}, ${mix(o.b, b.b)})`;
}
