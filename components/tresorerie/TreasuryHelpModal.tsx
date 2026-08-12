/**
 * « Comment lire ce tableau » — l'aide du plan de trésorerie.
 *
 * Extraite de `app/(tabs)/tresorerie.tsx` à l'identique. Deux règles d'ergonomie y sont encodées
 * et faciles à défaire par mégarde :
 *  • carte CENTRÉE, pas feuille collée en bas : en bas, elle sortait du champ sur un écran
 *    d'ordinateur ;
 *  • le plafond de hauteur est porté par la carte ELLE-MÊME. Une `View` a `flexShrink: 0` : un
 *    parent plafonné ne la rétrécirait pas, elle déborderait de l'écran en emportant la légende
 *    (le défaut déjà corrigé sur la clôture mensuelle).
 */
import React, { useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: AppColors;
  /** Légende des couleurs et styles du tableau, rendue par l'écran (elle dépend de son thème). */
  renderLegend: () => React.ReactNode;
}

export default function TreasuryHelpModal({ visible, onClose, colors, renderLegend }: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* Fermable en touchant à côté : une aide ouverte par curiosité doit se refermer d'un geste,
          sans viser la croix. Le `TouchableOpacity` intérieur ABSORBE le tap — sans lui, toucher la
          carte remonterait jusqu'au fond et refermerait la fiche qu'on est en train de lire. */}
      {/* Voile de fermeture : PAS un bouton — ce rôle enveloppait la carte entière dans un
          <button>, imbrication interdite en HTML. La croix ci-dessous porte l'annonce. */}
      <TouchableOpacity
        style={styles.helpOverlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity style={styles.helpSheet} activeOpacity={1} onPress={() => {}}>
          <View style={styles.helpHead}>
            <Text style={styles.helpTitle}>Comment lire ce tableau</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.helpScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.helpText}>
              Le plan est alimenté par tes transactions et tes récurrences : tu n'as rien à y saisir.
            </Text>
            <Text style={styles.helpText}>
              <Text style={styles.helpStrong}>Appuie sur un montant</Text> pour voir le détail des
              opérations qui le composent.
            </Text>
            <Text style={styles.helpText}>
              <Text style={styles.helpStrong}>Simplifié / Détaillé</Text> replie ou déplie les
              sous-catégories.
            </Text>
            <Text style={styles.helpSection}>Couleurs et styles</Text>
            {renderLegend()}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

/** Règles recopiées à l'identique depuis tresorerie.tsx. */
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    helpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
    helpSheet: {
      width: '100%', maxWidth: 460, maxHeight: '82%',
      backgroundColor: c.cardSolid ?? c.card, borderRadius: 22,
      borderWidth: 1, borderColor: c.cardBorder, padding: 20,
    },
    helpScroll: { flexGrow: 0, flexShrink: 1 },
    helpHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    helpTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    helpText: { fontSize: 14, color: c.textSecondary, lineHeight: 21, marginBottom: 12 },
    helpStrong: { fontWeight: '800', color: c.text },
    helpSection: { fontSize: 11.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6, marginBottom: 2 },
  });
}
