/**
 * FontApplier — applique la police globale définie dans le Style Editor.
 * Sur web : injecte une règle CSS qui force la font-family sur toute l'app (texte + nom).
 * Sur natif : charge les polices IMPORTÉES (expo-font, depuis leur URL) → le NOM de l'app (déjà rendu
 *   en fontFamily via useAppNameFont) se résout. La police du TEXTE global reste web-only (une police
 *   globale fiable sur natif nécessiterait un rechargement complet de l'app).
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useStyleConfig } from '../hooks/useStyleConfig';
import { injectGoogleFonts } from '../lib/webFonts';
import { ensureNativeFonts } from '../lib/nativeFonts';

function fontFormat(url: string): string {
  return /\.woff2(\?.*)?$/i.test(url) ? 'woff2'
    : /\.woff(\?.*)?$/i.test(url) ? 'woff'
    : /\.otf(\?.*)?$/i.test(url) ? 'opentype' : 'truetype';
}

export default function FontApplier() {
  const { data: styleConfig } = useStyleConfig();
  const font = styleConfig?.font_family ?? 'System';
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
    injectGoogleFonts('app-google-fonts', [font, appNameFont]);
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

    if (font === 'System') {
      el.textContent = '';
      return;
    }

    // Force la police sur le texte de React Native Web — MAIS jamais sur les icônes
    // @expo/vector-icons (sinon le !important écrase leur fontFamily 'Ionicons' → glyphes en carrés).
    // On les exclut via : `.app-vicon` (classe posée au runtime par l'effet ci-dessous, fiable en
    // dev ET en prod) + `[class*="r-fontFamily"]` (classe RNW, présente en dev → zéro flash).
    // `:not([data-appfont])` → on laisse les éléments du NOM de l'app garder LEUR police (app_name_font),
    // sinon ce !important l'écraserait.
    // `:not([data-fontpreview])` → les APERÇUS du Style Editor gardent la police EN COURS de sélection
    // (leur fontFamily inline), au lieu d'être forcés à la police globale sauvegardée.
    el.textContent = `
      [data-testid]:not(.app-vicon):not([class*="r-fontFamily"]):not([data-appfont]):not([data-fontpreview]),
      body, #root,
      .css-text-146c3p1:not(.app-vicon):not([class*="r-fontFamily"]):not([data-appfont]):not([data-fontpreview]),
      div:not(.app-vicon):not([class*="r-fontFamily"]):not([data-appfont]):not([data-fontpreview]),
      span:not(.app-vicon):not([class*="r-fontFamily"]):not([data-appfont]):not([data-fontpreview]),
      p:not([data-appfont]):not([data-fontpreview]), input, textarea, button {
        font-family: ${font} !important;
      }
      /* Le NOM de l'app garde SA police (priorité absolue). */
      [data-appfont]:not([data-fontpreview]), [data-appfont] * { font-family: ${appNameFont || font} !important; }
    `;
  }, [font, appNameFont]);

  // Marque les icônes vector (élément dont le texte est un SEUL glyphe en zone d'usage privé Unicode)
  // d'une classe stable `app-vicon`, pour les exclure de la police globale quel que soit le build
  // (en prod, les classes RNW deviennent `r-<hash>` et ne sont plus reconnaissables par leur nom).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (font === 'System') return; // pas de police globale appliquée → rien à protéger
    const ICON_CLASS = 'app-vicon';
    const isIconGlyph = (s: string | null): boolean => {
      if (!s) return false;
      const chars = Array.from(s.trim());
      if (chars.length !== 1) return false;
      const cp = chars[0].codePointAt(0) ?? 0;
      return (cp >= 0xe000 && cp <= 0xf8ff)        // BMP Private Use Area
        || (cp >= 0xf0000 && cp <= 0xffffd)        // Supplementary PUA-A
        || (cp >= 0x100000 && cp <= 0x10fffd);     // Supplementary PUA-B
    };
    const tag = (el: Element) => {
      if (!el.classList.contains(ICON_CLASS) && isIconGlyph(el.textContent)) el.classList.add(ICON_CLASS);
    };
    const scan = (root: Element) => { tag(root); root.querySelectorAll('*').forEach(tag); };
    scan(document.body);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n as Element); });
        if (m.type === 'characterData') {
          const parent = (m.target as CharacterData).parentElement;
          if (parent) tag(parent);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [font]);

  return null;
}
