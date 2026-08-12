/**
 * Coquille commune des modales du Pilotage : voile, boîte centrée, en-tête titre + fermeture.
 *
 * Ce gabarit était recopié à l'identique pour chacune des huit modales de `app/(tabs)/pilotage.tsx`
 * — même voile, même boîte, même rangée d'en-tête, même bouton de fermeture. Onze usages des mêmes
 * quatre règles de style. En le sortant UNE fois, chaque modale se réduit à son contenu propre, et
 * une correction d'ergonomie (largeur, fermeture au tap à côté, libellé du bouton) ne se fait plus
 * qu'à un seul endroit.
 *
 * ⚠️ Le tap sur le voile ferme, le tap DANS la boîte ne ferme pas : c'est le `Pressable` interne au
 * gestionnaire vide qui absorbe l'événement. Ne pas le retirer en croyant simplifier.
 */
import React, { useMemo } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppColors } from '../../theme/palette';

export function makeModalShellStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    box: { width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { fontSize: 17, fontWeight: '800', color: c.text, flex: 1 },
  });
}

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  colors: AppColors;
  children: React.ReactNode;
  /** Style additionnel sur la boîte (largeur particulière, retrait des marges…). */
  boxStyle?: any;
  /**
   * Croix de fermeture dans l'en-tête. Certaines modales n'en ont pas : elles se terminent par un
   * bouton d'acquittement explicite (« Compris »), et rien d'autre ne doit détourner de ce geste.
   * Option, et non uniformisation d'office : ajouter une croix là où il n'y en avait pas serait un
   * changement de comportement déguisé en déplacement de code.
   */
  showClose?: boolean;
}

export default function PilotageModalShell({
  visible, title, onClose, colors, children, boxStyle, showClose = true,
}: Props) {
  const s = useMemo(() => makeModalShellStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.box, boxStyle]} onPress={() => {}}>
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            {showClose && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            )}
          </View>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
