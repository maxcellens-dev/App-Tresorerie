/**
 * SAISIE D'UNE OPÉRATION SUR UN COMPTE — un seul formulaire pour les trois gestes de la fiche
 * compte : « Apport », « Plus / moins-value » et « Intérêts ».
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────────────────────────────
 * Les trois vivaient en TROIS modales recopiées dans app/(tabs)/comptes/[id].tsx, chacune avec son
 * propre calendrier (quatre modales de calendrier dans un seul fichier), son propre état de
 * chargement, sa propre gestion d'erreur et ses propres libellés. Résultat : trois formulaires qui
 * se ressemblent sans jamais se comporter pareil — le sélecteur « Montant / Nouveau solde » existait
 * ici mais pas là, la note de repli suivait le signe dans un cas et pas dans l'autre, et corriger un
 * comportement obligeait à le corriger trois fois (ou à en oublier une).
 *
 * Ici, une seule mécanique : méthode de saisie, montant OU solde final, date, libellé, validation.
 * Ce qui change d'un geste à l'autre n'est plus que de la configuration.
 *
 * ── LE MONTANT REMIS À L'APPELANT EST SIGNÉ ─────────────────────────────────────────────────────
 * En méthode « Nouveau solde », il vaut `solde saisi − solde actuel` : c'est le sens de la variation
 * qui décide de la nature de l'opération (plus-value ou moins-value), et l'appelant seul sait quel
 * marqueur `investment_kind` y attacher.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Modal, Pressable, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import AppButton from '../ui/AppButton';
import CalendarWithPicker from '../transaction/CalendarWithPicker';
import { formatDateFrench, todayISO } from '../../lib/dateUtils';
import { sanitizeAmountInput, sanitizeSignedAmountInput } from '../../lib/ui/amountInput';
import { useAppColors } from '../../hooks/theme/useAppColors';

/** « Montant » : on saisit la variation. « Nouveau solde » : on la déduit du solde final. */
export type AmountMethod = 'amount' | 'balance';

export interface AccountAmountModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Couleur du bouton « Valider » et du calendrier — celle de la tuile qui a ouvert la modale. */
  accent: string;
  currencySymbol: string;
  /** Solde actuel du compte : indispensable à la méthode « Nouveau solde ». */
  currentBalance: number;
  /** Propose le choix « Montant / Nouveau solde ». Sans lui, on saisit toujours un montant. */
  withMethodPicker?: boolean;
  defaultMethod?: AmountMethod;
  /**
   * Bascule de SENS (plus-value / moins-value), en méthode « Montant » uniquement : en méthode
   * « Nouveau solde », le sens est déjà donné par la variation.
   */
  signToggle?: { positiveLabel: string; negativeLabel: string };
  amountLabel?: string;
  amountHint?: string;
  balanceHint?: string;
  /** Libellé de repli, selon le signe de l'opération (une moins-value ne se nomme pas « Apport »). */
  defaultNoteFor: (signedAmount: number) => string;
  /** Écrit l'opération. Une exception laisse la modale ouverte et affiche le message. */
  onSubmit: (op: { amount: number; date: string; note: string }) => Promise<void>;
}

