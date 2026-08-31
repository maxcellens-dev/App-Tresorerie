/**
 * ONGLETS DE PAGE — naviguer entre deux contenus de même niveau.
 *
 * Ce sont des TITRES soulignés, pas un contrôle encadré : c'est ce qui les distingue du
 * `SegmentedControl`, qui sert à choisir une valeur. Un onglet dit « où l'on est » ; un segment dit
 * « ce qu'on a choisi ». Les confondre revient à donner à une navigation l'apparence d'un réglage.
 *
 * Le style vient des onglets « Comptes / Crédits » de la page Comptes, qui les avaient inventés
 * pour eux seuls.
 */
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { pageTabStyles } from '../../lib/ui/controls';

export interface PageTabOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: PageTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  /**
   * Contrôle posé à l'EXTRÊME DROITE de la barre, sur la même ligne que les onglets et au-dessus
   * du même trait — un filtre qui cadre le contenu, pas une navigation.
   *
   * Le contrôle est posé hors flux (voir `styles.right`) : il ne peut donc pas modifier la hauteur
   * de la barre. Reste à ce qu'il tienne visuellement dans la ligne — d'où `SegmentedControl
   * size="sm"` plutôt que le format normal.
   */
  right?: ReactNode;
}

export default function PageTabs<T extends string>({ options, value, onChange, style, right }: Props<T>) {
  const COLORS = useAppColors();
  const s = useMemo(() => StyleSheet.create(pageTabStyles(COLORS) as any), [COLORS]);

  return (
    <View style={[s.bar, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.item, active && s.itemActive]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.label, active && s.labelActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
      {!!right && <View style={styles.right}>{right}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  /* Posé HORS FLUX, volontairement : la barre se règle sur ses onglets et sur eux seuls. En flux,
     le moindre contrôle un peu plus épais l'aurait fait grandir — et la page Budget serait retombée
     à une hauteur différente de la page Comptes, ce qui est exactement le décalage qu'on a mis du
     temps à supprimer. Ici, la page peut ajouter un filtre sans jamais toucher à l'alignement. */
  right: { position: 'absolute', right: 0, bottom: 5 },
});
