/**
 * Barre de progression du Jardin (racines vers un trait, projet vers son objectif…).
 * `value` est borné à [0, 1] : une barre ne déborde jamais de son rail.
 */
import { View } from 'react-native';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';

interface Props {
  value: number;
  fill?: string;
  track?: string;
  height?: number;
  accessibilityLabel?: string;
}

export default function GardenBar({ value, fill = GARDEN_COLORS.primary, track = GARDEN_COLORS.track, height = 12, accessibilityLabel }: Props) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height, borderRadius: GARDEN_RADII.pill, backgroundColor: track, overflow: 'hidden' }}
    >
      <View style={{ width: `${v * 100}%`, height, borderRadius: GARDEN_RADII.pill, backgroundColor: fill }} />
    </View>
  );
}
