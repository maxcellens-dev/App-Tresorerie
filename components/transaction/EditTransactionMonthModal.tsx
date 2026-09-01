import { useMemo, useState, useEffect } from 'react';
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
import { useSetTransactionMonthOverride, useDeleteTransactionMonthOverride } from '../../hooks/data/useTransactionMonthOverrides';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCY_SYMBOL, currencySymbolFor } from '../../lib/finance/currency';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import { sanitizeAmountInput, parseAmountInput } from '../../lib/ui/amountInput';
import { useSubmitLock } from '../../hooks/platform/useSubmitLock';

interface EditTransactionMonthModalProps {
  visible: boolean;
  onClose: () => void;
  transactionId: string;
  transactionLabel: string;
  categoryName?: string;
  year: number;
  month: number;
  originalAmount: number;
  /**
   * Devise du COMPTE de l'opération. Le montant saisi ici est enregistré tel quel dans
   * `transaction_month_overrides` et remplace l'échéance sur ce compte : il est donc dans SA devise,
   * jamais dans la devise de référence. Absente → devise de référence (cas mono-devise).
   */
  currency?: string | null;
  currentOverrideAmount?: number;
  /**
   * Signe de l'opération d'origine (négatif = dépense). L'échéance modifiée est enregistrée AVEC ce
   * signe : c'est ainsi que la lisent le plan de trésorerie, la Projection et le Reporting. Sans
   * lui, corriger une dépense la transformait en recette (cf. le bloc « LE SIGNE » plus bas).
   */
  signHint?: number;
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
  currency,
  currentOverrideAmount,
  signHint,
  profileId,
}: EditTransactionMonthModalProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const symbol = currency ? currencySymbolFor(currency) : CURRENCY_SYMBOL;
  /* ── LE SIGNE DE L'ÉCHÉANCE MODIFIÉE ─────────────────────────────────────────────────────────
   * `override_amount` est lu comme un montant SIGNÉ par tout ce qui projette : plan de trésorerie,
   * page Projection, Reporting. L'écran d'édition d'une transaction y écrit d'ailleurs bien une
   * valeur signée (négative pour une dépense).
   * Cette modale, elle, enregistrait la valeur ABSOLUE saisie. Corriger un loyer de 800 € à 750 €
   * depuis le plan de trésorerie stockait donc **+750** là où le modèle vaut −800 : la dépense
   * devenait une RECETTE. Le mois affichait un crédit au lieu d'une charge, et le solde projeté
   * partait 1 550 € trop haut — sur ce mois-là et sur tous les suivants, qui s'enchaînent.
   * On travaille donc en valeur absolue à l'écran (c'est ce que l'utilisateur lit), et on applique
   * le signe de l'opération d'origine au moment d'enregistrer.
   */
  const sign = signHint != null && signHint < 0 ? -1 : 1;
  const absOriginal = Math.abs(originalAmount);
  const absCurrent = currentOverrideAmount !== undefined ? Math.abs(currentOverrideAmount) : undefined;

  const [inputValue, setInputValue] = useState(String(absCurrent ?? absOriginal));
  const setOverride = useSetTransactionMonthOverride(profileId);
  const deleteOverride = useDeleteTransactionMonthOverride(profileId);
  const [isLoading, setIsLoading] = useState(false);
  // Verrou SYNCHRONE : `disabled={isLoading}` ne prend effet qu'au rendu suivant, donc après un
  // second tap. Deux enregistrements concurrents sur la même échéance partaient en conflit d'upsert.
  const saveLock = useSubmitLock();

  useEffect(() => {
    setInputValue(String(absCurrent ?? absOriginal));
  }, [visible, absOriginal, absCurrent]);

  /** Lecture du champ : virgule décimale acceptée (« 117,06 » valait 117 avec `parseFloat` nu). */
  const readAmount = (raw: string): number | null => {
    const n = parseAmountInput(raw);
    return n != null && Number.isFinite(n) ? Math.abs(n) : null;
  };

  const handleSave = async () => {
    const amount = readAmount(inputValue);
    if (amount == null || amount === 0) {
      Alert.alert('Erreur', 'Entre un montant valide');
      return;
    }
    if (!saveLock.acquire()) return;

    try {
      setIsLoading(true);
      if (Math.abs(amount - absOriginal) < 0.01) {
        // Si le montant = original, supprimer l'override s'il existe
        if (currentOverrideAmount !== undefined) {
          await deleteOverride.mutateAsync({ transaction_id: transactionId, year, month });
        }
      } else {
        // Créer/modifier l'override — SIGNÉ comme l'opération d'origine (cf. bloc ci-dessus).
        await setOverride.mutateAsync({
          transaction_id: transactionId,
          year,
          month,
          override_amount: sign * amount,
        });
      }
      onClose();
    } catch (error: any) {
      // Le vrai message plutôt qu'un texte générique : « violation d'unicité » ou « hors ligne »
      // n'appellent pas la même réaction de la part de l'utilisateur.
      Alert.alert('Erreur', error?.message ?? 'Impossible de sauvegarder la modification');
    } finally {
      setIsLoading(false);
      saveLock.release();
    }
  };

  const handleResetToOriginal = () => {
    if (currentOverrideAmount !== undefined) {
      setInputValue(String(absOriginal));
    }
  };

  const isModified = (() => {
    const n = readAmount(inputValue);
    return n != null && Math.abs(n - (absCurrent ?? absOriginal)) > 0.01;
  })();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAwareOverlay style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Modifier montant</Text>
              <Text style={styles.subtitle}>
                {transactionLabel} • {MONTHS[month - 1]} {year}
              </Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose}>
              <Ionicons name="close" size={24} color="#94a3b8" />
            </TouchableOpacity>
          </View>

          {/* Info section */}
          <View style={styles.infoSection}>
            {/* `!!` : une CHAÎNE, et l'un des appelants la construit en `cat?.name ?? ''` — sans
                coercition, une catégorie introuvable rendait `''` comme nœud de texte. */}
            {!!categoryName && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Catégorie:</Text>
                <Text style={styles.infoValue}>{categoryName}</Text>
              </View>
            )}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Montant original:</Text>
              <Text style={styles.infoValue}>{originalAmount.toFixed(2)} {symbol}</Text>
            </View>
            {currentOverrideAmount !== undefined && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Montant actuel:</Text>
                <Text style={[styles.infoValue, { color: '#f59e0b' }]}>
                  {currentOverrideAmount.toFixed(2)} {symbol}
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
                // Normalisé à la frappe : au plus un séparateur décimal (cf. lib/ui/amountInput).
                onChangeText={(v) => setInputValue(sanitizeAmountInput(v))}
                placeholder={String(absOriginal)}
                placeholderTextColor="#64748b"
                keyboardType="decimal-pad"
                editable={!isLoading}
              />
              <Text style={styles.currency}>{symbol}</Text>
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
      </KeyboardAwareOverlay>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modal: {
    backgroundColor: c.cardSolid,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
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
    borderBottomColor: c.cardBorder,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: c.textSecondary,
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
    color: c.textSecondary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 13,
    color: c.text,
    fontWeight: '600',
  },
  inputSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: c.textSecondary,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.cardBorder,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.cardBorder,
    paddingRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: c.text,
    fontWeight: '600',
  },
  currency: {
    fontSize: 16,
    fontWeight: '600',
    color: c.textSecondary,
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
    color: c.textSecondary,
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
    color: c.textSecondary,
  },
  saveButton: {
    flex: 1.5,
    backgroundColor: c.green,
  },
  saveButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: c.bg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
}
