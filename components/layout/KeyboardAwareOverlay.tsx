/**
 * KeyboardAwareOverlay — remplace le `<View style={styles.overlay}>` / `<Pressable style={styles.overlay}>`
 * d'une modale pour que le contenu reste ATTEIGNABLE quand le clavier s'ouvre.
 *
 * Ce que ça règle (cf. modale « Supprimer définitivement » masquée par le clavier) :
 *  1. La zone utile est réduite à ce qui est visible AU-DESSUS du clavier → une modale centrée se
 *     recentre au-dessus du clavier, une modale en bas remonte d'autant.
 *  2. Si la carte est plus haute que cette zone, l'overlay devient scrollable et on gagne en plus la
 *     hauteur du clavier en bas → on atteint toujours les champs et boutons du bas.
 *  3. Le champ focalisé est remonté en haut de la zone visible (on voit ce qui suit).
 *
 * Nécessaire car en edge-to-edge (targetSdk ≥ 35) la fenêtre Android n'est jamais redimensionnée :
 * ni `adjustResize` ni `KeyboardAvoidingView` ne font remonter quoi que ce soit.
 *
 * Usage :
 *   <Modal visible transparent animationType="fade">
 *     <KeyboardAwareOverlay style={styles.overlay} onBackdropPress={close}>
 *       <View style={styles.card}>…</View>
 *     </KeyboardAwareOverlay>
 *   </Modal>
 *
 * `scroll={false}` : quand la carte gère DÉJÀ son propre ScrollView (pas d'imbrication verticale) —
 * l'overlay se contente alors de réserver la hauteur du clavier.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useKeyboardHeight } from '../../hooks/platform/useKeyboardHeight';
import { scrollFocusedInputIntoView } from '../../lib/ui/keyboardScroll';

interface Props {
  /** Style d'overlay existant (flex, backgroundColor, justifyContent, padding…). */
  style?: StyleProp<ViewStyle>;
  /** Appui sur le fond → fermeture. Omis = fond non cliquable. */
  onBackdropPress?: () => void;
  /** false quand le contenu a déjà son propre ScrollView. */
  scroll?: boolean;
  /** Marge de confort ajoutée au-dessus du clavier. */
  extraBottom?: number;
  children: React.ReactNode;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export default function KeyboardAwareOverlay({
  style,
  onBackdropPress,
  scroll = true,
  extraBottom = 0,
  children,
}: Props) {
  const kb = useKeyboardHeight();
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollY = useRef(0);

  const { bg, container, padTop, padLeft, padRight, padBottom } = useMemo(() => {
    const flat = (StyleSheet.flatten(style) ?? {}) as any;
    // `flex`/`backgroundColor` restent sur le ScrollView lui-même : le contentContainer, lui, doit
    // pouvoir grandir (flexGrow) pour rester scrollable quand le contenu dépasse.
    const { backgroundColor, flex, ...rest } = flat;
    const pad = num(rest.padding);
    return {
      bg: backgroundColor as string | undefined,
      container: rest as ViewStyle,
      padTop: num(rest.paddingTop ?? rest.paddingVertical ?? pad),
      padLeft: num(rest.paddingLeft ?? rest.paddingHorizontal ?? pad),
      padRight: num(rest.paddingRight ?? rest.paddingHorizontal ?? pad),
      padBottom: num(rest.paddingBottom ?? rest.paddingVertical ?? pad),
    };
  }, [style]);

  const bottom = kb > 0 ? padBottom + kb + extraBottom : padBottom;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  }, []);

  // Clavier ouvert / champ suivant : on remonte le champ focalisé dans la zone visible. Sans
  // débordement, scrollTo est borné par le contenu → rien ne bouge.
  useEffect(() => {
    if (!scroll || kb <= 0) return;
    const t = setTimeout(() => scrollFocusedInputIntoView(scrollRef.current, scrollY.current, kb), 60);
    return () => clearTimeout(t);
  }, [scroll, kb]);

  const handleTouchCapture = useCallback(() => {
    if (scroll) setTimeout(() => scrollFocusedInputIntoView(scrollRef.current, scrollY.current, kb), 120);
    return false;
  }, [scroll, kb]);

  if (!scroll) {
    const Wrapper: any = onBackdropPress ? Pressable : View;
    // `marginBottom` (et non un padding) : l'overlay lui-même RÉTRÉCIT, donc les hauteurs en
    // pourcentage de la carte (`maxHeight: '85%'`…) se recalculent sur la zone visible au lieu de
    // déborder par le haut. Sa couleur de fond s'arrête là où commence le clavier, qui la recouvre.
    return (
      <Wrapper style={[style, kb > 0 ? { marginBottom: kb + extraBottom } : null]} onPress={onBackdropPress}>
        {children}
      </Wrapper>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.flex, bg ? { backgroundColor: bg } : null]}
      contentContainerStyle={[styles.grow, container, { paddingBottom: bottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onStartShouldSetResponderCapture={handleTouchCapture}
    >
      {/* Fond cliquable : décalé des paddings de l'overlay pour couvrir toute la surface. */}
      {!!onBackdropPress && (
        <Pressable
          style={{ position: 'absolute', top: -padTop, left: -padLeft, right: -padRight, bottom: -bottom }}
          onPress={onBackdropPress}
          accessibilityLabel="Fermer"
        />
      )}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
});
