/**
 * La jauge d'un budget — la même barre partout (vue Budget, saisie, détail du mois).
 *
 * COULEUR : l'AMBRE en cas de dépassement, jamais le rouge. L'ambre est déjà, dans le thème, la
 * couleur des dépenses variables ; le rouge y signale un danger réel (découvert, solde négatif).
 * Dépasser un budget qu'on s'est fixé soi-même n'est pas un incident — c'est une information.
 */
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '../../hooks/theme/useAppColors';

interface Props {
  spent: number;
  budget: number;
  /** Barre fine, pour une ligne de liste ou un formulaire. */
  compact?: boolean;
  /** Part déjà consommée AVANT le geste en cours — rendue en teinte pleine sous la projection. */
  spentBefore?: number;
}

export default function BudgetGauge({ spent, budget, compact, spentBefore }: Props) {
  const C = useAppColors();
  const over = budget > 0 && spent > budget;
  const tint = over ? C.warning : C.primary;
  const pct = budget > 0 ? Math.min(100, (Math.max(0, spent) / budget) * 100) : 0;
  const pctBefore = budget > 0 && spentBefore != null ? Math.min(100, (Math.max(0, spentBefore) / budget) * 100) : null;

  return (
    <View style={[styles.track, { backgroundColor: C.cardBorder }, compact && styles.trackCompact]}>
      {/* La projection d'abord (teinte diluée), le déjà-dépensé par-dessus : on voit d'un coup ce
          que la saisie en cours ajoute, sans avoir à comparer deux nombres. */}
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: pctBefore != null ? tint + '66' : tint }]} />
      {pctBefore != null && (
        <View style={[styles.fill, styles.overlay, { width: `${pctBefore}%`, backgroundColor: tint }]} />
      )}
    </View>
  );
}

/** Libellé « 278 / 400 € » avec la part dépassée mise en avant. */
export function BudgetAmounts({ spent, budget, symbol, suffix }: { spent: number; budget: number; symbol: string; suffix?: string }) {
  const C = useAppColors();
  const over = budget > 0 && spent > budget;
  const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
  return (
    <Text style={[styles.amounts, { color: C.textSecondary }]} numberOfLines={1}>
      <Text style={{ color: over ? C.warning : C.text, fontWeight: '700' }}>{fmt(spent)}</Text>
      {` / ${fmt(budget)} ${symbol}${suffix ? ` ${suffix}` : ''}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8 },
  trackCompact: { height: 4, marginTop: 6 },
  fill: { height: '100%', borderRadius: 3 },
  overlay: { position: 'absolute', left: 0, top: 0 },
  amounts: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
