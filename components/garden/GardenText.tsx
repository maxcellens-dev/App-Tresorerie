/**
 * Texte du Jardin : un `variant` de la charte (lib/garden/theme) au lieu de tailles et graisses
 * posées écran par écran.
 *
 * `fontWeight` n'est jamais demandé : chaque graisse est une famille à part (cf. GARDEN_TEXT).
 */
import { Platform, Text, type TextProps } from 'react-native';
import { GARDEN_COLORS, GARDEN_TEXT, type GardenTextVariant } from '../../lib/garden/theme';

/** Attribut `data-gardenfont` (web seulement), exclu de la règle de police globale. */
export const GARDEN_TEXT_MARK = Platform.OS === 'web' ? { dataSet: { gardenfont: '1' } } : {};

interface Props extends TextProps {
  variant?: GardenTextVariant;
  color?: string;
  /** Chiffres à chasse fixe : montants alignés en colonne. */
  tabular?: boolean;
  center?: boolean;
}

export default function GardenText({ variant = 'body', color, tabular, center, style, ...rest }: Props) {
  return (
    <Text
      {...rest}
      // Web : marque le texte du Jardin pour que la police globale (FontApplier, `!important`) ne
      // remplace pas sa famille (Fredoka des titres, graisses de Nunito).
      {...(GARDEN_TEXT_MARK as any)}
      style={[
        GARDEN_TEXT[variant],
        { color: color ?? (variant === 'label' ? GARDEN_COLORS.inkSoft : GARDEN_COLORS.ink) },
        tabular && { fontVariant: ['tabular-nums'] },
        center && { textAlign: 'center' },
        style,
      ]}
    />
  );
}
