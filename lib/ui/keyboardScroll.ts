/**
 * scrollFocusedInputIntoView — remonte le champ actuellement focalisé EN HAUT de la zone visible
 * (juste sous le haut du ScrollView, au-dessus du clavier), de sorte que les champs et boutons
 * SUIVANTS deviennent visibles sans avoir à scroller à la main.
 *
 * Utilisé par KeyboardAwareScrollView, KeyboardAwareOverlay et useKeyboardAwareScroll : une seule
 * implémentation pour tout le monde.
 *
 * `keyboardHeight` (mesuré par useKeyboardHeight) prime sur `Keyboard.metrics()`, qui sous-estime la
 * hauteur du clavier sur Android (Gboard déclare ses insets sans son bandeau d'outils) : on retient
 * le haut de clavier le PLUS HAUT des deux, quitte à remonter un peu trop.
 *
 * Note web : on n'utilise QUE measureInWindow (findNodeHandle/measureLayout lèvent sur
 * react-native-web).
 */
import { Dimensions, Keyboard, TextInput, type ScrollView } from 'react-native';

/** Marge entre le haut de la zone visible et le champ remonté. */
export const KEYBOARD_TOP_MARGIN = 12;

export function scrollFocusedInputIntoView(
  sv: ScrollView | null | undefined,
  currentScrollY: number,
  keyboardHeight: number = 0,
  topMargin: number = KEYBOARD_TOP_MARGIN,
) {
  const input: any = TextInput.State.currentlyFocusedInput?.();
  if (!sv || !input || typeof input.measureInWindow !== 'function') return;

  const svNode: any = (sv as any).getNativeScrollRef?.() ?? sv;
  const measureSv = (cb: (top: number, height: number) => void) => {
    if (typeof svNode?.measureInWindow === 'function') {
      svNode.measureInWindow((_x: number, y: number, _w: number, h: number) => cb(y, h));
    } else {
      cb(0, Dimensions.get('window').height);
    }
  };

  measureSv((svTop, svH) => {
    input.measureInWindow((_ix: number, iy: number, _iw: number, ih: number) => {
      const windowH = Dimensions.get('window').height;
      const metricsTop = Keyboard.metrics?.()?.screenY ?? windowH;
      const keyboardTop = Math.min(metricsTop, keyboardHeight > 0 ? windowH - keyboardHeight : windowH);
      const visibleBottom = Math.min(svTop + svH, keyboardTop);
      const targetTop = svTop + topMargin;
      // On remonte si le champ est masqué (sous le clavier) OU plus bas que la cible haute.
      if (iy + ih > visibleBottom || iy > targetTop + 4) {
        const delta = iy - targetTop;
        // scrollTo est borné par le contenu : si tout tient déjà à l'écran, rien ne bouge.
        if (delta > 4) sv.scrollTo({ y: Math.max(0, currentScrollY + delta), animated: true });
      }
    });
  });
}
