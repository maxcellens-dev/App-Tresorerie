/**
 * KeyboardAwareScrollView — ScrollView « drop-in » qui remonte le champ saisi au-dessus du clavier.
 *
 * Problème résolu : en tapant dans une zone de saisie (montant, libellé, recherche…), le clavier
 * mobile masque le champ + les boutons qui suivent. Ici on REMONTE le contenu pour garder le champ
 * visible, juste au-dessus du clavier.
 *
 * Calcul MANUEL et fiable (l'API native `scrollResponderScrollNativeHandleToKeyboard` suppose un
 * ScrollView plein écran — faux dès qu'il y a un en-tête au-dessus, ce qui faisait scroller le champ
 * DANS le clavier au lieu de l'en remonter) :
 *   1. on suit l'offset de scroll courant (`onScroll`) ;
 *   2. au focus / à l'ouverture du clavier, on mesure la position ÉCRAN réelle du champ
 *      (`measureInWindow`) et le haut du clavier (`Keyboard.metrics`) ;
 *   3. si le bas du champ passe sous le clavier, on scrolle vers le HAUT du delta nécessaire (+ marge).
 *
 * Usage : remplacer `<ScrollView>` par `<KeyboardAwareScrollView>`. Aucun changement sur les TextInput.
 */
import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Keyboard,
  ScrollView,
  TextInput,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';

/** Marge laissée entre le bas du champ et le haut du clavier. */
const EXTRA_OFFSET = 24;

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ keyboardShouldPersistTaps = 'handled', onScroll, scrollEventThrottle, ...props }, forwardedRef) => {
    const innerRef = useRef<ScrollView | null>(null);
    const scrollY = useRef(0);

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

    // Remonte le champ focalisé au-dessus du clavier s'il est (partiellement) masqué.
    const ensureVisible = useCallback(() => {
      const sv = innerRef.current;
      const input: any = TextInput.State.currentlyFocusedInput?.();
      if (!sv || !input || typeof input.measureInWindow !== 'function') return;
      const kb = Keyboard.metrics?.();
      const keyboardTop = kb ? kb.screenY : Dimensions.get('window').height;
      input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        const desiredBottom = keyboardTop - EXTRA_OFFSET;
        const inputBottom = y + h;
        if (inputBottom > desiredBottom) {
          sv.scrollTo({ y: scrollY.current + (inputBottom - desiredBottom), animated: true });
        }
      });
    }, []);

    // Première ouverture : le clavier n'est mesurable qu'une fois affiché.
    useEffect(() => {
      const sub = Keyboard.addListener('keyboardDidShow', ensureVisible);
      return () => sub.remove();
    }, [ensureVisible]);

    // Passage d'un champ à l'autre clavier déjà ouvert : on revérifie après que le focus se pose.
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
        {...props}
      />
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
