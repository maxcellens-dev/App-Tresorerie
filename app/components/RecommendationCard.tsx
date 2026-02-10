import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
  orange: '#f59e0b',
  red: '#ef4444',
  cyan: '#22d3ee',
};

interface Recommendation {
  id: string;
  type: 'save' | 'invest' | 'reduce' | 'transfer';
  title: string;
  description: string;
  amount?: number;
  icon: string;
  color: string;
}

interface RecommendationProps {
  projection: number;
  recommendation: 'À ÉPARGNER' | 'À INVESTIR';
  onAction?: () => void;
}

function generateRecommendations(projection: number, recommendation: 'À ÉPARGNER' | 'À INVESTIR'): Recommendation[] {
  const recos: Recommendation[] = [];
  
  if (recommendation === 'À ÉPARGNER') {
    recos.push({
      id: 'save-surplus',
      type: 'save',
      title: 'Épargner le surplus',
      description: `Transférez ${projection.toFixed(0)} € vers votre épargne de sécurité`,
      amount: projection,
      icon: 'wallet',
      color: COLORS.emerald,
    });
    if (projection > 200) {
      recos.push({
        id: 'split-savings',
        type: 'save',
        title: 'Répartir l\'épargne',
        description: `Divisez : ${(projection * 0.7).toFixed(0)} € sécurité + ${(projection * 0.3).toFixed(0)} € projets`,
        amount: projection,
        icon: 'git-branch',
        color: COLORS.cyan,
      });
    }
  } else {
    recos.push({
      id: 'invest-surplus',
      type: 'invest',
      title: 'Investir le surplus',
      description: `Placez ${projection.toFixed(0)} € sur vos investissements`,
      amount: projection,
      icon: 'trending-up',
      color: COLORS.cyan,
    });
    if (projection > 500) {
      recos.push({
        id: 'invest-partial',
        type: 'invest',
        title: 'Investissement partiel',
        description: `Investissez ${(projection * 0.6).toFixed(0)} € et gardez ${(projection * 0.4).toFixed(0)} € en réserve`,
        amount: projection * 0.6,
        icon: 'pie-chart',
        color: COLORS.emerald,
      });
    }
  }

  recos.push({
    id: 'reduce-variable',
    type: 'reduce',
    title: 'Réduire les dépenses variables',
    description: 'Limitez vos achats non essentiels ce mois-ci',
    icon: 'trending-down',
    color: COLORS.orange,
  });

  return recos;
}

export default function RecommendationCard({ projection, recommendation, onAction }: RecommendationProps) {
  const allRecos = generateRecommendations(projection, recommendation);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // Filtrer les recommandations non rejetées
  const visibleRecos = allRecos.filter(r => !dismissedIds.includes(r.id));
  const safeIndex = Math.min(currentIndex, Math.max(0, visibleRecos.length - 1));
  const currentReco = visibleRecos[safeIndex];

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds(prev => [...prev, id]);
    // Stocker le refus pour le mois en cours
    const monthKey = `reco_dismissed_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    AsyncStorage.getItem(monthKey).then(existing => {
      const list = existing ? JSON.parse(existing) : [];
      list.push(id);
      AsyncStorage.setItem(monthKey, JSON.stringify(list));
    });
    if (safeIndex >= visibleRecos.length - 1) {
      setCurrentIndex(Math.max(0, safeIndex - 1));
    }
  }, [safeIndex, visibleRecos.length]);

  const handlePrev = () => setCurrentIndex(Math.max(0, safeIndex - 1));
  const handleNext = () => setCurrentIndex(Math.min(visibleRecos.length - 1, safeIndex + 1));

  // Charger les dismissals au montage
  React.useEffect(() => {
    const monthKey = `reco_dismissed_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    AsyncStorage.getItem(monthKey).then(existing => {
      if (existing) setDismissedIds(JSON.parse(existing));
    });
  }, []);

  if (visibleRecos.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Ionicons name="checkmark-circle" size={24} color={COLORS.emerald} />
          <Text style={styles.label}>Actions recommandées</Text>
        </View>
        <Text style={styles.emptyText}>Toutes les recommandations ont été traitées ce mois-ci ✨</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: currentReco.color + '40' }]}>
      {/* Header with navigation */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name={currentReco.icon as any} size={24} color={currentReco.color} />
          <Text style={styles.label}>Actions recommandées</Text>
        </View>
        <View style={styles.navRow}>
          <TouchableOpacity
            style={[styles.navBtn, safeIndex === 0 && styles.navBtnDisabled]}
            onPress={handlePrev}
            disabled={safeIndex === 0}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={18} color={safeIndex === 0 ? COLORS.cardBorder : COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.navIndicator}>{safeIndex + 1}/{visibleRecos.length}</Text>
          <TouchableOpacity
            style={[styles.navBtn, safeIndex === visibleRecos.length - 1 && styles.navBtnDisabled]}
            onPress={handleNext}
            disabled={safeIndex === visibleRecos.length - 1}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={18} color={safeIndex === visibleRecos.length - 1 ? COLORS.cardBorder : COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Recommendation content */}
      <Text style={styles.recoTitle}>{currentReco.title}</Text>
      {currentReco.amount !== undefined && (
        <Text style={[styles.recoAmount, { color: currentReco.color }]}>
          {currentReco.amount.toFixed(0)} €
        </Text>
      )}
      <Text style={styles.recoDescription}>{currentReco.description}</Text>

      {/* Accept / Reject buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={() => handleDismiss(currentReco.id)}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={16} color={COLORS.red} />
          <Text style={[styles.actionBtnText, { color: COLORS.red }]}>Ignorer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.acceptBtn, { borderColor: currentReco.color }]}
          onPress={onAction}
          activeOpacity={0.7}
        >
          <Ionicons name="checkmark" size={16} color={currentReco.color} />
          <Text style={[styles.actionBtnText, { color: currentReco.color }]}>Appliquer</Text>
        </TouchableOpacity>
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
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  navIndicator: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
    marginHorizontal: 4,
  },
  recoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  recoAmount: {
    fontSize: 28,
    fontWeight: '800',
    marginVertical: 2,
  },
  recoDescription: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  rejectBtn: {
    borderColor: COLORS.red + '30',
    backgroundColor: COLORS.red + '08',
  },
  acceptBtn: {
    backgroundColor: '#1e293b',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
