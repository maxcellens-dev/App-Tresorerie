/**
 * KeyboardAwareScrollView — ScrollView « drop-in » qui remonte automatiquement le champ saisi
 * au-dessus du clavier.
 *
 * Problème résolu : en tapant dans une zone de saisie (montant, libellé, recherche…), le clavier
 * mobile apparaît et masque le champ + les boutons qui suivent. On devait alors scroller à la main,
 * y compris pour atteindre le champ suivant.
 *
 * Usage : remplacer `<ScrollView>` par `<KeyboardAwareScrollView>` sur le conteneur du formulaire.
 * Aucun changement requis sur les `TextInput` : le composant détecte le champ focalisé globalement.
 *
 * Deux déclencheurs :
 *  1. `keyboardDidShow` — première ouverture (le champ n'est mesurable qu'une fois le clavier affiché).
 *  2. `onStartShouldSetResponderCapture` — passage d'un champ à l'autre clavier déjà ouvert. On re-scrolle
 *     uniquement si le champ focalisé a CHANGÉ, pour ne pas lutter avec un scroll manuel de l'utilisateur.
 *
 * Mécanique : `scrollResponderScrollNativeHandleToKeyboard`, exposé nativement par le ScrollView de
 * React Native, mesure le champ et calcule le scroll d'après les dimensions réelles du clavier — pas
 * de dépendance ajoutée (compatible OTA), pas de suivi manuel de l'offset.
 */
import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, type ScrollViewProps } from 'react-native';

/** Marge laissée entre le bas du champ et le haut du clavier. */
const EXTRA_OFFSET = 32;

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ keyboardShouldPersistTaps = 'handled', ...props }, forwardedRef) => {
    const innerRef = useRef<ScrollView | null>(null);
    const lastScrolled = useRef<unknown>(null);

    const setRefs = useCallback(
      (node: ScrollView | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<ScrollView | null>).current = node;
      },
      [forwardedRef],
    );

    const scrollToFocused = useCallback(() => {
      const sv = innerRef.current;
      const input = TextInput.State.currentlyFocusedInput?.();
      if (!sv || !input) return;
      lastScrolled.current = input;
      const responder = sv.getScrollResponder?.();
      responder?.scrollResponderScrollNativeHandleToKeyboard?.(input, EXTRA_OFFSET, true);
    }, []);

    useEffect(() => {
      const sub = Keyboard.addListener('keyboardDidShow', scrollToFocused);
      return () => sub.remove();
    }, [scrollToFocused]);

    const handleTouchCapture = useCallback(() => {
      // Le focus n'est posé qu'au relâchement : on diffère la vérification pour laisser le nouveau
      // champ devenir le champ focalisé.
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput?.();
        if (input && input !== lastScrolled.current) scrollToFocused();
      }, Platform.OS === 'android' ? 120 : 60);
      return false;
    }, [scrollToFocused]);

    return (
      <ScrollView
        ref={setRefs}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onStartShouldSetResponderCapture={handleTouchCapture}
        {...props}
      />
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

export default KeyboardAwareScrollView;
