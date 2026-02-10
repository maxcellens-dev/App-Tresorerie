import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  violet: '#a78bfa',
  emerald: '#34d399',
  orange: '#f59e0b',
  red: '#ef4444',
  blue: '#60a5fa',
};

interface SavingsGaugeProps {
  current: number;
  thresholdMin: number;
  thresholdOptimal: number;
  thresholdComfort: number;
}

export default function SavingsGaugeCard({ current, thresholdMin, thresholdOptimal, thresholdComfort }: SavingsGaugeProps) {
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
        <Text style={[styles.amount, { color }]}>{current.toFixed(0)} €</Text>
        <Text style={[styles.status, { color }]}>{status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 16,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
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
    backgroundColor: '#1e293b',
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
    backgroundColor: COLORS.textSecondary,
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
    backgroundColor: COLORS.red,
  },
  legendColorOptimal: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.orange,
  },
  legendColorComfort: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.emerald,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
