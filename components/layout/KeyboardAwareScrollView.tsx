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
import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import {
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import { useKeyboardHeight } from '../../hooks/platform/useKeyboardHeight';
import { scrollFocusedInputIntoView } from '../../lib/ui/keyboardScroll';

interface Props extends ScrollViewProps {
  /** Marge de confort ajoutée sous le contenu quand le clavier est ouvert. */
  keyboardExtraBottom?: number;
}

const KeyboardAwareScrollView = forwardRef<ScrollView, Props>(
  (
    {
      keyboardShouldPersistTaps = 'handled',
      keyboardExtraBottom = 24,
      onScroll,
      scrollEventThrottle,
      contentContainerStyle,
      ...props
    },
    forwardedRef,
  ) => {
    const innerRef = useRef<ScrollView | null>(null);
    const scrollY = useRef(0);
    const kbHeight = useKeyboardHeight();

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

    const ensureVisible = useCallback(() => {
      scrollFocusedInputIntoView(innerRef.current, scrollY.current, kbHeight);
    }, [kbHeight]);

    // Ouverture du clavier : on attend que le padding bas soit appliqué pour pouvoir scroller loin.
    useEffect(() => {
      if (kbHeight <= 0) return;
      const t = setTimeout(ensureVisible, 60);
      return () => clearTimeout(t);
    }, [kbHeight, ensureVisible]);

    // Passage d'un champ à l'autre clavier déjà ouvert.
    const handleTouchCapture = useCallback(() => {
      setTimeout(ensureVisible, 120);
      return false;
    }, [ensureVisible]);

    return (
      <ScrollView
        ref={setRefs}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onStartShouldSetResponderCapture={handleTouchCapture}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        contentContainerStyle={[
          contentContainerStyle,
          kbHeight > 0 ? { paddingBottom: kbHeight + keyboardExtraBottom } : null,
        ]}
        {...props}
      />
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
