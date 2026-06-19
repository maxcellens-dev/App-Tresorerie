import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePendingProfileChange, useMarkNotificationShown, useProfileNotificationMessages } from '../hooks/useFinancialProfile';
import { PROFILE_INFO } from '../lib/financialProfileEngine';
import type { FinancialProfileId } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';


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

const DEFAULT_MESSAGES: Record<string, { title: string; body: string }> = {
  'P1_P2|upgrade':    { title: '🌿 Vous passez au profil "Réserve à construire"', body: 'Votre matelas de sécurité commence à se constituer. C\'est une vraie avancée.' },
  'P2_P3|upgrade':    { title: '⚖️ Vous passez au profil "Stabilité à améliorer"', body: 'Votre base financière est solide et votre comportement d\'épargne est régulier.' },
  'P3_P4|upgrade':    { title: '🚀 Vous passez au profil "Bonne dynamique"', body: 'Excellent travail. Votre réserve est confortable et vous investissez régulièrement.' },
  'P4_P5|upgrade':    { title: '🎯 Vous passez au profil "Patrimoine en développement"', body: 'Vous avez atteint un niveau de maturité financière remarquable.' },
  'P1_P2|downgrade':  { title: '🌱 Votre profil évolue vers "Premiers repères"', body: 'Votre réserve s\'est réduite ou votre épargne est à l\'arrêt. Pas d\'inquiétude.' },
  'P2_P3|downgrade':  { title: '🌿 Votre profil évolue vers "Réserve à construire"', body: 'Votre réserve est en dessous du seuil recommandé.' },
  'P3_P4|downgrade':  { title: '⚖️ Votre profil évolue vers "Stabilité à améliorer"', body: 'Votre réserve ou votre épargne a baissé temporairement.' },
  'P4_P5|downgrade':  { title: '🚀 Votre profil évolue vers "Bonne dynamique"', body: 'Votre flux d\'investissement est passé en dessous du seuil.' },
  'exceptional_one|exceptional': { title: '⚠️ Profil ajusté suite à une baisse de revenus', body: 'Vos revenus des 2 derniers mois sont inférieurs à votre moyenne habituelle.' },
  'exceptional_two|exceptional': { title: '⚠️ Profil ajusté — aucun revenu détecté', body: 'Aucun revenu enregistré ces 2 derniers mois.' },
  'P1|same': { title: '🌱 Toujours au profil "Premiers repères"', body: 'Ce mois-ci, votre profil reste inchangé. Continuez à constituer votre matelas de sécurité.' },
  'P2|same': { title: '🌿 Toujours au profil "Réserve à construire"', body: 'Votre profil reste stable ce mois-ci. Poursuivez le renforcement de votre réserve.' },
  'P3|same': { title: '⚖️ Toujours au profil "Stabilité à améliorer"', body: 'Votre situation reste stable ce mois-ci. Continuez sur cette lancée.' },
  'P4|same': { title: '🚀 Toujours au profil "Bonne dynamique"', body: 'Votre profil reste solide ce mois-ci. Votre dynamique d\'investissement se confirme.' },
  'P5|same': { title: '🎯 Toujours au profil "Patrimoine en développement"', body: 'Votre maturité financière se maintient ce mois-ci. Continuez à optimiser votre patrimoine.' },
};

export default function ProfileChangeModal({ userId }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const { data: pendingChange } = usePendingProfileChange(userId);
  const { data: dbMessages = [] } = useProfileNotificationMessages();
  const markShown = useMarkNotificationShown(userId);

  if (!pendingChange) return null;

  const key = getTransitionKey(
    pendingChange.previous_profile,
    pendingChange.new_profile,
    pendingChange.change_reason,
  );

  let title = 'Votre profil a changé';
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
                {isUpgrade ? 'Progression' : isDowngrade ? 'Ajustement' : isSame ? 'Bilan du mois' : 'Alerte'}
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

          {/* CTA */}
          <TouchableOpacity style={[styles.cta, { backgroundColor: accentColor }]} onPress={handleClose}>
            <Text style={styles.ctaText}>J'ai compris</Text>
          </TouchableOpacity>
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
    backgroundColor: c.cardSolid,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: c.cardBorder,
    maxHeight: '85%',
  },
  sheetContent: {
    padding: 28,
    gap: 20,
    paddingBottom: 12,
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

  cta: {
    marginHorizontal: 28, marginBottom: 40, marginTop: 8,
    paddingVertical: 16, borderRadius: 16, alignItems: 'center',
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: c.bg },
});
}
