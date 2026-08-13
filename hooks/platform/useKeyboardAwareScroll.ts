/**
 * useKeyboardAwareScroll — remonte le champ saisi EN HAUT de la zone visible (au-dessus du clavier),
 * variante hook du composant KeyboardAwareScrollView (pour les écrans qui gardent leur ScrollView).
 *
 * `keyboardPadding` réserve la hauteur du clavier sous le contenu : sans lui, les derniers champs et
 * boutons restent inatteignables (en edge-to-edge, la fenêtre Android n'est jamais redimensionnée).
 *
 * Usage :
 *   const { scrollRef, handleFocus, onScroll, keyboardPadding } = useKeyboardAwareScroll();
 *   <ScrollView
 *     ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16}
 *     keyboardShouldPersistTaps="handled"
 *     contentContainerStyle={[styles.content, keyboardPadding]}
 *   >
 *     <TextInput onFocus={handleFocus} ... />
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useKeyboardHeight } from './useKeyboardHeight';
import { scrollFocusedInputIntoView } from '../../lib/ui/keyboardScroll';

/** Marge de confort sous le dernier champ quand le clavier est ouvert. */
const EXTRA_BOTTOM = 24;

export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const keyboardHeight = useKeyboardHeight();

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  const ensureVisible = useCallback(() => {
    scrollFocusedInputIntoView(scrollRef.current, scrollY.current, keyboardHeight);
  }, [keyboardHeight]);

  const handleFocus = useCallback(() => {
    setTimeout(ensureVisible, Platform.OS === 'android' ? 80 : 0);
  }, [ensureVisible]);

  // Ouverture du clavier : on attend que le padding bas soit appliqué pour pouvoir scroller loin.
  useEffect(() => {
    if (keyboardHeight <= 0) return;
    const t = setTimeout(ensureVisible, 60);
    return () => clearTimeout(t);
  }, [keyboardHeight, ensureVisible]);

  const keyboardPadding = useMemo(
    () => (keyboardHeight > 0 ? { paddingBottom: keyboardHeight + EXTRA_BOTTOM } : null),
    [keyboardHeight],
  );

  return { scrollRef, handleFocus, onScroll, keyboardHeight, keyboardPadding };
}
