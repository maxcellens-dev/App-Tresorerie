/**
 * useKeyboardAwareScroll — remonte le champ saisi au-dessus du clavier (variante hook du composant
 * KeyboardAwareScrollView, pour les écrans qui gardent leur propre ScrollView + scrollRef).
 *
 * Calcul MANUEL fiable : on suit l'offset de scroll (`onScroll`), et au focus / à l'ouverture du
 * clavier on mesure la position ÉCRAN réelle du champ (`measureInWindow`) + le haut du clavier
 * (`Keyboard.metrics`) ; si le champ passe sous le clavier, on REMONTE le contenu du delta nécessaire.
 *
 * Usage :
 *   const { scrollRef, handleFocus, onScroll } = useKeyboardAwareScroll();
 *   <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled">
 *     <TextInput onFocus={handleFocus} ... />
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

export function useKeyboardAwareScroll(extraOffset = 24) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const ensureVisible = useCallback(() => {
    const sv = scrollRef.current;
    const input: any = TextInput.State.currentlyFocusedInput?.();
    if (!sv || !input || typeof input.measureInWindow !== 'function') return;
    const kb = Keyboard.metrics?.();
    const keyboardTop = kb ? kb.screenY : Dimensions.get('window').height;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const desiredBottom = keyboardTop - extraOffset;
      const inputBottom = y + h;
      if (inputBottom > desiredBottom) {
        sv.scrollTo({ y: scrollY.current + (inputBottom - desiredBottom), animated: true });
      }
    });
  }, [extraOffset]);

  const handleFocus = useCallback(() => {
    // Laisse le clavier s'ouvrir / le focus se poser avant de mesurer.
    setTimeout(ensureVisible, Platform.OS === 'android' ? 80 : 0);
  }, [ensureVisible]);

  // Première ouverture : le clavier n'est mesurable qu'une fois affiché.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', ensureVisible);
    return () => sub.remove();
  }, [ensureVisible]);

  return { scrollRef, handleFocus, onScroll };
}
