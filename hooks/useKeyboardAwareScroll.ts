/**
 * useKeyboardAwareScroll — remonte automatiquement le champ saisi au-dessus du clavier.
 *
 * Problème résolu : quand on tape dans une zone de saisie (montant, libellé, recherche…),
 * le clavier mobile apparaît et masque le champ + les boutons qui suivent. On devait alors
 * scroller à la main. Ce hook scrolle le ScrollView pour que le champ focalisé reste visible,
 * un peu au-dessus du clavier (marge `extraOffset`).
 *
 * Mécanique : on s'appuie sur `scrollResponderScrollNativeHandleToKeyboard` exposé nativement
 * par le ScrollView de React Native. Il mesure le champ focalisé et calcule le scroll en
 * fonction des dimensions réelles du clavier (qu'il suit déjà en interne) — pas besoin de
 * tracker l'offset de scroll nous-mêmes.
 *
 * Usage :
 *   const { scrollRef, handleFocus } = useKeyboardAwareScroll();
 *   <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" ...>
 *     <TextInput onFocus={handleFocus} ... />
 *   </ScrollView>
 *
 * - `scrollRef` à poser sur le ScrollView (compatible avec scrollTo, etc.).
 * - `handleFocus` à brancher sur le `onFocus` de chaque TextInput : couvre aussi le passage
 *   d'un champ à l'autre quand le clavier est déjà ouvert.
 * - Un écouteur `keyboardDidShow` rejoue le scroll à la première ouverture (le clavier n'est
 *   pas encore mesuré au moment du onFocus).
 */
import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput } from 'react-native';

export function useKeyboardAwareScroll(extraOffset = 32) {
  const scrollRef = useRef<ScrollView>(null);

  const scrollToFocused = useCallback(() => {
    const sv = scrollRef.current;
    const input = TextInput.State.currentlyFocusedInput?.();
    if (!sv || !input) return;
    const responder = sv.getScrollResponder?.();
    responder?.scrollResponderScrollNativeHandleToKeyboard?.(input, extraOffset, true);
  }, [extraOffset]);

  const handleFocus = useCallback(() => {
    // Léger délai sur Android : laisse le clavier commencer à s'ouvrir pour disposer de ses
    // dimensions avant de calculer le scroll.
    setTimeout(scrollToFocused, Platform.OS === 'android' ? 60 : 0);
  }, [scrollToFocused]);

  // Première ouverture : au moment du onFocus le clavier n'est pas encore mesuré.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', scrollToFocused);
    return () => sub.remove();
  }, [scrollToFocused]);

  return { scrollRef, handleFocus };
}
