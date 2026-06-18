/**
 * KeyboardAwareScroll — ScrollView qui remonte le contenu au-dessus du clavier.
 * À utiliser pour tout écran avec des champs de saisie : on peut alors scroller
 * jusqu'aux champs/boutons du bas même quand le clavier mobile est ouvert.
 *
 * Combine KeyboardAvoidingView (behavior=padding, fiable sur Android edge-to-edge)
 * + ScrollView (keyboardShouldPersistTaps + padding bas généreux).
 */
import React from 'react';
import { KeyboardAvoidingView, ScrollView, Platform, StyleProp, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Style du ScrollView (flex container). */
  style?: StyleProp<ViewStyle>;
  /** Style du contenu (padding…). Un paddingBottom est ajouté par défaut. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Décalage clavier supplémentaire (ex. hauteur d'un en-tête fixe). */
  keyboardVerticalOffset?: number;
  scrollRef?: React.RefObject<ScrollView>;
}

export default function KeyboardAwareScroll({
  children,
  style,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  scrollRef,
}: Props) {
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={{ flex: 1 }}
    >
      <ScrollView
        ref={scrollRef}
        style={style}
        contentContainerStyle={[{ paddingBottom: 48 }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
