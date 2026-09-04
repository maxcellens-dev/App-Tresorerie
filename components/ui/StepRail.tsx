/**
 * StepRail — le fil d'étapes d'une saisie (« 1 ─ 2 ─ 3 »).
 *
 * Il vivait en dur dans l'écran de saisie d'une transaction, avec ses cinq règles de style. La
 * clôture mensuelle ayant à son tour besoin d'annoncer son parcours, c'était le moment de n'en
 * garder qu'un : deux fils d'étapes dessinés séparément finissent toujours par ne plus avoir la
 * même taille de pastille ni le même vert.
 *
 * Il ne fait qu'ANNONCER : il ne navigue pas. Revenir en arrière se fait par le bouton « Étape
 * précédente » du formulaire, qui seul sait ce qu'il faut remettre à zéro en chemin.
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';

interface Props {
  /** Étape en cours, à partir de 1. */
  current: number;
  /** Nombre total d'étapes (2 ou 3 dans l'app). */
  total: number;
  style?: StyleProp<ViewStyle>;
}

export default function StepRail({ current, total, style }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const steps = Array.from({ length: Math.max(1, total) }, (_, i) => i + 1);

  return (
    <View style={[styles.row, style]} accessibilityRole="progressbar" accessibilityLabel={`Étape ${current} sur ${total}`}>
      {steps.map((n) => (
        <View key={n} style={styles.item}>
          {n > 1 && <View style={[styles.bar, current >= n && styles.barOn]} />}
          <View style={[styles.dot, current >= n && styles.dotOn]}>
            <Text style={[styles.dotText, current < n && { color: COLORS.textSecondary }]}>{n}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    item: { flexDirection: 'row', alignItems: 'center' },
    dot: {
      width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
    },
    dotOn: { backgroundColor: c.emerald, borderColor: c.emerald },
    dotText: { fontSize: 13, fontWeight: '800', color: c.onAccent },
    // La barre est le TRAIT entre deux pastilles : elle appartient à celle de droite (d'où `n > 1`).
    bar: { width: 60, height: 2, backgroundColor: c.cardBorder },
    barOn: { backgroundColor: c.emerald },
  });
}
