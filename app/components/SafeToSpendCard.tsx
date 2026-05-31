import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';


interface SafeToSpendProps {
  amount: number;
  isLow?: boolean;
  isNegative?: boolean;
  reserved?: number;
}

export default function SafeToSpend({ amount, isLow = false, isNegative = false, reserved = 0 }: SafeToSpendProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const color = isNegative ? COLORS.red : isLow ? COLORS.orange : COLORS.emerald;
  
  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 20 }}>💰</Text>
        </View>
        <Text style={styles.label}>Ce qu'il te reste ce mois-ci</Text>
      </View>
      <Text style={[styles.amount, { color }]}>
        {amount.toFixed(0)} {CURRENCY_SYMBOL}
      </Text>
      <Text style={styles.description}>
        {isNegative
          ? 'Attention: solde insuffisant'
          : isLow
          ? 'Prudence requise'
          : 'Vous êtes en bonne position'}
      </Text>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: c.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.cardBorder,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amount: {
    fontSize: 42,
    fontWeight: '700',
    color: c.emerald,
  },
  description: {
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 8,
  },
  reservedHint: {
    fontSize: 12,
    color: '#22d3ee',
    fontWeight: '500',
    marginTop: -2,
  },
});
}
