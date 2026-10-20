/**
 * Charte du Jardin (refonte « arbre qui pousse »).
 *
 * Une seule source pour les couleurs, rayons, espacements et styles de texte de la nouvelle
 * interface. Elle vit À CÔTÉ de `theme/palette.ts` (l'interface actuelle) tant que le Jardin est
 * derrière son interrupteur : rien ici ne modifie l'app existante.
 *
 * ── RÈGLES ───────────────────────────────────────────────────────────────────────────────────────
 * - Deux modes : jardin de jour (LIGHT) et jardin de nuit (DARK), choisis dans Apparence.
 * - Les couleurs de MATIÈRE (eau, racines, branches, fleurs, ronces) portent un sens : une couleur
 *   = une partie de l'arbre, partout. Le texte posé dessus utilise la variante `…Text` (contraste
 *   ≥ 4,5:1 sur blanc), jamais la couleur de remplissage.
 * - Pas de rouge d'alerte : un mois serré se lit dans l'arrosoir, pas dans un panneau d'erreur.
 */
import { GARDEN_FONTS } from './fontFamilies';

const LIGHT = {
  // Fond un cran plus soutenu que le blanc des cartes : sans écart, tout se lisait « blanc sur blanc ».
  bg: '#E8F0EB',
  card: '#FFFFFF',
  sky: '#E4F1EE',
  ink: '#1E3A2C',
  inkSoft: '#4F6A5C',
  muted: '#4E695B',
  line: '#CCDCD3',
  track: '#D8E5DE',
  field: '#EDF3EF',

  primary: '#26784A',
  primaryPressed: '#1E5F3B',
  onPrimary: '#FFFFFF',

  // Matières de l'arbre : remplissage / fond doux / texte lisible.
  water: '#5DB8E0', waterBg: '#E2F3FA', waterText: '#1F6F94',
  roots: '#F0B54A', rootsBg: '#FDF0D2', rootsText: '#8A5A0B',
  branches: '#4DB067', branchesBg: '#E3F3E6', branchesText: '#26784A',
  fruits: '#FF8F5E', fruitsBg: '#FFE6DA', fruitsText: '#B4471F',
  flowers: '#EE8AAE', flowersBg: '#FCE7EF', flowersText: '#A8406A',
  brambles: '#7A4763', bramblesBg: '#F5E4EE', bramblesText: '#7A3A5E',

  // Pico et la série (anneaux du tronc).
  pico: '#FFF1DE', picoText: '#7A4A12',
  // Information à surveiller (mois serré, montant à confirmer) — jamais d'alarme rouge.
  notice: '#FFF4DC', noticeText: '#6B4508',

  /* Halo du haut d'écran (barre du haut + départ du dégradé de page). En clair il se confond avec
     le fond ; en sombre, il porte la couleur d'accent — cf. applyGardenTheme. */
  glow: '#E8F0EB',
};

export type GardenPaletteValues = { [K in keyof typeof LIGHT]: string };

/**
 * Jardin de nuit : mêmes matières, posées sur un fond sombre ; textes « …Text » éclaircis pour rester lisibles.
 *
 * ⚠️ PAS UN NOIR UNI. La première version (fond #0F1914, cartes #17231D) était « trop sombre
 * partout » : deux verts-noirs à peine distincts, des fonds de matière éteints, un écran plat. On
 * reprend la dynamique de l'ancienne app — même logique que le mode clair, où le fond est un cran
 * en retrait des cartes :
 *   - les cartes RESSORTENT nettement du fond (écart de luminosité franc, filets visibles) ;
 *   - les fonds de matière (eau, racines, fruits…) sont plus saturés : on reconnaît une partie de
 *     l'arbre à sa couleur, même de nuit ;
 *   - un HALO de la couleur d'accent descend du haut de l'écran (`glow`, cf. applyGardenTheme et
 *     GardenGlow), comme le dégradé d'accent de l'ancienne interface.
 */
const DARK: GardenPaletteValues = {
  bg: '#121D18', card: '#21302A', sky: '#18251F',
  ink: '#EEF5F0', inkSoft: '#C6D6CC', muted: '#A7BBAE',
  line: '#35483E', track: '#2D3E35', field: '#283930',
  primary: '#5BC274', primaryPressed: '#4AA862', onPrimary: '#0E1A14',
  water: '#5DB8E0', waterBg: '#183C4D', waterText: '#9AD7F1',
  roots: '#F0B54A', rootsBg: '#47371A', rootsText: '#F6CF83',
  branches: '#5BC274', branchesBg: '#1D4029', branchesText: '#8EDCA3',
  fruits: '#FF8F5E', fruitsBg: '#4A2A1E', fruitsText: '#FFB18F',
  flowers: '#EE8AAE', flowersBg: '#47253A', flowersText: '#F7B0CB',
  brambles: '#B0729A', bramblesBg: '#3A2234', bramblesText: '#E0AACB',
  pico: '#45341D', picoText: '#F5D09E',
  notice: '#46381A', noticeText: '#F6D886',
  glow: '#1E3A2A',
};

