/**
 * FontApplier — applique la police globale définie dans le Style Editor.
 * Sur web : injecte une règle CSS qui force la font-family sur toute l'app.
 * Sur natif : sans effet (les polices custom nécessiteraient expo-font).
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useStyleConfig } from '../hooks/useStyleConfig';

export default function FontApplier() {
  const { data: styleConfig } = useStyleConfig();
  const font = styleConfig?.font_family ?? 'System';

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

    // Force la police sur tous les éléments texte de React Native Web.
    el.textContent = `
      [data-testid], body, #root, .css-text-146c3p1, div, span, p, input, textarea, button {
        font-family: ${font} !important;
      }
    `;
  }, [font]);

  return null;
}
