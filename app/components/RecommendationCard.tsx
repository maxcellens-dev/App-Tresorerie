import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import type { SmartRecommendation, RecoType } from '../lib/recommendationEngine';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { getIgnored, addIgnored, getCompleted, addCompleted, isHidden, type IgnoredMap } from '../lib/recoDismissals';


interface SmartRecommendationCardProps {
  recommendations: SmartRecommendation[];
  tierLabel: string;
  tierColor: string;
  /** Masque le titre interne « Recommandations » (quand la section porte déjà ce titre). */
  hideTitle?: boolean;
  /** Reco Épargne → ouvrir le virement pré-rempli (épargne). */
  onEpargner?: (reco: SmartRecommendation) => void;
  /** Reco Invest → ouvrir le virement pré-rempli (investissement). */
  onInvestir?: (reco: SmartRecommendation) => void;
  /** Bouton « Cumuler » → ouvrir la modale pré-épargne/pré-invest. */
  onCumuler?: (type: 'epargne' | 'invest', reco: SmartRecommendation) => void;
  /** Reco Conserver → créer une réservation (après confirmation inline). */
  onReserver?: (reco: SmartRecommendation) => void;
  /** Présence d'un compte épargne / investissement (pour le message « pas de compte »). */
  hasSavingsAccount?: boolean;
  hasInvestmentAccount?: boolean;
  /** Lien « Créer un compte ». */
  onCreateAccount?: () => void;
}

