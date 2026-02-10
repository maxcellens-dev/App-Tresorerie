import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SmartRecommendation } from '../lib/recommendationEngine';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
};

interface SmartRecommendationCardProps {
  recommendations: SmartRecommendation[];
  tierLabel: string;
  tierColor: string;
  onAction?: (reco: SmartRecommendation) => void;
}

export default function RecommendationCard({
  recommendations,
  tierLabel,
  tierColor,
  onAction,
}: SmartRecommendationCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  // Charger les dismissals au montage (par mois)
  React.useEffect(() => {
    const key = `reco_dismissed_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    AsyncStorage.getItem(key).then(existing => {
      if (existing) setDismissedIds(JSON.parse(existing));
    });
  }, []);

  const handleDismiss = useCallback((type: string) => {
    setDismissedIds(prev => {
      const next = [...prev, type];
      const key = `reco_dismissed_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      AsyncStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  }, []);

  const visible = recommendations.filter(r => !dismissedIds.includes(r.type));

  // Clamp index after dismiss
  const safeIndex = Math.min(currentIndex, Math.max(0, visible.length - 1));
  const currentReco = visible[safeIndex];

  const handlePrev = () => setCurrentIndex(prev => Math.max(0, prev - 1));
  const handleNext = () => setCurrentIndex(prev => Math.min(visible.length - 1, prev + 1));

  // Swipe gesture (uses functional setCurrentIndex to avoid stale closures)
  const visibleLenRef = useRef(visible.length);
  visibleLenRef.current = visible.length;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) {
          setCurrentIndex(prev => Math.min(visibleLenRef.current - 1, prev + 1));
        } else if (g.dx > 40) {
          setCurrentIndex(prev => Math.max(0, prev - 1));
        }
      },
    })
  ).current;

  if (visible.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Ionicons name="checkmark-circle" size={20} color="#34d399" />
          <Text style={styles.headerLabel}>Recommandations</Text>
        </View>
        <Text style={styles.emptyText}>
          Toutes les recommandations ont été traitées ce mois-ci ✨
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: currentReco.color + '40' }]} {...panResponder.panHandlers}>
      {/* ── Header with navigation ── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons name="bulb-outline" size={20} color={tierColor} />
          <Text style={styles.headerLabel}>Recommandations</Text>
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
          <Text style={styles.navIndicator}>{safeIndex + 1}/{visible.length}</Text>
          <TouchableOpacity
            style={[styles.navBtn, safeIndex === visible.length - 1 && styles.navBtnDisabled]}
            onPress={handleNext}
            disabled={safeIndex === visible.length - 1}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-forward" size={18} color={safeIndex === visible.length - 1 ? COLORS.cardBorder : COLORS.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Barre d'allocation (toutes les recos) ── */}
      <View style={styles.barContainer}>
        {visible.map((r, i) => (
          <TouchableOpacity
            key={r.type}
            style={[
              styles.barSegment,
              {
                flex: r.percentage,
                backgroundColor: r.type === currentReco.type ? r.color : r.color + '50',
                borderTopLeftRadius: i === 0 ? 6 : 0,
                borderBottomLeftRadius: i === 0 ? 6 : 0,
                borderTopRightRadius: i === visible.length - 1 ? 6 : 0,
                borderBottomRightRadius: i === visible.length - 1 ? 6 : 0,
              },
            ]}
            onPress={() => setCurrentIndex(i)}
            activeOpacity={0.8}
          />
        ))}
      </View>

      {/* ── Légende de la barre ── */}
      <View style={styles.legendRow}>
        {visible.map(r => (
          <TouchableOpacity
            key={r.type}
            style={styles.legendItem}
            activeOpacity={0.7}
            onPress={() => setCurrentIndex(visible.indexOf(r))}
          >
            <View style={[styles.legendDot, { backgroundColor: r.color }]} />
            <Text style={[
              styles.legendText,
              r.type === currentReco.type && { color: r.color, fontWeight: '700' },
            ]}>
              {r.title} {r.percentage}%
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Slide courante ── */}
      <View style={styles.slideRow}>
        <View style={[styles.recoIconCircle, { backgroundColor: currentReco.color + '18' }]}>
          <Ionicons name={currentReco.icon as any} size={18} color={currentReco.color} />
        </View>
        <View style={styles.slideContent}>
          <Text style={styles.recoTitle}>{currentReco.title}</Text>
          <Text style={[styles.recoAmount, { color: currentReco.color }]}>
            {currentReco.amount.toLocaleString('fr-FR')} €
          </Text>
        </View>
      </View>
      <Text style={styles.recoDescription}>{currentReco.description}</Text>

      {/* ── Boutons Ignorer / Appliquer ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.dismissBtn}
          onPress={() => {
            handleDismiss(currentReco.type);
            if (safeIndex >= visible.length - 1) {
              setCurrentIndex(Math.max(0, safeIndex - 1));
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={16} color="#ef4444" />
          <Text style={styles.dismissText}>Ignorer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }]}
          onPress={() => onAction?.(currentReco)}
          activeOpacity={0.7}
        >
          <Ionicons name={currentReco.actionRoute ? 'arrow-forward' as any : 'checkmark' as any} size={16} color={currentReco.color} />
          <Text style={[styles.actionText, { color: currentReco.color }]}>{currentReco.actionLabel}</Text>
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

  /* Header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLabel: {
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
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },

  /* Allocation bar */
  barContainer: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  barSegment: {
    height: '100%',
  },

  /* Legend */
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },

  /* Slide content */
  slideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recoIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideContent: {
    flex: 1,
    gap: 2,
  },
  recoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  recoAmount: {
    fontSize: 24,
    fontWeight: '800',
  },
  recoDescription: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17,
  },

  /* Actions */
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  dismissBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef444430',
    backgroundColor: '#ef444408',
  },
  dismissText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '500',
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
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },

  emptyText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
