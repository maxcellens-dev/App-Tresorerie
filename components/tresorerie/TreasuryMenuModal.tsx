/**
 * Coquille des petits menus du plan de trésorerie : voile, carte centrée, en-tête titre +
 * fermeture, puis une liste d'options.
 *
 * Quatre modales de `app/(tabs)/tresorerie.tsx` posaient ce même gabarit (choix sur une
 * prévisionnelle, détail d'un brouillon, choix sur un virement, détail d'un virement prévisionnel).
 * En le sortant une fois, chacune se réduit à ses options propres.
 *
 * ⚠️ Le `TouchableOpacity` intérieur absorbe le tap : sans lui, toucher la carte remonterait
 * jusqu'au voile et refermerait le menu qu'on est en train d'utiliser.
 */
import React, { useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  colors: AppColors;
  children: React.ReactNode;
  /** Sous-titre optionnel sous le titre (mois concerné, montant…). */
  subtitle?: string;
  /** Style additionnel sur la carte — les modales de brouillon en ont une plus large et bordée. */
  containerStyle?: any;
}

export default function TreasuryMenuModal({
  visible, title, onClose, colors, children, subtitle, containerStyle,
}: Props) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Voile de fermeture : PAS un bouton. Ce rôle enveloppait toute la carte — et donc sa croix
          et ses options — dans un <button>, ce que le HTML interdit. La modale porte sa propre
          commande de fermeture, celle-là annoncée. */}
      <TouchableOpacity style={s.menuOverlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity style={[s.menuContainer, containerStyle]} onPress={() => {}} activeOpacity={1}>
          <View style={s.menuHeader}>
            <View>
              <Text style={s.menuTitle}>{title}</Text>
              {!!subtitle && <Text style={s.menuSubtitle}>{subtitle}</Text>}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose}>
              <Ionicons name="close" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>
          {children}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/** Une option de menu : icône colorée + libellé. Reproduit `menuOption` à l'identique. */
export function TreasuryMenuOption({
  icon, color, label, onPress, colors,
}: { icon: string; color: string; label: string; onPress: () => void; colors: AppColors }) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TouchableOpacity style={s.menuOption} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={s.menuOptionText}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Règles recopiées à l'identique depuis tresorerie.tsx. */
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    menuOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'center', alignItems: 'center' },
    menuContainer: {
      backgroundColor: c.cardSolid, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      width: '80%', maxWidth: 320, overflow: 'hidden',
    },
    menuHeader: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: c.cardBorder,
    },
    menuTitle: { fontSize: 16, fontWeight: '600', color: c.text },
    menuSubtitle: { fontSize: 12, color: '#f59e0b', marginTop: 2 },
    menuOption: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: 'rgba(148, 163, 184, 0.1)', gap: 12,
    },
    menuOptionText: { fontSize: 14, fontWeight: '500', color: c.text },
  });
}
