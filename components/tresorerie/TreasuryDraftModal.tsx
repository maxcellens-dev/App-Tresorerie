/**
 * Formulaire de saisie d'une transaction PRÉVISIONNELLE (brouillon) depuis le plan de trésorerie.
 *
 * Deux modales quasi jumelles vivaient dans `app/(tabs)/tresorerie.tsx` — la dépense/recette
 * prévisionnelle et le virement prévisionnel. Même carte bordée d'orange, même montant, même
 * libellé, même bande de comptes, même bouton. Seuls changeaient les libellés, le filtre de comptes
 * et l'action de validation : c'est donc UNE coquille paramétrée, pas deux composants.
 *
 * ⚠️ Elle ne passe PAS par `TreasuryMenuModal` : celle-là est un menu d'options (carte étroite, une
 * liste de choix), celle-ci un formulaire (carte large bordée d'orange, des champs de saisie). Les
 * confondre reviendrait à faire porter deux intentions à un même gabarit.
 */
import { useMemo } from 'react';
import { View, Text, Modal, ScrollView, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Ligne de contexte sous le titre (catégorie ou type de mouvement, puis le mois). */
  subtitle: string | null;
  amount: string;
  onAmountChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  notePlaceholder: string;
  /** Intitulé de la bande de comptes (« Compte », « Compte de destination »). */
  accountLabel: string;
  /** Comptes éligibles, DÉJÀ filtrés par l'appelant : le filtre dépend de la nature du brouillon. */
  accounts: Array<{ id: string; name: string }>;
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  submitIcon: keyof typeof Ionicons.glyphMap;
  submitLabel: string;
  onSubmit: () => void;
  submitting: boolean;
  colors: AppColors;
}

export default function TreasuryDraftModal({
  visible, onClose, title, subtitle, amount, onAmountChange, note, onNoteChange, notePlaceholder,
  accountLabel, accounts, selectedAccountId, onSelectAccount, submitIcon, submitLabel, onSubmit,
  submitting, colors,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Le TouchableOpacity intérieur absorbe le clic : sans lui, toucher la carte remonterait
          jusqu'au fond et refermerait le formulaire qu'on est en train de remplir. */}
      <TouchableOpacity style={styles.overlay} onPress={onClose} activeOpacity={1}>
        <TouchableOpacity style={styles.container} onPress={() => {}} activeOpacity={1}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>{title}</Text>
              {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose}>
              <Ionicons name="close" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Montant ({CURRENCY_SYMBOL})</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={onAmountChange}
            placeholder="0,00"
            placeholderTextColor="#64748b"
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Libellé (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={onNoteChange}
            placeholder={notePlaceholder}
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>{accountLabel}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {accounts.map((acc) => {
              const active = selectedAccountId === acc.id;
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[styles.accountChip, active && styles.accountChipActive]}
                  onPress={() => onSelectAccount(acc.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.accountChipText, active && styles.accountChipTextActive]}>{acc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            onPress={onSubmit}
            disabled={submitting}
          >
            <Ionicons name={submitIcon} size={18} color="#f59e0b" style={{ marginRight: 8 }} />
            <Text style={styles.submitLabel}>{submitLabel}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    container: {
      backgroundColor: c.cardSolid,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.orange + '44',
      width: '90%',
      maxWidth: 400,
      padding: 20,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.cardBorder,
    },
    title: { fontSize: 16, fontWeight: '600', color: c.text },
    sub: { fontSize: 12, color: '#f59e0b', marginTop: 2 },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    input: {
      backgroundColor: c.bg,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: c.text,
      marginBottom: 16,
    },
    accountChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.cardBorder,
      marginRight: 8,
    },
    accountChipActive: { backgroundColor: '#f59e0b22', borderColor: '#f59e0b' },
    accountChipText: { fontSize: 13, color: c.text },
    accountChipTextActive: { color: '#f59e0b', fontWeight: '600' },
    submitBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#f59e0b',
      backgroundColor: '#f59e0b11',
    },
    submitLabel: { fontSize: 15, fontWeight: '700', color: '#f59e0b' },
  });
}
