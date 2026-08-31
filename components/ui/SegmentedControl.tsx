/**
 * SEGMENT — choisir UNE option parmi peu.
 *
 * C'est le composant du style d'onglets adopté sur les fiches compte et les projets partagés, sorti
 * de ces deux écrans pour servir partout : onglets de page, filtres exclusifs, cadence mois/an.
 * Trois copies du même rendu existaient déjà et avaient commencé à diverger (l'une avec icônes,
 * l'autre sans, une troisième avec un aplat vert saturé).
 *
 * Il ne prend pas de couleurs en paramètre, volontairement : c'est ce qui garantit qu'un onglet a
 * la même tête d'un bout à l'autre de l'app.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { segmentStyles } from '../../lib/ui/controls';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Icône Ionicons facultative — mais tout ou rien sur un même segment. */
  icon?: string;
  /** Pastille de compteur (invitations en attente, éléments non lus). */
  badge?: number;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /** Rôle d'accessibilité : `tab` pour des onglets de contenu, `radio` pour un choix de réglage. */
  role?: 'tab' | 'radio';
  /**
   * `sm` — version resserrée, pour les emplacements où le segment accompagne autre chose et ne doit
   * pas imposer sa hauteur (posé sur une barre d'onglets, par exemple : au format normal il aurait
   * fait grandir la barre et décalé les libellés vers le bas).
   */
  size?: 'md' | 'sm';
}

export default function SegmentedControl<T extends string>({ options, value, onChange, style, role = 'tab', size = 'md' }: Props<T>) {
  const COLORS = useAppColors();
  const s = useMemo(() => StyleSheet.create(segmentStyles(COLORS) as any), [COLORS]);
  const sm = size === 'sm';

  return (
    <View style={[s.bar, sm && styles.barSm, style]} accessibilityRole={role === 'tab' ? 'tablist' : 'radiogroup'}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.item, sm && styles.itemSm, active && s.itemActive]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole={role}
            accessibilityState={{ selected: active }}
          >
            {!!o.icon && <Ionicons name={o.icon as any} size={sm ? 13 : 15} color={active ? COLORS.primary : COLORS.textSecondary} />}
            <Text style={[s.label, sm && styles.labelSm, active && s.labelActive]} numberOfLines={1}>{o.label}</Text>
            {!!o.badge && o.badge > 0 && (
              <View style={[styles.badge, { backgroundColor: COLORS.danger }]}>
                <Text style={[styles.badgeText, { color: COLORS.onAccent }]}>{o.badge > 9 ? '9+' : o.badge}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 9, fontWeight: '800' },
  // Version resserrée : mêmes couleurs et même géométrie, à l'échelle près.
  barSm: { padding: 3, borderRadius: 10, gap: 3 },
  itemSm: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7, gap: 4 },
  labelSm: { fontSize: 11 },
});
