/**
 * Carte du Jardin. Règle de la refonte : UNE carte = un chiffre, une phrase, une action. Ce qui
 * dépasse va dans une feuille (GardenSheet), pas dans une carte plus longue.
 *
 * Avec `onPress`, toute la carte est touchable (et annoncée comme bouton) : c'est elle qui ouvre
 * le détail, pas un petit lien perdu dans un coin. ⚠️ Une carte touchable ne contient JAMAIS de
 * bouton (GardenButton, Pressable) : sur le web, un bouton dans un bouton est du HTML invalide.
 */
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';
import { pointer, shadow, transition } from '../../lib/ui/webLayout';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  /** Fond doux d'une matière (ex. GARDEN_COLORS.rootsBg) pour la carte qui en parle. */
  tint?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export default function GardenCard({ children, onPress, tint, accessibilityLabel, style }: Props) {
  const base: ViewStyle = {
    backgroundColor: tint ?? GARDEN_COLORS.card,
    borderRadius: GARDEN_RADII.lg,
    padding: GARDEN_SPACE.lg,
    gap: GARDEN_SPACE.sm + 2,
    // Contour léger sur les cartes blanches : sans lui, blanc sur fond très clair, elles se fondaient.
    borderWidth: tint ? 0 : 1,
    borderColor: GARDEN_COLORS.line,
    // Ombre très douce : détache la carte du fond sans effet « flottant ».
    shadowColor: '#1E3A2C', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // Web : main au survol et légère ombre (une carte touchable doit se voir touchable à la souris).
      style={({ pressed, hovered }: any) => [base, pointer, transition, hovered ? shadow(2) : null, pressed && { transform: [{ scale: 0.99 }], opacity: 0.96 }, style]}
    >
      {children}
    </Pressable>
  );
}
