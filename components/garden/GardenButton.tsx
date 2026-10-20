/**
 * Bouton du Jardin. Deux variantes seulement :
 *   - `primary`   : l'aplat vert, réservé à l'action qui CONCLUT (un seul par écran) ;
 *   - `secondary` : une action proposée (même règle que AppButton dans l'app actuelle).
 *
 * Il NE protège PAS du double envoi : une écriture non idempotente passe par `useSubmitLock`
 * (un `disabled` ne prend effet qu'au rendu suivant).
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import GardenText from './GardenText';
import { GARDEN_COLORS, GARDEN_RADII, GARDEN_TOUCH } from '../../lib/garden/theme';
import { pointer, transition } from '../../lib/ui/webLayout';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  /** Élément posé avant le libellé (petite icône SVG). */
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}

export default function GardenButton({ label, onPress, variant = 'primary', icon, disabled, loading, accessibilityLabel }: Props) {
  const primary = variant === 'primary';
  const off = !!disabled || !!loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={({ pressed, hovered }: any) => [
        pointer,
        transition,
        {
          minHeight: primary ? 56 : 52,
          borderRadius: GARDEN_RADII.lg - 4,
          paddingHorizontal: 18,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          backgroundColor: primary ? (pressed || hovered ? GARDEN_COLORS.primaryPressed : GARDEN_COLORS.primary) : hovered ? GARDEN_COLORS.field : GARDEN_COLORS.card,
          borderWidth: primary ? 0 : 2,
          borderColor: GARDEN_COLORS.line,
        },
        pressed && { transform: [{ scale: 0.985 }] },
        off && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? GARDEN_COLORS.onPrimary : GARDEN_COLORS.primary} />
      ) : (
        <>
          {icon ? <View style={{ minWidth: GARDEN_TOUCH / 2 }}>{icon}</View> : null}
          <GardenText variant="bodyStrong" color={primary ? GARDEN_COLORS.onPrimary : GARDEN_COLORS.primary} style={{ fontSize: 16 }}>
            {label}
          </GardenText>
        </>
      )}
    </Pressable>
  );
}
