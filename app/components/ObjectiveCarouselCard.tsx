import React, { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import type { Objective } from '../types/database';
import { useAccountTransactionsByYear, calculateYearlyTotal } from '../hooks/useAccountTransactionsByYear';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#6366f1',  // Different color for objectives (indigo)
  border: '#1e293b',
  background: '#020617',
};

interface ObjectiveCarouselCardProps {
  objective: Objective;
}

export default function ObjectiveCarouselCard({ objective }: ObjectiveCarouselCardProps) {
  const { width } = useWindowDimensions();
  const cardWidth = width / 2.8; // Further reduced to ensure full visibility

  // For annual objectives, fetch transactions from linked account
  const currentYear = new Date().getFullYear();
  const { data: transactions = [] } = useAccountTransactionsByYear(
    objective.linked_account_id || undefined,
    currentYear
  );

  const progress = useMemo(() => {
    let currentAmount = 0;

    if (objective.category === 'Objectif annuel' && objective.linked_account_id) {
      // Sum all transactions from the year
      currentAmount = calculateYearlyTotal(transactions);
    } else {
      // For fixed objectives, use current_year_invested 
      currentAmount = objective.current_year_invested || 0;
    }

    if (objective.target_yearly_amount <= 0) return { percentage: 0, currentAmount };
    
    const percentage = Math.min(100, Math.round((currentAmount / objective.target_yearly_amount) * 100));
    return { percentage, currentAmount };
  }, [objective, transactions]);

  const progressBarWidth = useMemo(() => {
    return Math.max((progress.percentage / 100) * (cardWidth - 50), 2);
  }, [progress.percentage, cardWidth]);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: COLORS.surface,
          borderColor: COLORS.border,
          width: cardWidth,
        },
      ]}
    >
      {/* Header - Name + Progress % */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.title, { color: COLORS.text }]}>
            {objective.name}
          </Text>
          {objective.category && (
            <Text numberOfLines={1} style={[styles.category, { color: COLORS.textSecondary }]}>
              {objective.category}
            </Text>
          )}
        </View>
        <Text style={[styles.progress, { color: COLORS.primary }]}>
          {progress.percentage}%
        </Text>
      </View>

      {/* Amount + Progress Bar (compact) */}
      <View style={styles.progressSection}>
        <View style={styles.amountCompact}>
          <Text style={[styles.amountSmall, { color: COLORS.primary }]}>
            €{progress.currentAmount.toFixed(0)}
          </Text>
          <Text style={[styles.targetSmall, { color: COLORS.textSecondary }]}>
            / €{objective.target_yearly_amount.toFixed(0)}
          </Text>
        </View>
        <View
          style={[
            styles.progressBarContainer,
            { backgroundColor: COLORS.background, borderColor: COLORS.border },
          ]}
        >
          <View
            style={[
              styles.progressBar,
              { 
                width: progressBarWidth,
                backgroundColor: COLORS.primary,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  category: {
    fontSize: 9,
    marginTop: 1,
  },
  progress: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 0,
  },
  progressSection: {
    gap: 3,
  },
  amountCompact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  amountSmall: {
    fontSize: 12,
    fontWeight: '700',
  },
  targetSmall: {
    fontSize: 10,
  },
  progressBarContainer: {
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
    borderWidth: 0,
    maxWidth: '100%',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
});
