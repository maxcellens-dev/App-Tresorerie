// Document HTML racine pour le rendu web (Expo Router).
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

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: LOCK_VIEWPORT_CSS }} />
        <style dangerouslySetInnerHTML={{ __html: BOOT_LOADER_CSS }} />
      </head>
      <body>
        {/* Écran de chargement instantané (avant le montage de React) — évite l'écran blanc */}
        <div id="app-boot">
          <div className="boot-logo" />
          <div className="boot-brand">Relyka</div>
          <div className="boot-ring" />
        </div>
        {children}
        <script dangerouslySetInnerHTML={{ __html: BOOT_HIDE_JS }} />
      </body>
    </html>
  );
}

// Verrouille la fenêtre : pas de rebond iOS, pas de scroll global, pas de
// sélection/menu tactile intempestif. Le scroll se fait dans les ScrollView internes.
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

// Loader affiché immédiatement (HTML statique) le temps que le bundle JS charge et que React monte.
// Visuellement identique au composant AppLoading → transition invisible.
const BOOT_LOADER_CSS = `
#app-boot {
  position: fixed; inset: 0; z-index: 99999; background: #0D2E2A;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  transition: opacity .4s ease;
}
#app-boot .boot-logo {
  width: 96px; height: 96px;
  background: url('/favicon.png') center / contain no-repeat;
  animation: bootPulse 1.7s ease-in-out infinite;
}
#app-boot .boot-brand {
  margin-top: 22px; color: #fff; font-weight: 800; letter-spacing: .5px; font-size: 22px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#app-boot .boot-ring {
  margin-top: 26px; width: 30px; height: 30px; border-radius: 50%;
  border: 3px solid rgba(0,182,122,.2); border-top-color: #00B67A;
  animation: bootSpin 1s linear infinite;
}
@keyframes bootPulse { 0%,100% { transform: scale(.92); opacity: .65 } 50% { transform: scale(1.06); opacity: 1 } }
@keyframes bootSpin { to { transform: rotate(360deg) } }
`;

// Retire le loader dès que React a injecté du contenu dans #root (avec un léger fondu).
const BOOT_HIDE_JS = `
(function () {
  function hide() {
    var el = document.getElementById('app-boot');
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 400);
  }
  function start() {
    var root = document.getElementById('root');
    if (!root) { window.addEventListener('load', function () { setTimeout(hide, 300); }); return; }
    if (root.childNodes.length > 0) { setTimeout(hide, 150); return; }
    var obs = new MutationObserver(function () {
      if (root.childNodes.length > 0) { obs.disconnect(); setTimeout(hide, 150); }
    });
    obs.observe(root, { childList: true });
    setTimeout(hide, 8000); // filet de sécurité
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`;