export default function AccountAmountModal({
  visible, onClose, title, accent, currencySymbol, currentBalance,
  withMethodPicker = false, defaultMethod = 'amount', signToggle,
  amountLabel = 'Montant', amountHint, balanceHint,
  defaultNoteFor, onSubmit,
}: AccountAmountModalProps) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const [method, setMethod] = useState<AmountMethod>(defaultMethod);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [isNegative, setIsNegative] = useState(false);
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO());
  const [showCalendar, setShowCalendar] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Formulaire remis à neuf À CHAQUE OUVERTURE. La modale n'est jamais démontée (elle vit dans
     l'arbre de la fiche compte) : sans cette remise à zéro, elle rouvrait sur la saisie précédente
     — montant, date et méthode compris. */
  useEffect(() => {
    if (!visible) return;
    setMethod(defaultMethod);
    setShowMethodPicker(false);
    setIsNegative(false);
    setAmount('');
    setBalance('');
    setNote('');
    setDate(todayISO());
    setShowCalendar(false);
    setBusy(false);
  }, [visible, defaultMethod]);

  /** Variation SIGNÉE déduite de la saisie, ou `null` si le champ ne dit encore rien d'exploitable. */
  const signedAmount = useMemo((): number | null => {
    if (method === 'amount') {
      const n = parseFloat(amount.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return null;
      return isNegative ? -n : n;
    }
    const target = parseFloat(balance.replace(',', '.'));
    if (!Number.isFinite(target)) return null;
    const diff = target - currentBalance;
    // Au CENTIME près : retaper exactement le solde affiché laisse un résidu de l'ordre de 1e-13,
    // qui passerait pour une variation.
    return Math.abs(diff) < 0.005 ? 0 : diff;
  }, [method, amount, balance, isNegative, currentBalance]);

  const placeholderNote = defaultNoteFor(signedAmount ?? 0);

  async function submit() {
    if (signedAmount === null) {
      Alert.alert(
        method === 'amount' ? 'Montant invalide' : 'Solde invalide',
        method === 'amount' ? 'Saisis un montant positif.' : 'Saisis un solde final valide.',
      );
      return;
    }
    if (signedAmount === 0) {
      Alert.alert('Aucune variation', 'Le solde est identique au solde actuel.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ amount: signedAmount, date, note: note.trim() || defaultNoteFor(signedAmount) });
      onClose();
    } catch (e: unknown) {
      Alert.alert('Erreur', e instanceof Error ? e.message : "Impossible d'enregistrer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <KeyboardAwareOverlay style={styles.overlay}>
          <View style={styles.container}>
            <Text style={styles.title}>{title}</Text>

            {withMethodPicker && (
              <>
                <Text style={styles.sectionLabel}>Méthode de saisie</Text>
                <TouchableOpacity style={styles.dropdownField} onPress={() => setShowMethodPicker((v) => !v)} activeOpacity={0.8}>
                  <Text style={styles.dropdownText}>{method === 'amount' ? 'Montant' : 'Nouveau solde'}</Text>
                  <Ionicons name={showMethodPicker ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
                {showMethodPicker && (
                  <View style={styles.dropdownOptions}>
                    {(['amount', 'balance'] as AmountMethod[]).map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={styles.dropdownOption}
                        onPress={() => { setMethod(m); setShowMethodPicker(false); }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.dropdownOptionLabel}>{m === 'amount' ? 'Montant' : 'Nouveau solde'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            {method === 'amount' ? (
              <>
                {!!signToggle && (
                  <>
                    <Text style={styles.sectionLabel}>Type</Text>
                    <View style={styles.toggleRow}>
                      <TouchableOpacity
                        style={[styles.toggleBtn, !isNegative && styles.toggleBtnActive]}
                        onPress={() => setIsNegative(false)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.toggleLabel, !isNegative && styles.toggleLabelActive]}>{signToggle.positiveLabel}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.toggleBtn, isNegative && styles.toggleBtnActive]}
                        onPress={() => setIsNegative(true)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.toggleLabel, isNegative && styles.toggleLabelActive]}>{signToggle.negativeLabel}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                <Text style={styles.label}>{amountLabel}</Text>
                <TextInput
                  style={styles.input}
                  value={amount}
                  onChangeText={(v) => setAmount(sanitizeAmountInput(v))}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textSecondary}
                  autoFocus
                />
                {!!amountHint && <Text style={styles.helperText}>{amountHint}</Text>}
              </>
            ) : (
              <>
                <Text style={styles.label}>Solde actuel</Text>
                <View style={styles.readOnlyInput}>
                  <Text style={styles.readOnlyText}>
                    {currentBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbol}
                  </Text>
                </View>
                <Text style={styles.label}>Nouveau solde</Text>
                <TextInput
                  style={styles.input}
                  value={balance}
                  onChangeText={(v) => setBalance(sanitizeSignedAmountInput(v))}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textSecondary}
                  autoFocus
                />
                {!!balanceHint && <Text style={styles.helperText}>{balanceHint}</Text>}
              </>
            )}

            <Text style={styles.label}>Date</Text>
            <TouchableOpacity style={styles.dateField} onPress={() => setShowCalendar(true)} activeOpacity={0.8}>
              <Text style={styles.dateText}>{formatDateFrench(date)}</Text>
              <Ionicons name="calendar-outline" size={20} color={accent} />
            </TouchableOpacity>

            <Text style={styles.label}>Libellé (optionnel)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder={placeholderNote}
              placeholderTextColor={COLORS.textSecondary}
            />

            {/* Teinté par le type de compte (`accent`), comme le reste de la modale. L'encre du
                libellé était en `#000` : illisible dès que la teinte devenait sombre. */}
            <View style={styles.actions}>
              <AppButton label="Annuler" variant="secondary" size="lg" full onPress={onClose} />
              <AppButton label="Valider" size="lg" full tone={accent} loading={busy} onPress={submit} />
            </View>
          </View>
        </KeyboardAwareOverlay>
      </Modal>

      {/* Calendrier — un seul, celui de CE formulaire (il y en avait un par geste). */}
      <Modal visible={visible && showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowCalendar(false)}>
          <Pressable style={[styles.container, { padding: 8 }]} onPress={() => {}}>
            <View style={styles.calendarHeader}>
              <Text style={styles.title}>Date</Text>
              <TouchableOpacity onPress={() => setShowCalendar(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: accent }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            <CalendarWithPicker
              current={date}
              maxDate={todayISO()}
              onDayPress={(day: any) => { setDate(day.dateString); setShowCalendar(false); }}
              markedDates={{ [date]: { selected: true, selectedColor: accent, selectedTextColor: '#000' } }}
              accentColor={accent}
              bgColor={COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor={COLORS.textSecondary}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    container: {
      width: '100%', maxWidth: 380, backgroundColor: c.cardSolid,
      borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, padding: 24,
    },
    title: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 20, textAlign: 'center' },
    label: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 10 },
    input: {
      backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
      color: c.text, fontSize: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
    },
    readOnlyInput: {
      backgroundColor: c.cardBorder, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
      paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16, opacity: 0.7,
    },
    readOnlyText: { fontSize: 16, color: c.textSecondary },
    dateField: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder,
      paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
    },
    dateText: { color: c.text, fontSize: 16 },
    helperText: { color: c.textSecondary, fontSize: 12, marginTop: -8, marginBottom: 12 },
    toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
    toggleBtn: {
      flex: 1, backgroundColor: c.bg, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      paddingVertical: 12, alignItems: 'center',
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
    },
    toggleBtnActive: { backgroundColor: c.emerald + '1F', borderColor: c.emerald },
    toggleLabel: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
    toggleLabelActive: { color: c.emerald },
    dropdownField: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.bg, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
    },
    dropdownText: { color: c.text, fontSize: 15, fontWeight: '600' },
    dropdownOptions: {
      backgroundColor: c.bg, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder,
      marginBottom: 18, overflow: 'hidden',
    },
    dropdownOption: { paddingVertical: 14, paddingHorizontal: 14 },
    dropdownOptionLabel: { color: c.text, fontSize: 15 },
    calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
    actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    // Boutons : `components/ui/AppButton`.
  });
}
