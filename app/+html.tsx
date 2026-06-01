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
      </head>
      <body>{children}</body>
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
