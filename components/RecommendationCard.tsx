import React, { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SmartRecommendation, RecoType } from '../lib/recommendationEngine';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useRecoDismissals } from '../hooks/useUiPrefs';
import { CURRENCY_SYMBOL } from '../lib/currency';
import { isHidden } from '../lib/recoDismissals';
import { getRecoContextText, type RecoFinancials } from '../lib/recoContext';
import RelykaGauge from './RelykaGauge';


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
  /** Reco Conserver → créer une réservation (après confirmation inline). Montant éditable. */
  onReserver?: (reco: SmartRecommendation, amount?: number) => void;
  /** Total déjà conservé ce mois (réservations) — affiché et inclus dans le nouveau total. */
  reservedThisMonth?: number;
  /** Présence d'un compte épargne / investissement (pour le message « pas de compte »). */
  hasSavingsAccount?: boolean;
  hasInvestmentAccount?: boolean;
  /** Lien « Créer un compte ». */
  onCreateAccount?: () => void;
  /** Affiche en 1ʳᵉ slide une jauge « Ton Relyka » composée des couleurs des recos visibles. */
  showRelykaSlide?: boolean;
  /** Montant du Relyka (reste à vivre) affiché au centre de la jauge. */
  relykaAmount?: number;
  /** Couleur du montant central (état : sain / épuisé / négatif). */
  relykaColor?: string;
  /** Message dynamique affiché sous la jauge. */
  relykaMessage?: string;
  /** Ouvre le détail « Ton Relyka » (utilisé sur la version compacte à 0 €). */
  onOpenRelyka?: () => void;
  /** Données financières pour la phrase contextuelle sous chaque reco (projection invest, économie…). */
  financials?: RecoFinancials;
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
  reservedThisMonth = 0,
  hasSavingsAccount,
  hasInvestmentAccount,
  onCreateAccount,
  showRelykaSlide = false,
  relykaAmount = 0,
  relykaColor,
  relykaMessage,
  onOpenRelyka,
  financials,
}: SmartRecommendationCardProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();
  // Masquages stockés par compte (profiles.ui_prefs) → réactifs et identiques sur tous les appareils.
  const { ignored, completed, addIgnored, addCompleted } = useRecoDismissals(user?.id);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmReserve, setConfirmReserve] = useState(false);
  const [reserveAmount, setReserveAmount] = useState('');

  const handleIgnore = (reco: SmartRecommendation) => {
    addIgnored(reco.type, reco.amount);
    if (safeIndex >= count - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const handleConfirmReserve = (reco: SmartRecommendation) => {
    const parsed = parseFloat(reserveAmount.replace(',', '.'));
    const amount = !Number.isNaN(parsed) && parsed > 0 ? Math.round(parsed) : reco.amount;
    onReserver?.(reco, amount);
    addCompleted('keep');
    setConfirmReserve(false);
    if (safeIndex >= count - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const visible = recommendations.filter(r => !isHidden(r.type, r.amount, ignored, completed));

  // Slide 0 = jauge « Ton Relyka » (optionnelle) ; slides suivants = recos.
  const lead = showRelykaSlide ? 1 : 0;
  const count = visible.length + lead;

  // Clamp index after dismiss
  const safeIndex = Math.min(currentIndex, Math.max(0, count - 1));
  const isLead = lead === 1 && safeIndex === 0;
  const currentReco = lead === 1 ? visible[safeIndex - 1] : visible[safeIndex];

  // Réinitialiser la confirmation « Réserver » quand on change de slide
  React.useEffect(() => { setConfirmReserve(false); }, [safeIndex]);

  const handlePrev = () => setCurrentIndex(prev => Math.max(0, prev - 1));
  const handleNext = () => setCurrentIndex(prev => Math.min(count - 1, prev + 1));

  // Swipe gesture (uses functional setCurrentIndex to avoid stale closures)
  const countRef = useRef(count);
  countRef.current = count;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) {
          setCurrentIndex(prev => Math.min(countRef.current - 1, prev + 1));
        } else if (g.dx > 40) {
          setCurrentIndex(prev => Math.max(0, prev - 1));
        }
      },
    })
  ).current;

  if (count === 0) {
    return (
      <View style={styles.container}>
        {!hideTitle && (
          <View style={styles.headerRow}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.green} />
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
      <Text style={styles.navIndicator}>{safeIndex + 1}/{count}</Text>
      <TouchableOpacity
        style={[styles.navBtn, safeIndex === count - 1 && styles.navBtnDisabled]}
        onPress={handleNext}
        disabled={safeIndex === count - 1}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-forward" size={18} color={safeIndex === count - 1 ? COLORS.cardBorder : COLORS.text} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, (isLead && count === 1 && Math.round(relykaAmount) <= 0) && { minHeight: 0 }, { borderColor: ((isLead ? relykaColor : currentReco?.color) ?? COLORS.emerald) + '40' }]} {...panResponder.panHandlers}>
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

      {isLead && count === 1 && Math.round(relykaAmount) <= 0 ? (
        /* ── À 0 € sans reco : version COMPACTE (pas de jauge, ligne réduite) ──
           Cliquable (chevron) → ouvre le détail « Ton Relyka », comme le bloc du Suivi du mois. */
        <TouchableOpacity style={styles.leadCompact} activeOpacity={onOpenRelyka ? 0.7 : 1} disabled={!onOpenRelyka} onPress={onOpenRelyka}>
          <View style={styles.leadCompactRow}>
            <Text style={styles.leadTitle}>Ton Relyka</Text>
            <View style={styles.leadCompactRight}>
              <Text style={[styles.leadCompactAmount, { color: COLORS.text }]}>
                {Math.round(relykaAmount).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
              </Text>
              {onOpenRelyka && <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />}
            </View>
          </View>
          {!!relykaMessage && <Text style={styles.leadCompactMsg}>{relykaMessage}</Text>}
        </TouchableOpacity>
      ) : isLead ? (
        /* ── Slide 0 : jauge « Ton Relyka » composée des couleurs des recos ── */
        <View style={styles.leadSlide}>
          <View style={styles.leadTopRow}>
            <Text style={styles.leadTitle}>Ton Relyka</Text>
            {count > 1 ? navControls : <View />}
          </View>
          <RelykaGauge
            amount={relykaAmount}
            segments={visible.map(r => ({ amount: r.amount, color: r.color }))}
            amountColor={COLORS.text}
            // Partie vide visible dans les deux thèmes (gris transparent : sombre sur fond clair,
            // clair sur fond sombre) — sinon le track blanc disparaît en thème clair.
            trackColor={COLORS.mode === 'light' ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'}
            onSegmentPress={(i) => setCurrentIndex(lead + i)}
          />
          {!!relykaMessage && <Text style={styles.leadMessage}>{relykaMessage}</Text>}
        </View>
      ) : currentReco ? (
      <View style={styles.recoSlide}>
      {/* Groupe HAUT : titre section + icône/titre/montant + textes — toujours collés en haut,
          donc icône/titre/montant ne bougent pas d'une reco à l'autre (§N3). */}
      <View style={styles.recoTop}>
      {/* Titre « Recommandations » + navigation — aligné avec la slide « Ton Relyka » (§N3) */}
      <View style={styles.leadTopRow}>
        <Text style={styles.leadTitle}>Recommandations</Text>
        {count > 1 ? navControls : <View />}
      </View>
      {/* Contenu : icône + titre/montant (position fixe) puis description + texte contextuel à la suite */}
      <View style={styles.recoMiddle}>
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
        {financials && (() => {
          const ctx = getRecoContextText(currentReco.type, currentReco.amount, financials);
          return ctx ? (
            <View style={[styles.contextBox, { borderColor: currentReco.color + '40', backgroundColor: currentReco.color + '10' }]}>
              <Text style={[styles.contextText, { color: currentReco.color }]}>{ctx}</Text>
            </View>
          ) : null;
        })()}
      </View>
      </View>

      {/* ── Actions en bas du bloc (évite la marge vide, §N3) ── */}
      <View>
      {confirmReserve && currentReco.type === 'keep' ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            {reservedThisMonth > 0
              ? `Déjà conservé ce mois : ${reservedThisMonth.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}. Valide le nouveau total à conserver ce mois-ci :`
              : 'Montant à conserver ce mois-ci ? Cette somme est déduite de ton reste disponible mais reste sur ton compte courant.'}
          </Text>
          <View style={styles.reserveAmountRow}>
            <TextInput
              style={styles.reserveInput}
              value={reserveAmount}
              onChangeText={(t) => setReserveAmount(t.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textSecondary}
              selectTextOnFocus
            />
            <Text style={styles.reserveCurrency}>{CURRENCY_SYMBOL}</Text>
          </View>
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
              <Ionicons name="close" size={16} color={COLORS.danger} />
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
                onPress={() => { setReserveAmount(String(Math.round(reservedThisMonth + currentReco.amount))); setConfirmReserve(true); }}
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
                Tu n'as pas encore de compte {currentReco.type === 'save' ? 'épargne' : 'investissement'}.{' '}
                <Text style={{ color: currentReco.color, fontWeight: '700' }}>Crées-en un dans Mes Comptes.</Text>
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
      </View>
      </View>
      ) : null}
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
    // Hauteur constante : la slide jauge « Ton Relyka » est la plus grande ; les slides recos
    // remplissent la même hauteur (titre en haut, actions en bas) → plus de saut au swipe.
    minHeight: 332,
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

  /* Slide jauge « Ton Relyka » + slide reco : même squelette (titre haut / contenu / bas) */
  leadSlide: { flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  leadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', alignSelf: 'stretch' },
  leadTitle: { fontSize: 13, color: c.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  leadMessage: { fontSize: 12, color: c.textSecondary, lineHeight: 17, textAlign: 'center', paddingHorizontal: 4 },
  // Version compacte (Relyka à 0 € sans reco) : une ligne titre + montant, message à gauche.
  leadCompact: { gap: 6 },
  leadCompactRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leadCompactRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadCompactAmount: { fontSize: 22, fontWeight: '400' },
  leadCompactMsg: { fontSize: 12, color: c.textSecondary, lineHeight: 17, textAlign: 'left' },
  recoSlide: { flex: 1, justifyContent: 'space-between', gap: 10 },
  // Groupe haut : titre section + icône/titre/montant + textes, collés en haut (position fixe au swipe).
  recoTop: { gap: 10 },
  recoMiddle: { gap: 10 },

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
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
  },
  recoAmount: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  recoDescription: {
    fontSize: 12,
    color: c.textSecondary,
    lineHeight: 17,
  },
  contextBox: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  contextText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
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
    borderColor: c.danger + '30',
    backgroundColor: c.danger + '08',
  },
  dismissText: {
    fontSize: 12,
    color: c.danger,
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
  reserveAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reserveInput: {
    flex: 1,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: '700',
    color: c.text,
    textAlign: 'right',
  },
  reserveCurrency: { fontSize: 16, fontWeight: '700', color: c.textSecondary },
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
