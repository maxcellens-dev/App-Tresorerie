/**
 * IconPickerModal — sélecteur d'icône pour une sous-catégorie (§13).
 * Grille d'icônes du glossaire (Ionicons). Centré, fermable au tap extérieur.
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { CATEGORY_ICON_GLOSSARY } from '../lib/categoryIcons';

interface Props {
  visible: boolean;
  value?: string | null;
  title?: string;
  onClose: () => void;
  onSelect: (icon: string) => void;
}

export default function IconPickerModal({ visible, value, title = 'Choisir une icône', onClose, onSelect }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  // Dédoublonne (le glossaire peut contenir des répétitions volontaires).
  const icons = Array.from(new Set(CATEGORY_ICON_GLOSSARY));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.box} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false} contentContainerStyle={styles.grid}>
            {icons.map((name) => {
              const active = value === name;
              return (
                <TouchableOpacity
                  key={name}
                  style={[styles.cell, active && { backgroundColor: COLORS.emerald + '22', borderColor: COLORS.emerald }]}
                  onPress={() => { onSelect(name); onClose(); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name={name as any} size={24} color={active ? COLORS.emerald : COLORS.text} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    box: { width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 18 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '800', color: c.text, flex: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 6 },
    cell: {
      width: 52, height: 52, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    },
  });
}
