/**
 * useKeyboardClearance — padding EXACT pour garder une zone (barre de saisie) au-dessus du clavier.
 *
 * Pourquoi pas KeyboardAvoidingView / adjustResize ? Sur Android (edge-to-edge, modaux
 * statusBarTranslucent, tab bar…), le resize natif est souvent ignoré et KeyboardAvoidingView mesure
 * faux → saisie masquée. Ici on MESURE : position réelle de la cible à l'écran (measureInWindow) vs
 * haut réel du clavier (endCoordinates.screenY) → on ne compense que le chevauchement réellement
 * constaté. Auto-correct dans les deux mondes : si le système a déjà redimensionné, le chevauchement
 * mesuré est ~0 et on n'ajoute (presque) rien.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

export function useKeyboardClearance(targetRef: React.RefObject<View | null>, margin = 12): number {
  const [pad, setPad] = useState(0);
  const padRef = useRef(0);
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const compute = (e: any) => {
      const kbTop = e?.endCoordinates?.screenY;
      const kbH = e?.endCoordinates?.height ?? 0;
      if (kbTop == null) return;
      // Double rAF : laisse le layout (resize natif éventuel, padding déjà appliqué) se stabiliser
      // avant de mesurer le chevauchement restant.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        targetRef.current?.measureInWindow((_x, y, _w, h) => {
          if (y == null || h == null) return;
          const overlap = Math.max(0, y + h - kbTop + margin);
          const next = Math.max(0, Math.min(kbH + margin, padRef.current + overlap));
          padRef.current = next;
          setPad(next);
        });
      }));
    };
    const s = Keyboard.addListener(showEv, compute);
    // Android : certains claviers (suggestions, emoji) changent de taille sans re-show.
    const c = Platform.OS === 'android' ? Keyboard.addListener('keyboardDidChangeFrame' as any, compute) : null;
    const hddn = Keyboard.addListener(hideEv, () => { padRef.current = 0; setPad(0); });
    return () => { s.remove(); c?.remove(); hddn.remove(); };
  }, [targetRef, margin]);
  return pad;
}
