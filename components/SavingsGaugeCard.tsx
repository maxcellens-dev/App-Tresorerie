import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';


interface SavingsGaugeProps {
  current: number;
  thresholdMin: number;
  thresholdOptimal: number;
  thresholdComfort: number;
}

export default function SavingsGaugeCard({ current, thresholdMin, thresholdOptimal, thresholdComfort }: SavingsGaugeProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  // Déterminer la zone et la couleur
  let status = '';
  let color = '';
  
  if (current < thresholdMin) {
    status = 'Critique';
    color = COLORS.red;
  } else if (current < thresholdOptimal) {
    status = 'À reconstituer';
    color = COLORS.orange;
  } else if (current < thresholdComfort) {
    status = 'Sain';
    color = COLORS.violet;
  } else {
    status = 'Comfortable';
    color = COLORS.blue;
  }

  // Calculer la progression visuelle (0-100%)
  const maxForViz = thresholdComfort * 1.5;
  const percentage = Math.min((current / maxForViz) * 100, 100);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Épargne</Text>
      
      <View style={styles.gaugeContainer}>
        <View style={styles.gaugeBackground}>
          <View style={[styles.gaugeFill, { width: `${percentage}%`, backgroundColor: color }]} />
        </View>
        <View style={styles.gaugeThresholds}>
          <View style={[styles.threshold, { left: `${(thresholdMin / maxForViz) * 100}%` }]} />
          <View style={[styles.threshold, { left: `${(thresholdOptimal / maxForViz) * 100}%` }]} />
          <View style={[styles.threshold, { left: `${(thresholdComfort / maxForViz) * 100}%` }]} />
        </View>
      </View>

      <View style={styles.info}>
        <Text style={[styles.amount, { color }]}>{current.toFixed(0)} {CURRENCY_SYMBOL}</Text>
        <Text style={[styles.status, { color }]}>{status}</Text>
      </View>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 16,
  },
  label: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gaugeContainer: {
    position: 'relative',
    height: 24,
  },
  gaugeBackground: {
    height: 8,
    backgroundColor: c.cardBorder,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 4,
  },
  gaugeThresholds: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  threshold: {
    position: 'absolute',
    width: 2,
    height: '100%',
    backgroundColor: c.textSecondary,
    opacity: 0.3,
    top: 0,
  },
  info: {
    gap: 4,
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
  },
  status: {
    fontSize: 12,
    fontWeight: '600',
  },
  legend: {
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendColorMin: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: c.red,
  },
  legendColorOptimal: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: c.orange,
  },
  legendColorComfort: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: c.emerald,
  },
  legendText: {
    fontSize: 11,
    color: c.textSecondary,
  },
});
}