/**
 * Couleurs du Jardin ACTIVES. Objet MUTABLE : `applyGardenTheme` y verse le mode (clair/sombre) et la
 * couleur d'accent choisis dans Apparence. Les composants le relisent à chaque rendu ; les pages se
 * redessinent quand le thème change (GardenPage).
 */
export const GARDEN_COLORS: GardenPaletteValues = { ...LIGHT };

export type GardenColor = keyof typeof GARDEN_COLORS;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Mélange deux couleurs : `t` = part de `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const A = hex(a), B = hex(b);
  return '#' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const lum = (h: string) => { const [r, g, b] = hex(h).map((v) => v / 255); return 0.299 * r + 0.587 * g + 0.114 * b; };

let themeKey = 'light|default';
/** Applique le mode et l'accent aux couleurs actives. `accent` absent = le vert du Jardin. */
export function applyGardenTheme(mode: 'light' | 'dark', accent?: string | null): string {
  const base = mode === 'dark' ? DARK : LIGHT;
  Object.assign(GARDEN_COLORS, base);
  if (accent && /^#[0-9a-fA-F]{6}$/.test(accent)) {
    const a = accent.toUpperCase();
    /* L'accent colore les boutons ET teinte le fond, comme avant la refonte. En sombre, un accent trop
       foncé est éclairci pour rester visible. */
    const primary = mode === 'dark' && lum(a) < 0.45 ? mixHex(a, '#FFFFFF', 0.7) : a;
    GARDEN_COLORS.primary = primary;
    GARDEN_COLORS.primaryPressed = mixHex(primary, mode === 'dark' ? '#FFFFFF' : '#000000', 0.85);
    GARDEN_COLORS.onPrimary = lum(primary) > 0.6 ? '#10201A' : '#FFFFFF';
    GARDEN_COLORS.bg = mixHex(a, base.bg, mode === 'dark' ? 0.12 : 0.12);
    GARDEN_COLORS.sky = mixHex(a, base.sky, mode === 'dark' ? 0.1 : 0.1);
    GARDEN_COLORS.track = mixHex(a, base.track, 0.14);
    GARDEN_COLORS.field = mixHex(a, base.field, 0.08);
    GARDEN_COLORS.line = mixHex(a, base.line, 0.14);
    // En sombre, les cartes prennent aussi un soupçon d'accent : elles appartiennent au même décor.
    if (mode === 'dark') GARDEN_COLORS.card = mixHex(a, base.card, 0.06);
    GARDEN_COLORS.glow = mode === 'dark' ? mixHex(a, base.bg, 0.3) : GARDEN_COLORS.bg;
  } else {
    GARDEN_COLORS.glow = mode === 'dark' ? DARK.glow : GARDEN_COLORS.bg;
  }
  themeKey = `${mode}|${accent ?? 'default'}`;
  return themeKey;
}
/** Clé du thème appliqué (pour redessiner une page quand il change). */
export const gardenThemeKey = () => themeKey;

export const GARDEN_RADII = { sm: 12, md: 18, lg: 24, xl: 28, pill: 999 } as const;
export const GARDEN_SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/** Taille minimale d'une cible tactile (doigt), toutes plateformes. */
export const GARDEN_TOUCH = 44;

/**
 * Styles de texte. Chaque graisse est une FAMILLE distincte (`Nunito_700Bold`…) et `fontWeight`
 * reste à 'normal' : demander `fontWeight: '700'` sur une famille chargée par expo-font fait
 * retomber Android sur Roboto (même piège que la police du nom de l'app, cf. useBrandFont).
 */
export const GARDEN_TEXT = {
  display: { fontFamily: GARDEN_FONTS.display, fontSize: 32, lineHeight: 36 },
  title: { fontFamily: GARDEN_FONTS.display, fontSize: 24, lineHeight: 29 },
  heading: { fontFamily: GARDEN_FONTS.display, fontSize: 19, lineHeight: 24 },
  amount: { fontFamily: GARDEN_FONTS.display, fontSize: 40, lineHeight: 44 },
  body: { fontFamily: GARDEN_FONTS.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: GARDEN_FONTS.bodyBold, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: GARDEN_FONTS.body, fontSize: 13, lineHeight: 18 },
  smallStrong: { fontFamily: GARDEN_FONTS.bodyBold, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: GARDEN_FONTS.bodyHeavy, fontSize: 12, lineHeight: 16, letterSpacing: 1, textTransform: 'uppercase' as const },
} as const;

export type GardenTextVariant = keyof typeof GARDEN_TEXT;
