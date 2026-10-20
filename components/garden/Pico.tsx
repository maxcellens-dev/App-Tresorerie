/**
 * Pépin, le hérisson du Jardin (le composant garde son nom technique « Pico »).
 *
 * Mêmes images que dans la scène 3D (lib/garden/scene3dLayout › pepinLayers) : lunettes rondes,
 * écharpe verte, pousse sur la tête, et sa garde-robe de la boutique en calques superposés.
 * Humeurs :
 *   - `happy`   : par défaut ;
 *   - `joy`     : clin d'œil, patte levée (palier franchi, succès) ;
 *   - `thinking`: regard vers le haut, patte au menton, pour une question ou une astuce.
 * Pas d'humeur triste ni inquiète : Pépin aide, il ne s'alarme pas (règle de la refonte).
 */
import { memo } from 'react';
import { Image, View } from 'react-native';
import { useGardenCosmetics } from '../../hooks/garden/useGardenCosmetics';
import { pepinLayers } from '../../lib/garden/scene3dLayout';
import { SCENE3D, SCENE3D_IMG } from '../../lib/garden/scene3dAssets';

export type PicoMood = 'happy' | 'joy' | 'thinking';

interface Props {
  size?: number;
  mood?: PicoMood;
  /** Portrait dans un médaillon (avatar, bulle) plutôt que Pépin en pied. */
  avatar?: boolean;
  accessibilityLabel?: string;
}

const P = SCENE3D.pepin;
const RATIO = P.h / P.w;
/* Médaillon : Pépin agrandi, cadré sur la tête (point du visage ramené au centre du cercle). */
const AVATAR_SCALE = 1.7, FACE_X = 0.64, FACE_Y = 0.4;

function Pico({ size = 64, mood = 'happy', avatar, accessibilityLabel = 'Pépin' }: Props) {
  const { outfit } = useGardenCosmetics();
  const layers = pepinLayers(mood, outfit);
  if (avatar) {
    const w = size * AVATAR_SCALE, h = w * RATIO;
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: '#F3E8D6' }}>
        {layers.map((n) => (
          <Image key={n} source={SCENE3D_IMG[n]} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', width: w, height: h, left: size * 0.5 - FACE_X * w, top: size * 0.56 - FACE_Y * h }} />
        ))}
      </View>
    );
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ width: size, height: size * RATIO }}>
      {layers.map((n) => <Image key={n} source={SCENE3D_IMG[n]} fadeDuration={0} resizeMode="stretch" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />)}
    </View>
  );
}

export default memo(Pico);
