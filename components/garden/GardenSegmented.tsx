/**
 * Sélecteur à onglets du Jardin (Aujourd'hui / Ce mois / Demain, Mes projets / Partagés…).
 */
import { Pressable, View } from 'react-native';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_RADII } from '../../lib/garden/theme';

interface Props<K extends string> {
  items: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  accessibilityLabel: string;
}

export default function GardenSegmented<K extends string>({ items, value, onChange, accessibilityLabel }: Props<K>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: GARDEN_RADII.md, backgroundColor: GARDEN_COLORS.track }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: 44, borderRadius: GARDEN_RADII.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? GARDEN_COLORS.card : 'transparent' }}
          >
            <GardenText variant="smallStrong" color={on ? GARDEN_COLORS.ink : GARDEN_COLORS.inkSoft}>{it.label}</GardenText>
          </Pressable>
        );
      })}
    </View>
  );
}
