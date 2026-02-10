import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  amber: '#f59e0b',
  teal: '#2dd4bf',
  red: '#ef4444',
};

interface VariableTrendProps {
  current: number;
  average: number;
  percentage: number;
}

export default function VariableTrendCard({ current, average, percentage }: VariableTrendProps) {
  const color =
    percentage > 100 ? COLORS.red :
    percentage > 70 ? COLORS.amber :
    COLORS.teal;
  const progressWidth = Math.min(percentage, 100);

  const message =
    percentage > 100
      ? `⚠️ Dépassement de ${(percentage - 100).toFixed(0)}% par rapport à la moyenne`
      : percentage > 70
        ? 'Vous approchez la moyenne'
        : 'Bien maîtrisé';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>Dépenses variables</Text>
        <Text style={[styles.trend, { color }]}>
          {percentage.toFixed(0)}%
        </Text>
      </View>
      
      <View style={styles.barContainer}>
        <View style={[styles.bar, { width: `${progressWidth}%`, backgroundColor: color }]} />
      </View>

      <Text style={styles.description}>
        {current.toFixed(0)} € dépensés sur {average.toFixed(0)} € habituels
      </Text>
      
      <Text style={[styles.statusMessage, { color }]}>
        {message}
      </Text>
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
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trend: {
    fontSize: 16,
    fontWeight: '700',
  },
  barContainer: {
    height: 6,
    backgroundColor: '#1e293b',
    borderRadius: 3,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 3,
  },
  description: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  statusMessage: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
});