export default function RecommendationCard({
  recommendations,
  tierLabel,
  tierColor,
  hideTitle = false,
  onEpargner,
  onInvestir,
  onCumuler,
  onReserver,
  hasSavingsAccount,
  hasInvestmentAccount,
  onCreateAccount,
}: SmartRecommendationCardProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ignored, setIgnored] = useState<IgnoredMap>({});
  const [completed, setCompleted] = useState<RecoType[]>([]);
  const [confirmReserve, setConfirmReserve] = useState(false);

  // Recharger les masquages à chaque focus (ex : retour de l'écran virement)
  const reloadDismissals = React.useCallback(() => {
    let active = true;
    Promise.all([getIgnored(), getCompleted()]).then(([ig, co]) => {
      if (active) { setIgnored(ig); setCompleted(co); }
    });
    return () => { active = false; };
  }, []);
  useFocusEffect(reloadDismissals);

  const handleIgnore = (reco: SmartRecommendation) => {
    addIgnored(reco.type, reco.amount);
    setIgnored(prev => ({ ...prev, [reco.type]: Math.round(reco.amount) }));
    if (safeIndex >= visible.length - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const handleConfirmReserve = (reco: SmartRecommendation) => {
    onReserver?.(reco);
    addCompleted('keep');
    setCompleted(prev => prev.includes('keep') ? prev : [...prev, 'keep']);
    setConfirmReserve(false);
    if (safeIndex >= visible.length - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const visible = recommendations.filter(r => !isHidden(r.type, r.amount, ignored, completed));

  // Clamp index after dismiss
  const safeIndex = Math.min(currentIndex, Math.max(0, visible.length - 1));
  const currentReco = visible[safeIndex];

  // Réinitialiser la confirmation « Réserver » quand on change de reco
  React.useEffect(() => { setConfirmReserve(false); }, [safeIndex]);

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
        {!hideTitle && (
          <View style={styles.headerRow}>
            <Ionicons name="checkmark-circle" size={20} color="#34d399" />
            <Text style={styles.headerLabel}>Recommandations</Text>
          </View>
        )}
        <Text style={styles.emptyText}>
          Toutes les recommandations ont été traitées ce mois-ci ✨
        </Text>
      </View>
    );
  }

  const navControls = (
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
  );

  const bar = (
    <View style={[styles.barContainer, { flex: 1 }]}>
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
  );

  return (
    <View style={[styles.container, { borderColor: currentReco.color + '40' }]} {...panResponder.panHandlers}>
      {/* ── Header (titre + nav) — masqué si la section porte déjà le titre ── */}
      {!hideTitle && (
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Ionicons name="bulb-outline" size={20} color={tierColor} />
            <Text style={styles.headerLabel}>Recommandations</Text>
          </View>
          {navControls}
        </View>
      )}

      {/* ── Barre d'allocation (+ nav à droite quand le titre est masqué) ── */}
      {hideTitle ? (
        <View style={styles.barRow}>
          {bar}
          {navControls}
        </View>
      ) : (
        bar
      )}

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
              {r.shortTitle} {r.percentage}%
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
            {currentReco.amount.toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
          </Text>
        </View>
      </View>
      <Text style={styles.recoDescription}>{currentReco.description}</Text>

      {/* ── Actions selon le type de reco ── */}
      {confirmReserve && currentReco.type === 'keep' ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Réserver {currentReco.amount.toLocaleString('fr-FR')} {CURRENCY_SYMBOL} pour plus tard ? Cette somme sera déduite de votre reste disponible mais reste sur votre compte courant.
          </Text>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.dismissBtn} onPress={() => setConfirmReserve(false)} activeOpacity={0.7}>
              <Text style={styles.dismissText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }]}
              onPress={() => handleConfirmReserve(currentReco)}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark" size={16} color={currentReco.color} />
              <Text style={[styles.actionText, { color: currentReco.color }]}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.actionRow}>
            {/* Ignorer — toujours présent */}
            <TouchableOpacity style={styles.dismissBtn} onPress={() => handleIgnore(currentReco)} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color="#ef4444" />
              <Text style={styles.dismissText}>Ignorer</Text>
            </TouchableOpacity>

            {/* Action principale par type (masquée si le compte cible manque) */}
            {currentReco.type === 'save' && hasSavingsAccount !== false && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }]}
                onPress={() => onEpargner?.(currentReco)}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={16} color={currentReco.color} />
                <Text style={[styles.actionText, { color: currentReco.color }]}>Épargner</Text>
              </TouchableOpacity>
            )}
            {currentReco.type === 'invest' && hasInvestmentAccount !== false && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }]}
                onPress={() => onInvestir?.(currentReco)}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={16} color={currentReco.color} />
                <Text style={[styles.actionText, { color: currentReco.color }]}>Investir</Text>
              </TouchableOpacity>
            )}
            {currentReco.type === 'keep' && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }]}
                onPress={() => setConfirmReserve(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="bookmark-outline" size={16} color={currentReco.color} />
                <Text style={[styles.actionText, { color: currentReco.color }]}>Réserver</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Cumuler — épargne / invest uniquement, pleine largeur sous les actions */}
          {(currentReco.type === 'save' || currentReco.type === 'invest') && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: 8 }]}
              onPress={() => onCumuler?.(currentReco.type === 'save' ? 'epargne' : 'invest', currentReco)}
              activeOpacity={0.7}
            >
              <Ionicons name="layers-outline" size={16} color={COLORS.text} />
              <Text style={styles.secondaryText}>Cumuler pour plus tard</Text>
            </TouchableOpacity>
          )}

          {/* Message « pas de compte » (§2/§3) */}
          {((currentReco.type === 'save' && hasSavingsAccount === false) ||
            (currentReco.type === 'invest' && hasInvestmentAccount === false)) && (
            <TouchableOpacity style={styles.noAccountBox} onPress={onCreateAccount} activeOpacity={0.7}>
              <Ionicons name="information-circle-outline" size={15} color={currentReco.color} />
              <Text style={styles.noAccountText}>
                Vous n'avez pas encore de compte {currentReco.type === 'save' ? 'épargne' : 'investissement'}.{' '}
                <Text style={{ color: currentReco.color, fontWeight: '700' }}>Créez-en un dans Mes Comptes.</Text>
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
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
    color: c.textSecondary,
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
    borderColor: c.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  navIndicator: {
    fontSize: 12,
    color: c.textSecondary,
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
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
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
    color: c.textSecondary,
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
    color: c.text,
  },
  recoAmount: {
    fontSize: 24,
    fontWeight: '800',
  },
  recoDescription: {
    fontSize: 12,
    color: c.textSecondary,
    lineHeight: 17,
  },

  /* Actions */
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap',
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
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.cardBorder,
    backgroundColor: c.bg,
  },
  secondaryText: {
    fontSize: 12,
    color: c.text,
    fontWeight: '600',
  },

  /* Confirmation inline (Réserver) */
  confirmBox: {
    gap: 10,
    marginTop: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.cardBorder,
    backgroundColor: c.bg,
  },
  confirmText: {
    fontSize: 12,
    color: c.text,
    lineHeight: 17,
  },
  noAccountBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
  },
  noAccountText: { flex: 1, fontSize: 12, color: c.textSecondary, lineHeight: 17 },

  emptyText: {
    fontSize: 13,
    color: c.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
}
