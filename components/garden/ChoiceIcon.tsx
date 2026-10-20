/**
 * Icône d'un geste de Pépin (racines, fruits, fleurs, arrosoir). Les trois autres sont des
 * Ionicons de la plante (pomme, fleur, goutte) ; Ionicons n'a pas de RACINES — l'ancien bouclier
 * détonnait au milieu. On dessine donc une pousse et ses racines sous la ligne de terre, au même
 * trait que les Ionicons « outline » (fin, bouts arrondis).
 */
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

export const ROOTS_ICON = 'garden-roots';

export function RootsIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {/* La pousse au-dessus de la terre. */}
      <Path d="M12 9V5.5" />
      <Path d="M12 6.5C12 4.6 13.4 3.3 15.5 3.3 15.5 5.2 14.1 6.5 12 6.5Z" />
      <Path d="M12 7.3C12 5.6 10.8 4.5 9 4.5 9 6.2 10.2 7.3 12 7.3Z" />
      {/* La ligne de terre. */}
      <Path d="M4 9h16" />
      {/* Les racines. */}
      <Path d="M12 9v11" />
      <Path d="M12 12c-2.3 0-3.8 1.3-4.4 3.6" />
      <Path d="M12 12c2.3 0 3.8 1.3 4.4 3.6" />
      <Path d="M7.6 15.6c-1.1.5-1.8 1.6-2.1 3" />
      <Path d="M16.4 15.6c1.1.5 1.8 1.6 2.1 3" />
      <Path d="M12 16.2c-1.2.3-2 1.2-2.3 2.6" />
      <Path d="M12 16.2c1.2.3 2 1.2 2.3 2.6" />
    </Svg>
  );
}

export default function ChoiceIcon({ name, size = 18, color }: { name: string; size?: number; color: string }) {
  if (name === ROOTS_ICON) return <RootsIcon size={size} color={color} />;
  return <Ionicons name={name as any} size={size} color={color} />;
}
