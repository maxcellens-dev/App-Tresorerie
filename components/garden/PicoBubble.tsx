/**
 * Pico qui parle : son portrait et une bulle. Sert aux choix de Pico, aux astuces et aux
 * explications courtes. Une bulle = une ou deux phrases ; au-delà, c'est une feuille.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Pico, { type PicoMood } from './Pico';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_SPACE } from '../../lib/garden/theme';

interface Props {
  children: ReactNode;
  mood?: PicoMood;
}

export default function PicoBubble({ children, mood = 'happy' }: Props) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: GARDEN_SPACE.sm + 2 }}>
      <Pico avatar size={44} mood={mood} />
      <View
        style={{
          flex: 1,
          paddingVertical: GARDEN_SPACE.md,
          paddingHorizontal: 14,
          backgroundColor: GARDEN_COLORS.pico,
          borderTopLeftRadius: GARDEN_RADII.md + 2,
          borderTopRightRadius: GARDEN_RADII.md + 2,
          borderBottomRightRadius: GARDEN_RADII.md + 2,
          borderBottomLeftRadius: 6,
        }}
      >
        {typeof children === 'string' ? <GardenText variant="body">{children}</GardenText> : children}
      </View>
    </View>
  );
}
