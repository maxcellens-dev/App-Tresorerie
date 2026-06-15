/**
 * CalculatorButton — petit bouton (icône calculatrice) qui ouvre la calculatrice flottante.
 * Posé sur les écrans où l'on veut un accès rapide (création de transaction, projection…).
 * - Tap : ouvre / ferme la calculatrice.
 * - Glisser : déplace le bouton n'importe où à l'écran.
 * Par défaut : flottant en bas à droite. Surchargeable via `style`.
 */
import React, { useRef, useCallback } from 'react';
import { StyleSheet, View, Animated, PanResponder, ViewStyle, StyleProp } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useCalculator } from '../contexts/CalculatorContext';

interface Props {
  /** Position/dimensions personnalisées (sinon flottant en bas à droite). */
  style?: StyleProp<ViewStyle>;
  /** Taille du bouton (par défaut 48). */
  size?: number;
}

const TAP_THRESHOLD = 5; // px : en-dessous, on considère un tap (pas un glissement)

export default function CalculatorButton({ style, size = 48 }: Props) {
  const COLORS = useAppColors();
  const { isOpen, toggle, enabled } = useCalculator();

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const moved = useRef(false);

  // À chaque retour sur l'écran, l'icône reprend sa place par défaut.
  useFocusEffect(
    useCallback(() => {
      pan.setOffset({ x: 0, y: 0 });
      pan.setValue({ x: 0, y: 0 });
    }, [pan]),
  );

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > TAP_THRESHOLD || Math.abs(g.dy) > TAP_THRESHOLD,
      onPanResponderGrant: () => {
        moved.current = false;
        // @ts-ignore — valeurs courantes pour caler l'offset.
        pan.setOffset({ x: pan.x._value, y: pan.y._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, g) => {
        if (Math.abs(g.dx) > TAP_THRESHOLD || Math.abs(g.dy) > TAP_THRESHOLD) moved.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(e, g);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
        if (!moved.current) toggle(); // simple tap → bascule la calculatrice
      },
    })
  ).current;

  if (!enabled) return null; // l'utilisateur a masqué l'accès à la calculatrice

  return (
    <Animated.View
      style={[styles.wrap, style, { transform: pan.getTranslateTransform() }]}
      {...responder.panHandlers}
      accessibilityRole="button"
      accessibilityLabel="Calculatrice (glisser pour déplacer)"
    >
      <View
        style={[
          styles.fab,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: isOpen ? COLORS.accent : COLORS.cardSolid,
            borderColor: isOpen ? COLORS.accent : COLORS.cardBorder,
          },
        ]}
      >
        <Ionicons name="calculator-outline" size={size * 0.5} color={isOpen ? '#fff' : COLORS.accent} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: 96, right: 16, zIndex: 50 },
  fab: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
});
