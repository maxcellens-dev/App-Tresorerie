/**
 * La NOISETTE — icône de la monnaie de l'app (avant : les « relyks » en diamant, puis la graine).
 *
 * En couleurs : l'image 3D du Jardin (assets/garden3d/currency_nut). `mono` : une seule couleur (sur
 * un bouton plein, dans une pastille grisée) → silhouette vectorielle, qu'une image ne sait pas teindre
 * proprement à cette taille.
 */
import { Image } from 'react-native';
import { Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SCENE3D_IMG } from '../../lib/garden/scene3dAssets';

/* Masqué aux lecteurs d'écran. Sur le web, les props d'accessibilité natives atterrissaient sur le <svg>
   (« React does not recognize the importantForAccessibility prop ») : aria-hidden à la place. */
const SVG_HIDDEN: any = Platform.OS === 'web' ? { 'aria-hidden': true } : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };

interface Props {
  size?: number;
  /** Couleur unique (silhouette) à la place des couleurs naturelles. */
  mono?: string;
}

export default function NutIcon({ size = 16, mono }: Props) {
  if (!mono) {
    return <Image source={SCENE3D_IMG.currency_nut} style={{ width: size, height: size }} resizeMode="contain" fadeDuration={0} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...SVG_HIDDEN}>
      {/* Noisette ronde à pointe, en haut à gauche comme l'image 3D */}
      <Path d="M7.4 4.6 C9 3.6 10.6 3.4 12.4 3.6 C17.6 4.2 21 8.4 20.6 13.4 C20.2 18.4 16.2 21.6 11.6 21.2 C6.6 20.8 3.2 16.8 3.4 12 C3.5 9.4 4.6 7.2 6.2 5.8 L5 4.2Z" fill={mono} />
    </Svg>
  );
}
