import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePendingProfileChange, useMarkNotificationShown, useProfileNotificationMessages } from '../hooks/useFinancialProfile';
import { PROFILE_INFO } from '../lib/financialProfileEngine';
import type { FinancialProfileId } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';
import { useAuth } from '../contexts/AuthContext';
import { useGuide } from '../contexts/GuideContext';
import { sheetWidth } from '../lib/appLayout';


interface Props {
  userId: string | undefined;
}

function getTransitionKey(prev: string | null, next: string, reason: string): { transition: string; direction: 'upgrade' | 'downgrade' | 'exceptional' | 'same' } | null {
  // Bilan mensuel : le profil n'a pas changé → message « maintien », clé = profil courant.
  if (reason === 'monthly_recap') {
    return { transition: next, direction: 'same' };
  }
  if (reason === 'exceptional_revenue_drop') {
    if (!prev) return null;
    const prevNum = parseInt(prev.replace('P', ''));
    const nextNum = parseInt(next.replace('P', ''));
    const diff = prevNum - nextNum;
    return { transition: diff >= 2 ? 'exceptional_two' : 'exceptional_one', direction: 'exceptional' };
  }

  if (!prev) return null;
  const prevNum = parseInt(prev.replace('P', ''));
  const nextNum = parseInt(next.replace('P', ''));
  if (nextNum > prevNum) {
    return { transition: `P${prevNum}_P${nextNum}`, direction: 'upgrade' };
  }
  return { transition: `P${nextNum}_P${prevNum}`, direction: 'downgrade' };
}

// Replis si la ligne n'existe pas en base — TUTOIEMENT, comme partout dans l'app (migration 145).
const DEFAULT_MESSAGES: Record<string, { title: string; body: string }> = {
  'P1_P2|upgrade':    { title: '🌿 Tu changes de profil', body: 'Ton matelas de sécurité commence à se constituer. C\'est une vraie avancée.' },
  'P2_P3|upgrade':    { title: '⚖️ Tu changes de profil', body: 'Ta base financière est solide et ton comportement d\'épargne est régulier.' },
  'P3_P4|upgrade':    { title: '🚀 Tu changes de profil', body: 'Excellent travail. Ta réserve est confortable et tu investis régulièrement.' },
  'P4_P5|upgrade':    { title: '🎯 Tu changes de profil', body: 'Tu as atteint un niveau de maturité financière remarquable.' },
  'P1_P2|downgrade':  { title: '🌱 Ton profil évolue', body: 'Ta réserve s\'est réduite ou ton épargne est à l\'arrêt. Pas d\'inquiétude.' },
  'P2_P3|downgrade':  { title: '🌿 Ton profil évolue', body: 'Ta réserve est en dessous du seuil recommandé.' },
  'P3_P4|downgrade':  { title: '⚖️ Ton profil évolue', body: 'Ta réserve ou ton épargne a baissé temporairement.' },
  'P4_P5|downgrade':  { title: '🚀 Ton profil évolue', body: 'Ton flux d\'investissement est passé en dessous du seuil.' },
  'exceptional_one|exceptional': { title: '⚠️ Profil ajusté suite à une baisse de revenus', body: 'Tes revenus des 2 derniers mois sont inférieurs à ta moyenne habituelle.' },
  'exceptional_two|exceptional': { title: '⚠️ Profil ajusté — aucun revenu détecté', body: 'Aucun revenu enregistré ces 2 derniers mois.' },
  'P1|same': { title: '🌱 Tu conserves le profil', body: 'Ce mois-ci, ton profil reste inchangé. \nContinue à constituer ton matelas de sécurité.' },
  'P2|same': { title: '🌿 Tu conserves le profil', body: 'Ton profil reste stable ce mois-ci. \nPoursuis le renforcement de ta réserve.' },
  'P3|same': { title: '⚖️ Tu conserves le profil', body: 'Ta situation reste stable ce mois-ci. \nContinue sur cette lancée.' },
  'P4|same': { title: '🚀 Tu conserves le profil', body: 'Ton profil reste solide ce mois-ci. \nTa dynamique d\'investissement se confirme.' },
  'P5|same': { title: '🎯 Tu conserves le profil', body: 'Ta maturité financière se maintient ce mois-ci. \nContinue à optimiser ton patrimoine.' },
};

