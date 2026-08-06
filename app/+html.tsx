// Document HTML racine pour le rendu web (Expo Router).
//
// ⚠️ NON UTILISÉ EN L'ÉTAT : `app.json` déclare `web.output: "single"`, et Expo prend alors
// `public/index.html` comme coquille — ce fichier n'est appliqué qu'en rendu STATIQUE
// (`output: "static"`). Vérifié : le `index.html` d'`expo export --platform web` est bien la copie
// de `public/index.html`. Toute modification du <head> ou du chargement web doit donc se faire
// dans `public/index.html`, sous peine de n'avoir aucun effet en production.
// Conservé pour le jour d'un passage au rendu statique (SEO sans JS).
//
// Contrôle le viewport pour une expérience type "app" sur iPhone :
// pas de zoom par pincement, pas de rebond/overscroll, page verrouillée à l'écran.
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* maximum-scale + user-scalable=no : empêche le zoom par pincement et le décalage de la page sur iOS */}
        {/* viewport-fit=cover : gère les encoches (safe areas) des iPhone */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        {/* App web installable (plein écran sur iOS) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* SEO de BASE (statique) — repli pour les crawlers sans JS (aperçus sociaux). Les valeurs
            fines sont appliquées au runtime par le SEO Center (composant SeoHead, admin-paramétrable). */}
        <title>Relyka — Pilote ta trésorerie personnelle</title>
        <meta name="description" content="Relyka t'aide à piloter ta trésorerie au quotidien : reste à vivre, projections, épargne et investissement, en toute sérénité." />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Relyka" />
        <meta property="og:title" content="Relyka — Pilote ta trésorerie personnelle" />
        <meta property="og:description" content="Pilote ta trésorerie au quotidien : reste à vivre, projections, épargne et investissement." />
        <meta name="twitter:card" content="summary_large_image" />
        {/* Nom du site dans Google (la ligne au-dessus de l'URL) : il vient des données
            structurées `WebSite` de la page d'accueil. MIROIR de public/index.html — c'est ce
            dernier qui s'applique réellement tant que web.output vaut "single". */}
        <meta name="application-name" content="Relyka" />
        <script type="application/ld+json" data-seo="1" dangerouslySetInnerHTML={{ __html: SITE_JSON_LD }} />

        <ScrollViewStyleReset />
        {/* AVANT toute peinture : applique le dernier thème admin connu (localStorage) au loader
            statique → plus de flash sombre quand l'admin a paramétré le thème clair. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_THEME_JS }} />
        <style dangerouslySetInnerHTML={{ __html: LOCK_VIEWPORT_CSS }} />
        {/* Finitions bureau — doit rester le MIROIR du bloc `#desktop-web` de public/index.html
            (c'est ce dernier qui s'applique réellement tant que web.output vaut "single"). */}
        <style dangerouslySetInnerHTML={{ __html: DESKTOP_WEB_CSS }} />
        <style dangerouslySetInnerHTML={{ __html: BOOT_LOADER_CSS }} />
      </head>
      <body>
        {/* Écran de chargement instantané (avant le montage de React) — évite l'écran blanc.
            Logo seul, identique à AppLoading → aucune jonction visible pendant le chargement. */}
        <div id="app-boot">
          <div className="boot-logo" />
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: BOOT_HIDE_JS }} />
      </body>
    </html>
  );
}

// Verrouille la fenêtre : pas de rebond iOS, pas de scroll global, pas de
// sélection/menu tactile intempestif. Le scroll se fait dans les ScrollView internes.
/** Données structurées de la page d'accueil — source du NOM DU SITE affiché par Google. */
const SITE_JSON_LD = JSON.stringify([
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Relyka',
    url: 'https://relyka.app',
    logo: 'https://relyka.app/icon-512.png',
  },
  { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Relyka', url: 'https://relyka.app' },
]);

const LOCK_VIEWPORT_CSS = `
html, body, #root {
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  position: fixed;
  overscroll-behavior: none;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
}
* {
  -webkit-tap-highlight-color: transparent;
}
`;

