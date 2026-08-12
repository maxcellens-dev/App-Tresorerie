/**
 * KeyboardAwareScrollView — ScrollView « drop-in » qui remonte le champ saisi EN HAUT de la zone
 * visible (au-dessus du clavier) et laisse assez d'espace en bas pour atteindre tous les champs.
 *
 * Deux mécaniques :
 *  1. Au focus / ouverture clavier → on mesure la position écran du ScrollView et du champ, et on
 *     scrolle pour amener le champ tout en haut de la zone visible (on voit alors les champs en
 *     dessous, plus besoin de scroller à la main).
 *  2. Quand le clavier est ouvert, on ajoute un padding bas = hauteur du clavier → on peut scroller
 *     jusqu'aux derniers champs (sinon ils restent coincés sous le clavier).
 *
 * Usage : remplacer `<ScrollView>` par `<KeyboardAwareScrollView>`. Rien à changer sur les TextInput.
 */
import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  ScrollView,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';

/** Marge entre le haut de la zone visible et le champ remonté. */
const TOP_MARGIN = 12;

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ keyboardShouldPersistTaps = 'handled', onScroll, scrollEventThrottle, contentContainerStyle, ...props }, forwardedRef) => {
    const innerRef = useRef<ScrollView | null>(null);
    const scrollY = useRef(0);
    const [kbHeight, setKbHeight] = useState(0);

    const setRefs = useCallback(
      (node: ScrollView | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<ScrollView | null>).current = node;
      },
      [forwardedRef],
    );

    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      [onScroll],
    );

    // Remonte le champ focalisé tout en haut de la zone visible (au-dessus du clavier).
    const ensureVisible = useCallback(() => {
      const sv = innerRef.current;
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
          // On remonte si le champ est masqué (sous le clavier) OU plus bas que la cible haute.
          if (iy + ih > visibleBottom || iy > targetTop + 4) {
            const delta = iy - targetTop;
            if (delta > 4) sv.scrollTo({ y: Math.max(0, scrollY.current + delta), animated: true });
          }
        });
      });
    }, []);

    useEffect(() => {
      const show = Keyboard.addListener('keyboardDidShow', (e) => {
        setKbHeight(e.endCoordinates?.height ?? 0);
        ensureVisible();
      });
      const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
      return () => { show.remove(); hide.remove(); };
    }, [ensureVisible]);

    // Passage d'un champ à l'autre clavier déjà ouvert.
    const handleTouchCapture = useCallback(() => {
      setTimeout(ensureVisible, 80);
      return false;
    }, [ensureVisible]);

    return (
      <ScrollView
        ref={setRefs}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onStartShouldSetResponderCapture={handleTouchCapture}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        contentContainerStyle={[contentContainerStyle, kbHeight > 0 ? { paddingBottom: kbHeight + 24 } : null]}
        {...props}
      />
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
