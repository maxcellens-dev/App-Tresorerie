import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  orange: '#f59e0b',
  red: '#ef4444',
};

interface SafeToSpendProps {
  amount: number;
  isLow?: boolean;
  isNegative?: boolean;
}

export default function SafeToSpend({ amount, isLow = false, isNegative = false }: SafeToSpendProps) {
  const color = isNegative ? COLORS.red : isLow ? COLORS.orange : COLORS.emerald;
  
  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <Text style={styles.label}>À dépenser en sécurité</Text>
      <Text style={[styles.amount, { color }]}>
        {amount.toFixed(0)} €
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

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: COLORS.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    gap: 8,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amount: {
    fontSize: 42,
    fontWeight: '700',
    color: COLORS.emerald,
  },
  description: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
});