// Finitions « site web » sur écran d'ordinateur (>= 1024 px) : curseur, ascenseurs discrets,
// sélection de texte, survols pilotés par `data-hover` (cf. lib/webLayout). Sous la media query,
// donc sans effet sur téléphone et tablette. MIROIR du bloc `#desktop-web` de public/index.html.
const DESKTOP_WEB_CSS = `
@media (min-width: 1024px) {
  body { -webkit-user-select: text; user-select: text; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  [role="button"], [role="link"], [role="tab"], button, nav { -webkit-user-select: none; user-select: none; }
  [role="button"], [role="link"], button, a, [role="tab"], summary { cursor: pointer; }
  [role="button"][aria-disabled="true"], button[disabled] { cursor: not-allowed; }
  input, textarea, [contenteditable] { cursor: text; }
  * { scrollbar-width: thin; scrollbar-color: rgba(140,140,140,.38) transparent; }
  ::-webkit-scrollbar { width: 11px; height: 11px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(140,140,140,.32); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(140,140,140,.55); background-clip: content-box; }
  [data-hover] { transition: background-color .15s ease, box-shadow .18s ease, transform .18s ease, border-color .15s ease; }
  [data-hover="row"]:hover { background-color: rgba(128,128,128,.10); }
  [data-hover="tint"]:hover { filter: brightness(1.08); }
  [data-hover="card"]:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,.16), 0 2px 6px rgba(0,0,0,.10); }
  [data-hover]:active { transform: none; }
}
::selection { background: rgba(0, 182, 122, 0.26); }
`;

// Lit le dernier thème connu (clés alignées sur lib/themeBoot.ts) et fixe les variables CSS du
// loader AVANT la première peinture. Priorité au thème UTILISATEUR (refresh d'une page connectée),
// repli sur le thème ADMIN (pré-auth), puis — si rien n'est connu (1ère visite) — une couleur
// INTERMÉDIAIRE neutre (#808F88, entre clair et sombre) pour minimiser l'écart au démarrage.
const BOOT_THEME_JS = `
(function () {
  function mode() {
    try {
      var u = localStorage.getItem('relyka.user.theme');
      if (u) { var m = JSON.parse(u).mode; if (m === 'light' || m === 'dark') return m; }
    } catch (e) {}
    try {
      var a = localStorage.getItem('relyka.admin.theme');
      if (a === 'light' || a === 'dark') return a;
    } catch (e) {}
    return null;
  }
  try {
    var m = mode();
    var bg = m === 'light' ? '#F4EFE6' : m === 'dark' ? '#0D2E2A' : '#808F88';
    document.documentElement.style.setProperty('--boot-bg', bg);
  } catch (e) {}
})();
`;

// Loader affiché immédiatement (HTML statique) le temps que le bundle JS charge et que React monte.
// LOGO SEUL, visuellement identique au composant AppLoading (même image, même taille, même centrage)
// → aucune jonction visible. Sortie calquée sur le splash natif : fondu + glissement vers le haut.
// `icon-512.png` est l'exact même fichier que assets/logo.png (utilisé par le splash natif) ; le
// favicon, lui, est une autre image → il ferait un saut visuel au montage de React.
const BOOT_LOADER_CSS = `
#app-boot {
  position: fixed; inset: 0; z-index: 99999; background: var(--boot-bg, #808F88);
  display: flex; align-items: center; justify-content: center;
  transition: opacity .34s ease-in;
}
#app-boot .boot-logo {
  width: 96px; height: 96px;
  background: url('/icon-512.png') center / contain no-repeat;
  transition: transform .34s cubic-bezier(.4,0,1,1);
}
/* Sortie : le calque s'efface pendant que le logo file vers le haut (comme AnimatedSplash). */
#app-boot.boot-out { opacity: 0; }
#app-boot.boot-out .boot-logo { transform: translateY(-64px); }
/* Respect des préférences système : pas de mouvement si l'utilisateur le demande. */
@media (prefers-reduced-motion: reduce) {
  #app-boot .boot-logo { transition: none; }
  #app-boot.boot-out .boot-logo { transform: none; }
}
`;

// Retire le loader quand la VRAIE app est peinte, avec la même sortie que le splash natif.
// Pas seulement « React a monté » : React monte souvent sur AppLoading, qui affiche le MÊME logo au
// même endroit. Sortir à ce moment ferait glisser un logo vers le haut par-dessus un logo immobile.
// On attend donc que le marqueur [data-app-loading] ait disparu du DOM (cf. components/AppLoading).
const BOOT_HIDE_JS = `
(function () {
  var done = false;
  function hide() {
    if (done) return;
    done = true;
    var el = document.getElementById('app-boot');
    if (!el) return;
    el.className = 'boot-out'; // fondu + logo vers le haut (cf. BOOT_LOADER_CSS)
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 400);
  }
  function painted(root) {
    return root.childNodes.length > 0 && !root.querySelector('[data-app-loading]');
  }
  function start() {
    var root = document.getElementById('root');
    if (!root) { window.addEventListener('load', function () { setTimeout(hide, 300); }); return; }
    if (painted(root)) { setTimeout(hide, 150); return; }
    var obs = new MutationObserver(function () {
      if (painted(root)) { obs.disconnect(); setTimeout(hide, 150); }
    });
    obs.observe(root, { childList: true, subtree: true });
    setTimeout(hide, 8000); // filet de sécurité : ne jamais rester bloqué sur le logo
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`;
