/**
 * LE bouton de l'app. Une seule implémentation, quatre variantes, trois tailles.
 *
 * Il porte AUSSI ses couleurs (comme `AccountChipRow` avant lui) : tant que le style vient de
 * l'appelant, rien n'empêche deux écrans de rendre le même geste différemment — et c'est
 * exactement ce qui s'était produit (« Enregistrer » n'avait pas la même hauteur que « Brouillon »
 * juste à côté, et « Brouillon » restait gris ardoise en thème clair).
 *
 * ── POURQUOI `Pressable` ET PAS `TouchableOpacity` ──────────────────────────────────────────────
 * `TouchableOpacity` ne sait faire qu'une chose au toucher : baisser l'opacité de TOUT le bouton.
 * Sur un aplat de couleur, ça délave le libellé en même temps que le fond, et le bouton a l'air de
 * s'effacer plutôt que de s'enfoncer. Ici : un VOILE posé par-dessus le fond (le texte garde son
 * contraste) et un très léger enfoncement. C'est cette réponse au doigt qui fait qu'un bouton
 * paraît réel plutôt que dessiné.
 *
 * Il gère aussi l'état d'attente : `loading` remplace le libellé par un indicateur ET désactive le
 * bouton. Ce n'est PAS une protection contre le double envoi — celle-là passe par `useSubmitLock`,
 * parce qu'un `disabled` ne prend effet qu'au rendu SUIVANT.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { buttonVisual, BUTTON_SIZES, DISABLED_OPACITY, type ButtonSize, type ButtonVariant } from '../../lib/ui/controls';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Nom d'icône Ionicons, posée avant le libellé. */
  icon?: string;
  /** L'icône passe après le libellé (« Continuer › »). */
  iconRight?: boolean;
  disabled?: boolean;
  /** Écriture en cours : indicateur à la place du libellé, bouton inerte. */
  loading?: boolean;
  /** Prend toute la largeur disponible (dans une rangée : `flex: 1`). */
  full?: boolean;
  /**
   * Teinte SÉMANTIQUE — uniquement là où la couleur porte un sens que l'app a déjà établi (vert
   * épargne, violet investissement, bleu compte courant). Partout ailleurs : l'accent du thème.
   */
  tone?: string;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export default function AppButton({
  label, onPress, variant = 'primary', size = 'md', icon, iconRight,
  disabled, loading, full, tone, style, labelStyle, accessibilityLabel, testID,
}: Props) {
  const COLORS = useAppColors();
  const v = useMemo(() => buttonVisual(COLORS, variant, size, tone), [COLORS, variant, size, tone]);
  const off = !!disabled || !!loading;
  const radius = BUTTON_SIZES[size].radius;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={({ pressed }) => [
        v.container,
        full && { flex: 1 },
        off && { opacity: DISABLED_OPACITY, shadowOpacity: 0, elevation: 0 },
        // L'enfoncement : quelques dixièmes d'échelle, assez pour se sentir, trop peu pour se voir.
        pressed && !off && { transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {({ pressed }: any) => (
        <>
          {/* Le voile d'appui est un CALQUE, pas une opacité globale : le fond s'assombrit,
              le libellé garde son contraste. */}
          {pressed && !off && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: v.pressOverlay, borderRadius: radius }]} />
          )}
          {loading ? (
            /* Hauteur figée sur celle du libellé : sans ça, la rangée de boutons SAUTE au moment où
               l'indicateur remplace le texte — juste quand l'utilisateur attend une confirmation. */
            <View style={{ height: v.label.fontSize as number, justifyContent: 'center' }}>
              <ActivityIndicator size="small" color={v.tint} />
            </View>
          ) : (
            <>
              {!!icon && !iconRight && <Ionicons name={icon as any} size={iconSize(size)} color={v.tint} />}
              <Text style={[v.label, labelStyle]} numberOfLines={1}>{label}</Text>
              {!!icon && iconRight && <Ionicons name={icon as any} size={iconSize(size)} color={v.tint} />}
            </>
          )}
        </>
      )}
    </Pressable>
  );
}

function iconSize(size: ButtonSize): number {
  return size === 'sm' ? 15 : size === 'lg' ? 19 : 17;
}
