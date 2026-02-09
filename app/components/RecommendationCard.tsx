import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  orange: '#f59e0b',
  red: '#ef4444',
  blue: '#60a5fa',
};

interface RecommendationProps {
  projection: number;
  recommendation: 'À ÉPARGNER' | 'À INVESTIR';
  onAction?: () => void;
}

export default function RecommendationCard({ projection, recommendation, onAction }: RecommendationProps) {
  const isToSave = recommendation === 'À ÉPARGNER';
  const icon = isToSave ? 'wallet' : 'trending-up';
  const color = isToSave ? COLORS.emerald : COLORS.blue;
  const buttonText = isToSave ? '💰 Épargner ce surplus' : '🚀 Investir ce surplus';

  return (
    <View style={[styles.container, { borderColor: color + '40' }]}>
      <View style={styles.header}>
        <Ionicons name={icon} size={28} color={color} />
        <Text style={styles.label}>Action recommandée</Text>
      </View>

      <Text style={styles.recommendation}>{recommendation}</Text>

      <View style={styles.amountBox}>
        <Text style={styles.amountLabel}>Surplus disponible</Text>
        <Text style={[styles.amount, { color }]}>{projection.toFixed(0)} €</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: color + '20', borderColor: color }]}
        onPress={onAction}
        activeOpacity={0.7}
      >
        <Text style={[styles.buttonText, { color }]}>{buttonText}</Text>
      </TouchableOpacity>

      <Text style={styles.hint}>
        {isToSave
          ? 'Constituez votre fonds de sécurité avant d\'investir'
          : 'Vous êtes en position d\'investir pour votre avenir'}
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
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recommendation: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  amountBox: {
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 12,
    gap: 4,
  },
  amountLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
});
