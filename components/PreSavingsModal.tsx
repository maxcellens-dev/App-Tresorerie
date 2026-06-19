/**
 * Modale de pré-épargne / pré-investissement (action « Cumuler »).
 * Permet d'accumuler mentalement un montant (déduit du reste disponible) puis,
 * le moment venu, de créer un virement global du total cumulé.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, Platform, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../lib/currency';
import type { PreSavingType } from '../types/database';

interface Props {
  visible: boolean;
  type: PreSavingType;
  recoAmount: number;   // pré-remplissage du champ
  total: number;        // cumul actuel
  base: number;         // base à dépenser (pour l'alerte de dépassement)
  onClose: () => void;
  onSave: (montant: number) => void;
  onCreateTransfer: (montant: number) => void;
  onReset: () => void;
}

const num = (s: string) => parseFloat(String(s).replace(/\s/g, '').replace(/,/g, '.')) || 0;

export default function PreSavingsModal({
  visible, type, recoAmount, total, base, onClose, onSave, onCreateTransfer, onReset,
}: Props) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const [montant, setMontant] = useState('');

  useEffect(() => {
    if (visible) setMontant(recoAmount > 0 ? String(Math.round(recoAmount)) : '');
  }, [visible, recoAmount]);

  const saisi = num(montant);
  const nouveauTotal = total + saisi;
  const depasse = nouveauTotal > base;
  const isEpargne = type === 'epargne';
  const titre = isEpargne ? 'Pré-épargne' : 'Pré-investissement';
  const accent = isEpargne ? COLORS.green : '#a78bfa';

  function confirmReset() {
    // Confirmation in-app (§7) — plus de window.confirm navigateur.
    Alert.alert('Remettre à 0', 'Remettre le cumul à 0 ? Aucun virement ne sera créé.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Remettre à 0', style: 'destructive', onPress: onReset },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name={isEpargne ? 'shield-outline' : 'trending-up-outline'} size={20} color={accent} />
              <Text style={styles.title}>{titre}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Accumulez un montant à mettre de côté. Il est déduit de votre « Budget libre à allouer » tant que vous n'avez pas fait le virement.
          </Text>

          <Text style={styles.label}>Montant à ajouter</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={montant}
              onChangeText={(t) => setMontant(t.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={COLORS.textSecondary}
            />
            <Text style={styles.suffix}>{CURRENCY_SYMBOL}</Text>
          </View>

          <View style={[styles.totalBox, { borderColor: accent + '40', backgroundColor: accent + '12' }]}>
            <Text style={styles.totalLabel}>Total cumulé</Text>
            <Text style={[styles.totalValue, { color: accent }]}>
              {Math.round(nouveauTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}
            </Text>
          </View>

          {depasse && (
            <View style={styles.warnBox}>
              <Ionicons name="warning-outline" size={15} color="#f87171" />
              <Text style={styles.warnText}>
                Ce cumul dépasse votre reste disponible ({Math.round(base).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}).
              </Text>
            </View>
          )}

          {/* Boutons */}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: accent }, saisi <= 0 && { opacity: 0.5 }]}
            onPress={() => { if (saisi > 0) onSave(saisi); }}
            disabled={saisi <= 0}
          >
            <Text style={styles.primaryLabel}>Enregistrer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: accent + '60' }]}
            onPress={() => onCreateTransfer(nouveauTotal)}
            disabled={nouveauTotal <= 0}
          >
            <Ionicons name="swap-horizontal" size={16} color={accent} />
            <Text style={[styles.secondaryLabel, { color: accent }]}>
              Créer le virement global ({Math.round(nouveauTotal).toLocaleString('fr-FR')} {CURRENCY_SYMBOL})
            </Text>
          </TouchableOpacity>

          {total > 0 && (
            <TouchableOpacity style={styles.resetBtn} onPress={confirmReset}>
              <Text style={styles.resetLabel}>Remettre à 0</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    sheet: {
      width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20,
      padding: 22, borderWidth: 1, borderColor: c.cardBorder, gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 18, fontWeight: '800', color: c.text },
    closeBtn: { padding: 4 },
    hint: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginTop: 4 },
    inputWrap: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14,
    },
    input: { flex: 1, color: c.text, fontSize: 18, fontWeight: '700', paddingVertical: 12 },
    suffix: { color: c.textSecondary, fontSize: 15, fontWeight: '600' },
    totalBox: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    },
    totalLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    totalValue: { fontSize: 18, fontWeight: '800' },
    warnBox: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: '#f8717115', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    },
    warnText: { flex: 1, fontSize: 12, color: '#f87171', fontWeight: '500' },
    primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
    primaryLabel: { fontSize: 15, fontWeight: '700', color: '#06281f' },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderRadius: 12, paddingVertical: 13, borderWidth: 1,
    },
    secondaryLabel: { fontSize: 13, fontWeight: '700' },
    resetBtn: { alignItems: 'center', paddingVertical: 8 },
    resetLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '500', textDecorationLine: 'underline' },
  });
}