export default function ProfileChangeModal({ userId }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isImpersonating } = useAuth();
  const guide = useGuide();
  const { data: pendingChange } = usePendingProfileChange(userId);
  const { data: dbMessages = [] } = useProfileNotificationMessages();
  const markShown = useMarkNotificationShown(userId);

  /* PARCOURS DE DÉMARRAGE : on ne montre RIEN, et on consomme la notification en arrière-plan.
     Pendant l'installation, l'utilisateur saisit ses comptes puis ses récurrences : son profil se
     recalcule à chaque fois et grimpe (P1 → P3…). Chaque saut créait une notification, qui
     s'affichait par-dessus les écrans de présentation — un « ton profil a changé » avant même
     d'avoir vu l'app. On la marque donc comme vue sans la montrer : elle n'attend pas non plus la
     fin du guide pour resurgir hors contexte. */
  /* Silence pendant TOUT le parcours de démarrage, ET jusqu'à ce que sa conclusion ait été
     montrée (ProfileTourConclusion) : c'est elle qui présente le profil à la fin du tour, ce modal
     ne doit pas la doubler ni la précéder. */
  const duringGuide = guide.active || guide.booting || guide.tourJustFinished;
  useEffect(() => {
    if (!duringGuide || isImpersonating || !pendingChange) return;
    markShown.mutate(pendingChange.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duringGuide, isImpersonating, pendingChange?.id]);

  // En consultation admin : ne pas afficher le message de bilan/changement de profil du compte
  // cible (ni le marquer comme « vu »). C'est une notification destinée à l'utilisateur lui-même.
  if (isImpersonating) return null;
  if (duringGuide) return null;
  if (!pendingChange) return null;

  const key = getTransitionKey(
    pendingChange.previous_profile,
    pendingChange.new_profile,
    pendingChange.change_reason,
  );

  let title = 'Ton profil a changé';
  let body = '';

  if (key) {
    const dbMsg = dbMessages.find(
      m => m.transition === key.transition && m.direction === key.direction,
    );
    if (dbMsg) {
      title = dbMsg.title;
      body = dbMsg.body;
    } else {
      const fallback = DEFAULT_MESSAGES[`${key.transition}|${key.direction}`];
      if (fallback) { title = fallback.title; body = fallback.body; }
    }
  }

  const newProfileId = pendingChange.new_profile as FinancialProfileId;
  const profileInfo = PROFILE_INFO[newProfileId];

  const isUpgrade = key?.direction === 'upgrade';
  const isDowngrade = key?.direction === 'downgrade';
  const isSame = key?.direction === 'same';
  const accentColor = profileInfo?.color ?? COLORS.emerald;

  function handleClose() {
    markShown.mutate(pendingChange!.id);
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>

            {/* Direction badge */}
            <View style={[styles.directionBadge, {
              backgroundColor: isUpgrade ? '#1a2f1a' : isDowngrade ? '#2a1a1a' : isSame ? '#16223a' : '#1a1a2a',
            }]}>
              <Ionicons
                name={isUpgrade ? 'trending-up' : isDowngrade ? 'trending-down' : isSame ? 'sync' : 'warning'}
                size={16}
                color={isUpgrade ? COLORS.emerald : isDowngrade ? '#f87171' : isSame ? '#60a5fa' : '#f59e0b'}
              />
              <Text style={[styles.directionText, {
                color: isUpgrade ? COLORS.emerald : isDowngrade ? '#f87171' : isSame ? '#60a5fa' : '#f59e0b',
              }]}>
                {/* Pas « Bilan du mois » : ce message n'est pas un bilan mensuel, il peut arriver
                    à n'importe quel moment dès que les données bougent. */}
                {isUpgrade ? 'Progression' : isDowngrade ? 'Ajustement' : isSame ? 'Ton profil' : 'Alerte'}
              </Text>
            </View>

            {/* Titre */}
            <Text style={styles.title}>{title}</Text>

            {/* Nouveau profil */}
            {profileInfo && (
              <View style={[styles.profileCard, { borderColor: accentColor }]}>
                <Text style={styles.profileEmoji}>{profileInfo.emoji}</Text>
                <View style={styles.profileInfo}>
                  <Text style={[styles.profileName, { color: accentColor }]}>{profileInfo.name}</Text>
                  <Text style={styles.profileTier}>{profileInfo.tier}</Text>
                </View>
              </View>
            )}

            {/* Corps du message */}
            {!!body && <Text style={styles.body}>{body}</Text>}

            {/* Transition (masquée pour un bilan « maintien » : pas de changement à montrer) */}
            {pendingChange.previous_profile && !isSame && (
              <View style={styles.transitionRow}>
                <Text style={styles.transitionFrom}>
                  {PROFILE_INFO[pendingChange.previous_profile as FinancialProfileId]?.emoji}
                  {' '}
                  {PROFILE_INFO[pendingChange.previous_profile as FinancialProfileId]?.name}
                </Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.textSecondary} />
                <Text style={[styles.transitionTo, { color: accentColor }]}>
                  {profileInfo?.emoji} {profileInfo?.name}
                </Text>
              </View>
            )}

          </ScrollView>

          {/* CTA — SafeAreaView NATIF (edges bottom) : il mesure les insets de SA fenêtre (celle du
              Modal), donc le bouton reste au-dessus de la barre de navigation du téléphone, quelle
              qu'elle soit (3 boutons, geste, aucune). L'ancienne marge FIXE de 40 px tombait en
              plein dessous sur les téléphones à barre de boutons : le bouton passait dessous.
              (useSafeAreaInsets lirait le provider de la fenêtre PRINCIPALE : toujours faux ici.) */}
          <SafeAreaView edges={['bottom']}>
            <TouchableOpacity style={[styles.cta, { backgroundColor: accentColor }]} onPress={handleClose}>
              <Text style={styles.ctaText}>J'ai compris</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  sheet: {
    ...sheetWidth,
    backgroundColor: c.cardSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: c.cardBorder,
    maxHeight: '85%',
  },
  // Rythme resserré (l'ancien : padding 28 / gap 20) : sur un téléphone de taille courante, badge +
  // titre sur deux lignes + carte de profil + message + transition dépassaient la hauteur utile, et
  // la feuille se retrouvait collée à la barre système.
  sheetContent: {
    paddingHorizontal: 24,
    paddingTop: 22,
    gap: 16,
    paddingBottom: 10,
  },

  directionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  directionText: { fontSize: 13, fontWeight: '700' },

  title: { fontSize: 22, fontWeight: '800', color: c.text, lineHeight: 28 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 2, borderRadius: 16, padding: 16,
    backgroundColor: c.card,
  },
  profileEmoji: { fontSize: 36 },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 17, fontWeight: '800' },
  profileTier: { fontSize: 12, color: c.textSecondary },

  body: { color: c.text, fontSize: 15, lineHeight: 24 },

  transitionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: c.cardBorder,
  },
  transitionFrom: { color: c.textSecondary, fontSize: 13, fontWeight: '500', flex: 1 },
  transitionTo: { fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },

  // Marge basse MINIMALE : c'est le SafeAreaView autour qui ajoute la hauteur réelle de la barre
  // système. Cumuler les deux repoussait le bouton hors de la feuille sur les petits écrans.
  cta: {
    marginHorizontal: 24, marginBottom: 14, marginTop: 8,
    paddingVertical: 16, borderRadius: 16, alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: c.bg },
});
}
