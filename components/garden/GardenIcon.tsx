/**
 * La pastille d'icône du Jardin — UNE seule forme partout : ronde, 36 px, icône 18 px, fond doux de
 * la partie de l'arbre (lib/garden/icons). `size` existe pour les rares grands usages (en-tête de
 * fiche) ; l'icône garde toujours la moitié de la pastille.
 */
import { View } from 'react-native';
import ChoiceIcon from './ChoiceIcon';
import { GARDEN_ICONS, type GardenIconKey } from '../../lib/garden/icons';

interface Props {
  /** Un sens du dictionnaire… */
  kind?: GardenIconKey;
  /** …ou une icône libre (Ionicons / 'garden-roots') avec ses couleurs. */
  icon?: string;
  fg?: string;
  bg?: string;
  size?: number;
}

export const GARDEN_ICON_SIZE = 36;

export default function GardenIcon({ kind, icon, fg, bg, size = GARDEN_ICON_SIZE }: Props) {
  const look = kind ? GARDEN_ICONS[kind] : undefined;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? look?.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ChoiceIcon name={icon ?? look?.icon ?? 'ellipse-outline'} size={Math.round(size / 2)} color={fg ?? look?.fg ?? '#000'} />
    </View>
  );
}
