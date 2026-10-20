/**
 * Pastille : un court état ou une étiquette (« En bonne santé », « 6 semaines », « à faire »).
 * Fond doux + texte lisible de la même matière ; jamais une pastille rouge d'alerte.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';

interface Props {
  label: string;
  bg?: string;
  color?: string;
  /** Petite pastille de couleur avant le texte. */
  dot?: string;
  icon?: ReactNode;
}

export default function GardenPill({ label, bg = GARDEN_COLORS.field, color = GARDEN_COLORS.inkSoft, dot, icon }: Props) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: GARDEN_RADII.pill, backgroundColor: bg }}>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      {icon}
      <GardenText variant="smallStrong" color={color} style={{ fontSize: 12 }}>{label}</GardenText>
    </View>
  );
}
