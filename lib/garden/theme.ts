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
/* Refonte du 22/10/2026 : fond vert-ardoise un cran plus clair (#1C2823 au lieu d'un quasi-noir),
   cartes nettement au-dessus (rapport 1,5:1 avec le fond), champs et pistes encore un cran plus
   haut. CHAQUE couleur de texte (encre, …Text, pico, notice) a été vérifiée à ≥ 4,5:1 sur le fond,
   les cartes, les champs et son propre fond de matière : rien d'illisible où qu'il se pose. */
const DARK: GardenPaletteValues = {
  /* Surfaces en GRIS ARDOISE NEUTRE, un cran plus clair : un fond vert-noir donnait du « ton sur
     ton » (cartes, fond et matières dans la même famille) et teintait tout de vert, quel que soit
     l'accent choisi. Le neutre laisse la couleur aux matières et à l'accent. */
  bg: '#2A3036', card: '#3D444C', sky: '#30363D',
  ink: '#F5F7F9', inkSoft: '#DCE1E6', muted: '#C2C9D0',
  line: '#646D78', track: '#4E5660', field: '#454D56',
  primary: '#72D28C', primaryPressed: '#5EBD78', onPrimary: '#0F1E16',
  /* Fonds de matière VIVANTS, chacun dans sa vraie teinte (bleu, doré, vert, orangé, rose) : ils se
     reconnaissent sur le gris des cartes comme les pastels du mode clair sur le blanc. */
  water: '#5DB8E0', waterBg: '#245E7E', waterText: '#B0E4FA',
  roots: '#F0B54A', rootsBg: '#6B5019', rootsText: '#FFE0A0',
  branches: '#5BC274', branchesBg: '#22643D', branchesText: '#A8EBBB',
  fruits: '#FF8F5E', fruitsBg: '#7A3A20', fruitsText: '#FFC7AD',
  flowers: '#EE8AAE', flowersBg: '#722E56', flowersText: '#FFC6DC',
  brambles: '#B0729A', bramblesBg: '#5E2E55', bramblesText: '#F0C2DE',
  pico: '#684B25', picoText: '#FFDDB0',
  notice: '#6B531A', noticeText: '#FFE69C',
  // Halo du haut : un simple éclaircissement neutre (pas de vert) ; avec un accent, il en prend la teinte.
  glow: '#353C44',
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

/** Valeurs par défaut du Jardin, par mode (référence du Style Editor : « Défaut »). */
export const GARDEN_DEFAULTS: Record<'light' | 'dark', GardenPaletteValues> = { light: LIGHT, dark: DARK };

/** Surcharges de l'admin (Style Editor) : une couleur hex par clé de la palette, par mode. */
export type GardenOverrides = Partial<GardenPaletteValues>;

/**
 * Dégradé du haut des pages (réglé dans le Style Editor, par mode) : il part de la couleur d'accent
 * (ou de la couleur « glow » choisie) et se fond dans le fond de page. Désactivé = fond uni.
 */
export interface GardenGlowConfig {
  enabled: boolean;
  /** Part de la couleur du dégradé en haut de page, 0 → 60 %. */
  strength: number;
  /** Hauteur du dégradé, en px. */
  height: number;
}
export const GARDEN_GLOW_DEFAULTS: Record<'light' | 'dark', GardenGlowConfig> = {
  light: { enabled: false, strength: 10, height: 520 },
  dark: { enabled: true, strength: 12, height: 520 },
};
export function mergeGlow(mode: 'light' | 'dark', raw?: Partial<GardenGlowConfig> | null): GardenGlowConfig {
  const d = GARDEN_GLOW_DEFAULTS[mode];
  const n = (v: unknown, fb: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
  return { enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : d.enabled, strength: n(raw?.strength, d.strength, 0, 60), height: n(raw?.height, d.height, 120, 1200) };
}
/** Hauteur du dégradé actif (lue par GardenGlow). */
export let GARDEN_GLOW_HEIGHT = 520;

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Couleurs du Jardin pour un mode, un accent et les surcharges de l'admin — CALCUL PUR (l'aperçu du
 * Style Editor s'en sert sans toucher aux couleurs actives).
 * Les surcharges remplacent la palette de BASE ; l'accent choisi par chacun la teinte ensuite, comme
 * avant (avec l'accent par défaut, la couleur saisie s'affiche donc telle quelle).
 */
export function gardenThemeColors(mode: 'light' | 'dark', accent?: string | null, overrides?: GardenOverrides | null, glowCfg?: Partial<GardenGlowConfig> | null): GardenPaletteValues {
  const clean: GardenOverrides = {};
  for (const [k, v] of Object.entries(overrides ?? {})) if (isHex(v)) (clean as any)[k] = v.toUpperCase();
  const base: GardenPaletteValues = { ...(mode === 'dark' ? DARK : LIGHT), ...clean };
  if (clean.primary && !clean.primaryPressed) base.primaryPressed = mixHex(base.primary, mode === 'dark' ? '#FFFFFF' : '#000000', 0.85);
  if (clean.primary && !clean.onPrimary) base.onPrimary = lum(base.primary) > 0.6 ? '#10201A' : '#FFFFFF';
  const out: GardenPaletteValues = { ...base };
  if (isHex(accent)) {
    const a = accent.toUpperCase();
    /* L'accent colore les boutons ET teinte le fond, comme avant la refonte. En sombre, un accent trop
       foncé est éclairci pour rester visible. */
    const primary = mode === 'dark' && lum(a) < 0.45 ? mixHex(a, '#FFFFFF', 0.7) : a;
    out.primary = primary;
    out.primaryPressed = mixHex(primary, mode === 'dark' ? '#FFFFFF' : '#000000', 0.85);
    out.onPrimary = lum(primary) > 0.6 ? '#10201A' : '#FFFFFF';
    // La nuit, l'accent ne fait qu'effleurer le fond (8 %) ; les CARTES restent neutres.
    out.bg = mixHex(a, base.bg, mode === 'dark' ? 0.08 : 0.12);
    out.sky = mixHex(a, base.sky, 0.1);
    // Nuit : pistes et filets à peine teintés, champs neutres (comme les cartes).
    out.track = mixHex(a, base.track, mode === 'dark' ? 0.08 : 0.14);
    if (mode === 'light') out.field = mixHex(a, base.field, 0.08);
    out.line = mixHex(a, base.line, mode === 'dark' ? 0.06 : 0.14);
  }
  /* Dégradé du haut : couleur choisie (« glow ») ou l'accent, mêlé au fond selon l'intensité réglée.
     Désactivé → égal au fond : GardenGlow ne dessine rien et la barre du haut est unie. */
  const glow = mergeGlow(mode, glowCfg);
  out.glow = !glow.enabled || glow.strength <= 0 ? out.bg : mixHex(clean.glow ?? out.primary, out.bg, glow.strength / 100);
  return out;
}

let themeKey = 'light|default|';
/** Applique le mode, l'accent et les surcharges de l'admin aux couleurs actives. `accent` absent = le vert du Jardin. */
export function applyGardenTheme(mode: 'light' | 'dark', accent?: string | null, overrides?: GardenOverrides | null, glowCfg?: Partial<GardenGlowConfig> | null): string {
  Object.assign(GARDEN_COLORS, gardenThemeColors(mode, accent, overrides, glowCfg));
  GARDEN_GLOW_HEIGHT = mergeGlow(mode, glowCfg).height;
  themeKey = `${mode}|${accent ?? 'default'}|${overrides ? JSON.stringify(overrides) : ''}|${glowCfg ? JSON.stringify(glowCfg) : ''}`;
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
