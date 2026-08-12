/**
 * useKeyboardAwareScroll — remonte le champ saisi EN HAUT de la zone visible (au-dessus du clavier),
 * variante hook du composant KeyboardAwareScrollView (pour les écrans qui gardent leur ScrollView).
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

const TOP_MARGIN = 12;

export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const ensureVisible = useCallback(() => {
    const sv = scrollRef.current;
    const input: any = TextInput.State.currentlyFocusedInput?.();
    if (!sv || !input || typeof input.measureInWindow !== 'function') return;
    const svNode: any = (sv as any).getNativeScrollRef?.() ?? sv;
    const measureSv = (cb: (sy: number, sh: number) => void) => {
      if (typeof svNode.measureInWindow === 'function') svNode.measureInWindow((_x: number, y: number, _w: number, h: number) => cb(y, h));
      else cb(0, Dimensions.get('window').height);
    };
    measureSv((svTop, svH) => {
      input.measureInWindow((_ix: number, iy: number, _iw: number, ih: number) => {
        const kb = Keyboard.metrics?.();
        const keyboardTop = kb ? kb.screenY : Dimensions.get('window').height;
        const visibleBottom = Math.min(svTop + svH, keyboardTop);
        const targetTop = svTop + TOP_MARGIN;
        if (iy + ih > visibleBottom || iy > targetTop + 4) {
          const delta = iy - targetTop;
          if (delta > 4) sv.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: true });
        }
      });
    });
  }, []);

  const handleFocus = useCallback(() => {
    setTimeout(ensureVisible, Platform.OS === 'android' ? 80 : 0);
  }, [ensureVisible]);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', ensureVisible);
    return () => sub.remove();
  }, [ensureVisible]);

  return { scrollRef, handleFocus, onScroll };
}
