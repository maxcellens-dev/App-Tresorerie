/**
 * La RELYK — icône de la monnaie de l'app (avant : la graine, puis la noisette du Jardin) : une pièce
 * dorée frappée d'un R. Vectorielle, donc nette à toutes les tailles. `mono` : une seule couleur (sur
 * un bouton plein, dans une pastille grisée).
 */
import { Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/* Masqué aux lecteurs d'écran. Sur le web, les props d'accessibilité natives atterrissaient sur le <svg>
   (« React does not recognize the importantForAccessibility prop ») : aria-hidden à la place. */
const SVG_HIDDEN: any = Platform.OS === 'web' ? { 'aria-hidden': true } : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };

/** Le « R » frappé au centre de la pièce. */
export const R_PATH = 'M9.2 7.4h3.5c1.9 0 3.1 1 3.1 2.6 0 1.2-.7 2.1-1.8 2.4l2.1 3.7h-2l-1.9-3.4h-1.2v3.4H9.2zm1.8 1.5v2.4h1.6c.9 0 1.4-.5 1.4-1.2s-.5-1.2-1.4-1.2z';

interface Props {
  size?: number;
  /** Couleur unique (silhouette) à la place des couleurs naturelles. */
  mono?: string;
}

export default function CurrencyIcon({ size = 16, mono }: Props) {
  if (mono) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" {...SVG_HIDDEN}>
        <Circle cx={12} cy={12} r={10} fill="none" stroke={mono} strokeWidth={2} />
        <Path d={R_PATH} fill={mono} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...SVG_HIDDEN}>
      <Circle cx={12} cy={12.6} r={10.4} fill="#C98A1E" />
      <Circle cx={12} cy={11.6} r={10.4} fill="#F2B53A" />
      <Circle cx={12} cy={11.6} r={7.8} fill="none" stroke="#FFD978" strokeWidth={1.2} />
      <Path d={R_PATH} fill="#9A6510" transform="translate(0 -0.4)" />
    </Svg>
  );
}
