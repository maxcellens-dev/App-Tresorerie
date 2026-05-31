/**
 * Mini-panneau d'accès aux cumuls pré-épargne / pré-invest (§12).
 * Ouvert depuis le bouton permanent « Mes cumuls » ou le bandeau.
 */
import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';
import type { PreSavingType } from '../types/database';

interface Props {
  visible: boolean;
  epargneTotal: number;
  investTotal: number;
  onClose: () => void;
  onOpen: (type: PreSavingType) => void;
}

export default function CumulsPanel({ visible, epargneTotal, investTotal, onClose, onOpen }: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);

  const rows: { type: PreSavingType; label: string; total: number; icon: string; color: string }[] = [
    { type: 'epargne', label: 'Pré-épargne', total: epargneTotal, icon: 'shield-outline', color: '#34d399' },
    { type: 'invest', label: 'Pré-invest', total: investTotal, icon: 'trending-up-outline', color: '#a78bfa' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Mes cumuls</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          {rows.map((r) => (
            <TouchableOpacity key={r.type} style={styles.row} onPress={() => onOpen(r.type)} activeOpacity={0.8}>
              <View style={[styles.iconBox, { backgroundColor: r.color + '22' }]}>
                <Ionicons name={r.icon as any} size={18} color={r.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowHint}>Cumul en attente de virement</Text>
              </View>
              <Text style={[styles.rowTotal, { color: r.color }]}>
                {Math.round(r.total).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: 24, paddingBottom: 36, borderTopWidth: 1, borderColor: c.cardBorder, gap: 10,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { fontSize: 18, fontWeight: '800', color: c.text },
    closeBtn: { padding: 4 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14,
    },
    iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    rowLabel: { fontSize: 15, fontWeight: '700', color: c.text },
    rowHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
    rowTotal: { fontSize: 16, fontWeight: '800' },
  });
}
