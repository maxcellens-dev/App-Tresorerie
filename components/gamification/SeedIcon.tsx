/**
 * La GRAINE — icône de la monnaie de l'app (anciennement les « relyks », représentés par un diamant).
 *
 * Dessin : une graine de tournesol striée, pointe vers le haut, qui GERME (deux petites feuilles) :
 * on la reconnaît comme une graine, pas comme une feuille.
 * `mono` : une seule couleur (sur un bouton plein, dans une pastille grisée).
 */
import Svg, { Path, Ellipse } from 'react-native-svg';

interface Props {
  size?: number;
  /** Couleur unique (silhouette) à la place des couleurs naturelles. */
  mono?: string;
}

export default function SeedIcon({ size = 16, mono }: Props) {
  const body = mono ?? '#5E4128';
  const stripe = mono ? 'rgba(0,0,0,0.28)' : '#E3CDA8';
  const sprout = mono ?? '#4C9A5E';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Germe : tige + deux petites feuilles */}
      <Path d="M12 7.2 V4.2" stroke={sprout} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M12 4.6 Q14.8 2.2 16.6 3.6 Q14.6 5.6 12 4.6Z" fill={sprout} />
      <Path d="M12 5.2 Q9.4 3.2 7.8 4.6 Q9.8 6.4 12 5.2Z" fill={sprout} />
      {/* Graine : pointe en haut, ventre arrondi en bas */}
      <Path d="M12 6.6 C16.2 9.6 17 14.6 16.2 17.6 C15.4 20.6 13.8 21.6 12 21.6 C10.2 21.6 8.6 20.6 7.8 17.6 C7 14.6 7.8 9.6 12 6.6Z" fill={body} />
      {/* Stries claires de la coque */}
      <Path d="M12 8.6 V20" stroke={stripe} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M9.6 11.2 Q9 15.6 10 19.4" stroke={stripe} strokeWidth={1} fill="none" strokeLinecap="round" />
      <Path d="M14.4 11.2 Q15 15.6 14 19.4" stroke={stripe} strokeWidth={1} fill="none" strokeLinecap="round" />
      {!mono ? <Ellipse cx={10.6} cy={11.6} rx={0.9} ry={1.8} fill="#FFFFFF" opacity={0.25} /> : null}
    </Svg>
  );
}
