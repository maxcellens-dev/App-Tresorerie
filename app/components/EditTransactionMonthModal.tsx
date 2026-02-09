import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSetTransactionMonthOverride, useDeleteTransactionMonthOverride } from '../hooks/useTransactionMonthOverrides';

interface EditTransactionMonthModalProps {
  visible: boolean;
  onClose: () => void;
  transactionId: string;
  transactionLabel: string;
  categoryName?: string;
  year: number;
  month: number;
  originalAmount: number;
  currentOverrideAmount?: number;
  profileId: string | undefined;
}

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export default function EditTransactionMonthModal({
  visible,
  onClose,
  transactionId,
  transactionLabel,
  categoryName,
  year,
  month,
  originalAmount,
  currentOverrideAmount,
  profileId,
}: EditTransactionMonthModalProps) {
  const [inputValue, setInputValue] = useState(String(currentOverrideAmount ?? originalAmount));
  const setOverride = useSetTransactionMonthOverride(profileId);
  const deleteOverride = useDeleteTransactionMonthOverride(profileId);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setInputValue(String(currentOverrideAmount ?? originalAmount));
  }, [visible, originalAmount, currentOverrideAmount]);

  const handleSave = async () => {
    const amount = parseFloat(inputValue);
    if (isNaN(amount) || amount === 0) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    try {
      setIsLoading(true);
      if (Math.abs(amount - originalAmount) < 0.01) {
        // Si le montant = original, supprimer l'override s'il existe
        if (currentOverrideAmount !== undefined) {
          await deleteOverride.mutateAsync({ transaction_id: transactionId, year, month });
        }
      } else {
        // Créer/modifier l'override
        await setOverride.mutateAsync({
          transaction_id: transactionId,
          year,
          month,
          override_amount: amount,
        });
      }
      onClose();
    } catch (error) {
      Alert.alert('Erreur', 'Impossible de sauvegarder la modification');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetToOriginal = () => {
    if (currentOverrideAmount !== undefined) {
      setInputValue(String(originalAmount));
    }
  };

  const isModified =
    Math.abs(parseFloat(inputValue || '0') - (currentOverrideAmount ?? originalAmount)) > 0.01;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Modifier montant</Text>
              <Text style={styles.subtitle}>
                {transactionLabel} • {MONTHS[month - 1]} {year}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Info section */}
          <View style={styles.infoSection}>
            {categoryName && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Catégorie:</Text>
                <Text style={styles.infoValue}>{categoryName}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Montant original:</Text>
              <Text style={styles.infoValue}>{originalAmount.toFixed(2)} €</Text>
            </View>
            {currentOverrideAmount !== undefined && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Montant actuel:</Text>
                <Text style={[styles.infoValue, { color: '#f59e0b' }]}>
                  {currentOverrideAmount.toFixed(2)} €
                </Text>
              </View>
            )}
          </View>

          {/* Input */}
          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>Nouveau montant</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                value={inputValue}
                onChangeText={setInputValue}
                placeholder={String(originalAmount)}
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
                editable={!isLoading}
              />
              <Text style={styles.currency}>€</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            {currentOverrideAmount !== undefined && (
              <TouchableOpacity
                style={[styles.button, styles.resetButton]}
                onPress={handleResetToOriginal}
                disabled={isLoading}
              >
                <Ionicons name="refresh" size={18} color="#94a3b8" />
                <Text style={styles.resetButtonText}>Réinitialiser</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose} disabled={isLoading}>
              <Text style={styles.cancelButtonText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.saveButton, !isModified && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={!isModified || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color="#ffffff" />
                  <Text style={styles.saveButtonText}>Enregistrer</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modal: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    width: '100%',
    maxWidth: 400,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
  },
  infoRow: {
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '600',
  },
  inputSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  currency: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  resetButton: {
    backgroundColor: 'rgba(94, 109, 122, 0.3)',
    borderWidth: 1,
    borderColor: '#5e6d7a',
  },
  resetButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: 'rgba(94, 109, 122, 0.2)',
    borderWidth: 1,
    borderColor: '#5e6d7a',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
  },
  saveButton: {
    flex: 1.5,
    backgroundColor: '#34d399',
  },
  saveButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#020617',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
