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
  reserved?: number;
}

export default function SafeToSpend({ amount, isLow = false, isNegative = false, reserved = 0 }: SafeToSpendProps) {
  const color = isNegative ? COLORS.red : isLow ? COLORS.orange : COLORS.emerald;
  
  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: color + '20' }]}>
          <Text style={{ fontSize: 20 }}>💰</Text>
        </View>
        <Text style={styles.label}>À dépenser ou placer en sécurité</Text>
      </View>
      <Text style={[styles.amount, { color }]}>
        {amount.toFixed(0)} €
      </Text>
      {reserved > 0 && (
        <Text style={styles.reservedHint}>
          dont {reserved.toFixed(0)} € réservés projets
        </Text>
      )}
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
  reservedHint: {
    fontSize: 12,
    color: '#22d3ee',
    fontWeight: '500',
    marginTop: -2,
  },
});
