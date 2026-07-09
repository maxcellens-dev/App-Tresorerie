import React, { useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PanResponder, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SmartRecommendation, RecoType } from '../lib/recommendationEngine';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useRecoDismissals } from '../hooks/useUiPrefs';
import { CURRENCY_SYMBOL, floorToTen } from '../lib/currency';
import { unverifiedSincePhrase, verifiedAgoPhrase } from '../lib/confidenceEngine';
import { isHidden } from '../lib/recoDismissals';
import { getRecoContextText, type RecoFinancials } from '../lib/recoContext';
import RelykaColumns from './RelykaColumns';


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
  /** Déjà réalisé ce mois par type de reco (segment foncé des colonnes). */
  doneByType?: Partial<Record<RecoType, number>>;
  /** Fourchette du Relyka (confiance moyenne/basse) — Phase 3. */
  relykaRange?: { low: number; high: number; isRange: boolean };
  /** Fourchette proportionnelle d'un sous-montant (reco) — Phase 3. */
  recoRange?: (amount: number) => { low: number; high: number; isRange: boolean };
  /** Niveau de confiance courant (liseré / bandeau ambre / CTA « Vérifier ») — Phase 3. */
  confidenceLevel?: 'high' | 'medium' | 'low';
  /** Jours depuis la dernière vérification (bandeau ambre). */
  daysSinceVerification?: number;
  /** Action « Vérifier mon solde » (deeplink saisie de solde). */
  onVerify?: () => void;
  /** Aperçu admin (banners-preview) : ne persiste AUCUN masquage et n'applique pas ceux du compte. */
  previewMode?: boolean;
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
  doneByType,
  relykaRange,
  recoRange,
  confidenceLevel = 'high',
  daysSinceVerification = 0,
  onVerify,
  previewMode = false,
}: SmartRecommendationCardProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { user } = useAuth();
  // Masquages stockés par compte (profiles.ui_prefs) → réactifs et identiques sur tous les appareils.
  const { ignored, completed, addIgnored } = useRecoDismissals(user?.id);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmReserve, setConfirmReserve] = useState(false);
  const [reserveAmount, setReserveAmount] = useState('');

  const handleIgnore = (reco: SmartRecommendation) => {
    if (!previewMode) addIgnored(reco.type, reco.amount);
    if (safeIndex >= count - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const handleConfirmReserve = (reco: SmartRecommendation) => {
    const parsed = parseFloat(reserveAmount.replace(',', '.'));
    // La saisie = montant COMPLÉMENTAIRE à conserver (à ajouter au déjà-conservé), pas le total.
    // Repli = montant actionnable (borne basse « minimum sûr » quand on est en fourchette).
    const addition = !Number.isNaN(parsed) && parsed > 0 ? Math.round(parsed) : (reco.actionAmount ?? reco.amount);
    onReserver?.(reco, Math.round(reservedThisMonth + addition));
    // On ne marque PAS « keep » comme traitée : la réservation est déjà comptée dans le suivi du
    // mois (alreadyAllocated.keep) → la reco « Conserver » se réduit du montant réservé et
    // réapparaît diminuée s'il reste un solde à conserver.
    setConfirmReserve(false);
    if (safeIndex >= count - 1) setCurrentIndex(Math.max(0, safeIndex - 1));
  };

  const visible = previewMode
    ? recommendations
    : recommendations.filter(r => !isHidden(r.type, r.amount, ignored, completed));

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
    <View style={[styles.container, (isLead && Math.round(relykaAmount) <= 0) && { minHeight: 0 }, { borderColor: (confidenceLevel === 'low' ? COLORS.orange : ((isLead ? relykaColor : currentReco?.color) ?? COLORS.emerald)) + '55' }]} {...panResponder.panHandlers}>
      {/* Bandeau ambre « solde non vérifié » — visible sur TOUTES les slides (confiance basse). */}
      {confidenceLevel === 'low' && onVerify && (
        <TouchableOpacity style={styles.amberBanner} onPress={onVerify} activeOpacity={0.85}>
          <Ionicons name="alert-circle-outline" size={15} color={COLORS.orange} />
          <Text style={styles.amberText} numberOfLines={2}>
            Solde non vérifié {unverifiedSincePhrase(daysSinceVerification)} — Ton relyka est une estimation — vérifie ton solde pour un suivi fiable.
          </Text>
          <Text style={styles.amberCta}>Vérifier</Text>
        </TouchableOpacity>
      )}
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

      {isLead && Math.round(relykaAmount) <= 0 ? (
        /* ── Relyka à 0 € : version SIMPLE (pas de jauge ni de fourchette 0–200 trompeuse) ──
           On affiche « 0 € » net. Le bandeau de vérification reste au-dessus (confiance basse).
           S'il existe des recommandations (épargne/invest), on garde la navigation vers leurs slides. */
        <View style={styles.leadCompact}>
          <View style={styles.leadCompactRow}>
            <TouchableOpacity
              activeOpacity={onOpenRelyka ? 0.7 : 1}
              disabled={!onOpenRelyka}
              onPress={onOpenRelyka}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}
            >
              <Text style={styles.leadTitle}>Ton Relyka</Text>
              <Text style={[styles.leadCompactAmount, { color: COLORS.text }]}>
                {Math.round(relykaAmount).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
              </Text>
              {onOpenRelyka && count === 1 && <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />}
            </TouchableOpacity>
            {count > 1 ? navControls : <View />}
          </View>
          {!!relykaMessage && <Text style={styles.leadCompactMsg}>{relykaMessage}</Text>}
        </View>
      ) : isLead ? (
        /* ── Slide 0 : jauge « Ton Relyka » composée des couleurs des recos ── */
        <View style={styles.leadSlide}>
          <View style={styles.leadTopRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.leadTitle}>Ton Relyka</Text>
              {/* Retour POSITIF quand tout va bien / info douce en confiance moyenne. */}
              {confidenceLevel === 'high' && (
                <View style={styles.freshBadge}>
                  <Ionicons name="checkmark-circle" size={11} color={COLORS.green} />
                  <Text style={styles.freshBadgeText}>À jour</Text>
                </View>
              )}
              {confidenceLevel === 'medium' && (
                <View style={[styles.freshBadge, { backgroundColor: COLORS.textSecondary + '18', borderColor: COLORS.textSecondary + '44' }]}>
                  <Text style={[styles.freshBadgeText, { color: COLORS.textSecondary }]}>Vérifié {verifiedAgoPhrase(daysSinceVerification)}</Text>
                </View>
              )}
            </View>
            {count > 1 ? navControls : <View />}
          </View>
          <RelykaColumns
            relykaAmount={relykaAmount}
            relykaRange={relykaRange}
            relykaColor={relykaColor}
            columns={visible.map((r) => ({
              key: `${r.type}:${r.amount}`,
              label: r.shortTitle,
              amount: r.amount,
              color: r.color,
              done: doneByType?.[r.type] ?? 0,
              range: recoRange ? recoRange(r.amount) : undefined,
            }))}
            onColumnPress={(i) => setCurrentIndex(lead + i)}
            onCenterPress={onOpenRelyka}
          />
          {!!relykaMessage && <Text style={styles.leadMessage}>{relykaMessage}</Text>}
        </View>
      ) : currentReco ? (
      <View style={styles.recoSlide}>
      {/* Groupe HAUT : titre section + icône/titre/montant + textes — toujours collés en haut,
          donc icône/titre/montant ne bougent pas d'une reco à l'autre (§N3). */}
      <View style={styles.recoTop}>
      {/* Titre « Recommandations » + navigation — aligné avec la slide « Ton Relyka » (§N3).
          Cliquable → retour à la slide 1 « Ton Relyka » (uniquement si cette slide existe). */}
      <View style={styles.leadTopRow}>
        <TouchableOpacity
          onPress={() => lead === 1 && setCurrentIndex(0)}
          disabled={lead !== 1}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          {lead === 1 && <Ionicons name="chevron-back" size={14} color={COLORS.textSecondary} />}
          <Text style={styles.leadTitle}>Recommandations</Text>
        </TouchableOpacity>
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
              {(() => {
                const r = recoRange?.(currentReco.amount);
                const flr = (n: number) => Math.max(0, floorToTen(n));
                return r?.isRange
                  ? `${flr(r.low).toLocaleString('fr-FR')}–${flr(r.high).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`
                  : `${currentReco.amount.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;
              })()}
            </Text>
          </View>
        </View>
        <Text style={styles.recoDescription}>{currentReco.description}</Text>
        {financials && (() => {
          // Tip calculé sur le montant ACTIONNABLE (borne basse si fourchette) → cohérent avec la
          // description et les CTA.
          const ctx = getRecoContextText(currentReco.type, currentReco.actionAmount ?? currentReco.amount, financials);
          return ctx ? (
            <View style={[styles.contextBox, { borderColor: currentReco.color + '40', backgroundColor: currentReco.color + '10' }]}>
              <Text style={[styles.contextText, { color: currentReco.color }]}>{ctx}</Text>
            </View>
          ) : null;
        })()}
        {/* Garde-fou marge × projection : montant réduit / mis en réserve (encadré orange). */}
        {!!currentReco.guardNote && (
          <View style={[styles.contextBox, { marginTop: 0, borderColor: COLORS.orange + '44', backgroundColor: COLORS.orange + '12' }]}>
            <Text style={[styles.contextText, { color: COLORS.orange }]}>{currentReco.guardNote}</Text>
          </View>
        )}
        {/* Conseil « virement récurrent » : tenable (ou non) en répétant le montant chaque mois. */}
        {!!currentReco.recurringNote && (
          <View style={styles.recurringNoteRow}>
            <Ionicons name="repeat-outline" size={13} color={COLORS.textSecondary} style={{ marginTop: 2 }} />
            <Text style={styles.recurringNoteText}>{currentReco.recurringNote}</Text>
          </View>
        )}
      </View>
      </View>

      {/* ── Actions en bas du bloc (évite la marge vide, §N3) ── */}
      <View>
      {confirmReserve && currentReco.type === 'keep' ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            {reservedThisMonth > 0
              ? `Déjà conservé ce mois : ${reservedThisMonth.toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}. Montant supplémentaire à conserver ce mois-ci :`
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
          {reservedThisMonth > 0 && (
            <Text style={styles.confirmText}>
              Nouveau total conservé : {Math.round(reservedThisMonth + (Math.max(0, parseFloat(reserveAmount.replace(',', '.'))) || 0)).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
            </Text>
          )}
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
          {/* Confiance BASSE : on ne pousse pas à déplacer de l'argent réel sur des chiffres douteux.
              → « Vérifier mon solde d'abord » devient l'action PRINCIPALE, les actions passent en
              style secondaire (dégrisées, toujours accessibles — jamais bloquées). */}
          {confidenceLevel === 'low' && onVerify && (
            <TouchableOpacity
              style={styles.verifyFirstBtn}
              onPress={onVerify}
              activeOpacity={0.85}
            >
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.bg} />
              <Text style={styles.verifyFirstText}>Vérifier mon solde d'abord</Text>
            </TouchableOpacity>
          )}
          <View style={styles.actionRow}>
            {/* Ignorer — toujours présent */}
            <TouchableOpacity style={styles.dismissBtn} onPress={() => handleIgnore(currentReco)} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color={COLORS.danger} />
              <Text style={styles.dismissText}>Ignorer</Text>
            </TouchableOpacity>

            {/* Action principale par type (masquée si le compte cible manque) ; SECONDAIRE en confiance basse. */}
            {currentReco.type === 'save' && hasSavingsAccount !== false && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }, confidenceLevel === 'low' && styles.actionBtnMuted]}
                onPress={() => onEpargner?.(currentReco)}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={16} color={currentReco.color} />
                <Text style={[styles.actionText, { color: currentReco.color }]}>Épargner</Text>
              </TouchableOpacity>
            )}
            {currentReco.type === 'invest' && hasInvestmentAccount !== false && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }, confidenceLevel === 'low' && styles.actionBtnMuted]}
                onPress={() => onInvestir?.(currentReco)}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-forward" size={16} color={currentReco.color} />
                <Text style={[styles.actionText, { color: currentReco.color }]}>Investir</Text>
              </TouchableOpacity>
            )}
            {currentReco.type === 'keep' && (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: currentReco.color + '60', backgroundColor: currentReco.color + '12' }, confidenceLevel === 'low' && styles.actionBtnMuted]}
                onPress={() => { setReserveAmount(String(Math.round(currentReco.actionAmount ?? currentReco.amount))); setConfirmReserve(true); }}
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

      {/* Points de pagination : plus scannables que « 1/5 », tapables pour sauter à une slide. */}
      {count > 1 && (
        <View style={styles.dotsRow}>
          {Array.from({ length: count }, (_, i) => (
            <TouchableOpacity key={i} onPress={() => setCurrentIndex(i)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <View
                style={[
                  styles.dot,
                  i === safeIndex
                    ? { backgroundColor: (isLead ? relykaColor : currentReco?.color) ?? COLORS.emerald, width: 18 }
                    : { backgroundColor: COLORS.cardBorder },
                ]}
              />
            </TouchableOpacity>
          ))}
        </View>
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
    // Hauteur constante : la slide jauge « Ton Relyka » est la plus grande ; les slides recos
    // remplissent la même hauteur (titre en haut, actions en bas) → plus de saut au swipe.
    minHeight: 332,
  },

  /* Bandeau ambre confiance basse */
  amberBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.orange + '14', borderWidth: 1, borderColor: c.orange + '44',
    borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10,
  },
  amberText: { flex: 1, fontSize: 11.5, color: c.text, fontWeight: '600', lineHeight: 15 },
  amberCta: { fontSize: 12, fontWeight: '800', color: c.orange },

  /* Confiance basse : CTA principal « Vérifier mon solde d'abord » + actions en secondaire */
  verifyFirstBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.orange, borderRadius: 10, paddingVertical: 10, marginTop: 4, marginBottom: 8,
  },
  verifyFirstText: { fontSize: 13, fontWeight: '800', color: c.bg },
  actionBtnMuted: { opacity: 0.5, backgroundColor: 'transparent' },

  /* Points de pagination du carrousel */
  dotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },

  /* Badge fraîcheur (confiance haute « À jour » / moyenne « Vérifié il y a N j ») */
  freshBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: c.green + '16', borderWidth: 1, borderColor: c.green + '44',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
  },
  freshBadgeText: { fontSize: 10, fontWeight: '800', color: c.green },

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
  recurringNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingHorizontal: 2 },
  recurringNoteText: { flex: 1, fontSize: 11.5, color: c.textSecondary, lineHeight: 16, fontStyle: 'italic' },

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
