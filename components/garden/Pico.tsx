/**
 * Pépin, le hérisson du Jardin (le composant garde son nom technique « Pico »).
 *
 * Même dessin que dans la scène (lib/garden/sceneCinematic › pepinSvg) : piquants dessinés un par
 * un, lunettes rondes, écharpe verte, pousse sur la tête, et sa garde-robe de la boutique.
 * Trois humeurs :
 *   - `happy`   : par défaut ;
 *   - `joy`     : yeux plissés, bras levé (palier franchi, succès) ;
 *   - `thinking`: sourcil levé, pour une question ou une astuce.
 * Pas d'humeur triste ni inquiète : Pépin aide, il ne s'alarme pas (règle de la refonte).
 */
import { memo, useId, useMemo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { pepinSvg } from '../../lib/garden/sceneCinematic';
import { useGardenCosmetics } from '../../hooks/garden/useGardenCosmetics';

export type PicoMood = 'happy' | 'joy' | 'thinking';

interface Props {
  size?: number;
  mood?: PicoMood;
  /** Portrait dans un médaillon (avatar, bulle) plutôt que Pépin en pied. */
  avatar?: boolean;
  accessibilityLabel?: string;
}

function Pico({ size = 64, mood = 'happy', avatar, accessibilityLabel = 'Pépin' }: Props) {
  const uid = useId();
  const { outfit } = useGardenCosmetics();
  const key = JSON.stringify([mood, outfit, avatar]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const xml = useMemo(() => pepinSvg(uid, mood, outfit, !!avatar), [key, uid]);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: avatar ? size : size * 0.76 }}>
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

export default memo(Pico);
