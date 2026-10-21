/**
 * FontApplier — applique la police globale définie dans le Style Editor.
 * Sur web : injecte une règle CSS qui force la font-family sur toute l'app (texte + nom).
 * Sur natif : charge les polices IMPORTÉES (expo-font, depuis leur URL) → le NOM de l'app (déjà rendu
 *   en fontFamily via useAppNameFont) se résout. La police du TEXTE global reste web-only (une police
 *   globale fiable sur natif nécessiterait un rechargement complet de l'app).
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useStyleConfig } from '../../hooks/theme/useStyleConfig';
import { injectGoogleFonts } from '../../lib/platform/webFonts';
import { ensureNativeFonts } from '../../lib/platform/nativeFonts';
import { useGardenFonts } from '../../hooks/garden/useGardenFonts';
import { GARDEN_FONTS } from '../../lib/garden/fontFamilies';

function fontFormat(url: string): string {
  return /\.woff2(\?.*)?$/i.test(url) ? 'woff2'
    : /\.woff(\?.*)?$/i.test(url) ? 'woff'
    : /\.otf(\?.*)?$/i.test(url) ? 'opentype' : 'truetype';
}

export default function FontApplier() {
  const { data: styleConfig } = useStyleConfig();
  /* JARDIN (web) : le texte de TOUS les écrans existants passe en Nunito, la police du Jardin.
     Les textes du Jardin qui fixent leur propre famille (Fredoka des titres) gardent la leur : la
     règle globale exclut déjà les éléments porteurs d'un fontFamily explicite. Sur natif, une police
     globale n'est pas fiable (cf. en-tête) : seuls les écrans du Jardin y sont en Nunito.
     `font` change avec l'interrupteur → les effets ci-dessous se relancent d'eux-mêmes. */
  useGardenFonts();
  const font = `${GARDEN_FONTS.body}, Nunito, system-ui, sans-serif`;
  const importUrl = styleConfig?.font_import_url?.trim() ?? '';
  const appNameFont = styleConfig?.app_name_font?.trim() ?? '';
  const customFonts = styleConfig?.custom_fonts ?? [];
  const customFontsKey = JSON.stringify(customFonts);

  // ── NATIF — Charger les polices IMPORTÉES (téléversées) depuis leur URL via expo-font. ──
  // Une fois chargée, la famille se résout là où on l'utilise en fontFamily (nom de l'app).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ensureNativeFonts(customFonts as any);
  }, [customFontsKey]);

  // Polices Google prédéfinies (Inter, DM Sans, Plus Jakarta Sans…) : chargées à la demande sur web
  // quand elles sont sélectionnées (police globale ou police du nom de l'app).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (false) injectGoogleFonts('app-google-fonts', [font, appNameFont]);
  }, [font, appNameFont]);

  // Polices téléversées (fichiers Supabase) → une règle @font-face par police. Web uniquement.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const FACES_ID = 'app-custom-fonts';
    let el = document.getElementById(FACES_ID) as HTMLStyleElement | null;
    const valid = customFonts.filter((f) => f?.family && f?.url);
    if (valid.length === 0) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('style');
      el.id = FACES_ID;
      document.head.appendChild(el);
    }
    el.textContent = valid
      .map((f) => `@font-face { font-family: '${f.family}'; src: url('${f.url}') format('${fontFormat(f.url)}'); font-display: swap; }`)
      .join('\n');
  }, [customFontsKey]);

  // Import optionnel via URL : fichier de police → @font-face (famille = nom du titre) ; sinon lien CSS.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const LINK_ID = 'app-custom-font-import';
    const FACE_ID = 'app-custom-font-face';
    const link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    let face = document.getElementById(FACE_ID) as HTMLStyleElement | null;
    const isFontFile = /\.(ttf|otf|woff2?|eot)(\?.*)?$/i.test(importUrl);
    // Si l'URL correspond déjà à une police téléversée (custom_fonts), ne rien dupliquer.
    const alreadyCustom = customFonts.some((f) => f?.url === importUrl);

    if (!importUrl || alreadyCustom) {
      link?.remove();
      face?.remove();
      return;
    }
    if (isFontFile && appNameFont) {
      link?.remove();
      if (!face) {
        face = document.createElement('style');
        face.id = FACE_ID;
        document.head.appendChild(face);
      }
      face.textContent = `@font-face { font-family: '${appNameFont}'; src: url('${importUrl}') format('${fontFormat(importUrl)}'); font-display: swap; }`;
    } else {
      face?.remove();
      let l = link;
      if (!l) {
        l = document.createElement('link');
        l.id = LINK_ID;
        l.rel = 'stylesheet';
        document.head.appendChild(l);
      }
      if (l.href !== importUrl) l.href = importUrl;
    }
  }, [importUrl, appNameFont, customFontsKey]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const STYLE_ID = 'app-global-font';
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }

    // Le NOM de l'app garde SA police (priorité absolue).
    el.textContent = `
      body, #root { font-family: ${font}; }
      [data-appfont]:not([data-fontpreview]), [data-appfont] * { font-family: ${appNameFont || font} !important; }
    `;
  }, [font, appNameFont]);

  /* Police PAR DÉFAUT du texte (web) : on réécrit la famille des règles de base de React Native Web
     (`.css-…` de Text / TextInput, police système « 14px -apple-system… ») DANS leur propre feuille.
     Elles restent ainsi sous les classes atomiques d'un `fontFamily` explicite (Fredoka des titres,
     Nunito gras…), qui gagnent toujours — une règle globale `!important` (l'ancienne méthode) les
     écrasait toutes : sur le site, chaque titre et chaque gras retombait en Nunito normal.
     Seule la DÉCLARATION change (pas le nombre de règles) → la comptabilité interne de RNW est
     intacte. Les règles de base d'un composant arrivent à son premier rendu : on revérifie quand
     la feuille grandit. */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let seen = -1;
    const patch = () => {
      const sheet = (document.getElementById('react-native-stylesheet') as HTMLStyleElement | null)?.sheet;
      if (!sheet || sheet.cssRules.length === seen) return;
      seen = sheet.cssRules.length;
      for (const r of Array.from(sheet.cssRules) as CSSStyleRule[]) {
        if (r.selectorText?.startsWith('.css-') && /-apple-system/.test(r.style?.fontFamily ?? '')) r.style.fontFamily = font;
      }
    };
    patch();
    const obs = new MutationObserver(patch);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [font]);

  return null;
}
