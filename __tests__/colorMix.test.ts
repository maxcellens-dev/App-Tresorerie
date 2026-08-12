import { parseColor, compositeOver } from '../lib/ui/colorMix';

describe('parseColor', () => {
  it('lit les formes hexadécimales courantes', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#00ff80')).toEqual({ r: 0, g: 255, b: 128, a: 1 });
  });

  it('lit le canal alpha d\'un hex à 8 chiffres', () => {
    const c = parseColor('#00000080')!;
    expect(c.a).toBeCloseTo(128 / 255, 3);
  });

  it('lit rgb() et rgba()', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('rend null sur une entrée non reconnue plutôt que d\'inventer une couleur', () => {
    expect(parseColor(undefined)).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor('rouge')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(a, b, c)')).toBeNull();
  });
});

describe('compositeOver', () => {
  /* But : obtenir l'équivalent OPAQUE d'une surface translucide posée sur un fond. Sur Android,
     une carte non opaque laisse transparaître l'ombre d'elevation et produit un voile gris. */
  it('rend le fond inchangé quand la surface est totalement transparente', () => {
    expect(compositeOver('rgba(255,255,255,0)', '#000000')).toBe('rgb(0, 0, 0)');
  });

  it('renvoie la surface TELLE QUELLE quand elle est déjà opaque', () => {
    // Aucun calcul dans ce cas : la chaîne d'origine est rendue sans être reformatée.
    expect(compositeOver('#ffffff', '#000000')).toBe('#ffffff');
  });

  it('mélange à mi-chemin pour une surface à 50 %', () => {
    // blanc à 50 % sur noir → gris moyen
    expect(compositeOver('rgba(255,255,255,0.5)', '#000000')).toBe('rgb(128, 128, 128)');
  });

  it('retombe sur le fond quand la surface est illisible', () => {
    expect(compositeOver(undefined, '#123456')).toBe('#123456');
    expect(compositeOver('pas-une-couleur', '#123456')).toBe('#123456');
  });

  it('rend une couleur SANS canal alpha — c\'est tout l\'objet de la fonction', () => {
    const out = compositeOver('rgba(0,128,255,0.3)', '#ffffff');
    expect(out).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(out).not.toContain('rgba');
  });
});
