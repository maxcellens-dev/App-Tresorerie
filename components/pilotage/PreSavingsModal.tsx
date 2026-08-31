/**
 * Modale de pré-épargne / pré-investissement (action « Cumuler »).
 * Permet d'accumuler mentalement un montant (déduit du reste disponible) puis,
 * le moment venu, de créer un virement global du total cumulé.
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TextInput, TouchableOpacity, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AppButton from '../ui/AppButton';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { PreSavingType } from '../../types/database';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import { sanitizeAmountInput } from '../../lib/ui/amountInput';

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
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const [montant, setMontant] = useState('');

  /* VERROU SYNCHRONE contre la double soumission.
     `onSave` déclenche `useAddPreSavingEntry`, qui n'est PAS idempotent : il AJOUTE une entrée et
     INCRÉMENTE le total cumulé. La fermeture de la modale, elle, passe par un état React — elle ne
     prend effet qu'au rendu suivant. Deux taps rapprochés sur « Enregistrer » passaient donc tous
     les deux, et le montant était cumulé DEUX FOIS (or ce cumul est déduit du Relyka).
     Une référence se pose immédiatement, avant le prochain rendu. Même parade que l'écran de saisie
     d'une dépense partagée. */
  const fired = useRef(false);

  useEffect(() => {
    if (visible) { setMontant(recoAmount > 0 ? String(Math.round(recoAmount)) : ''); fired.current = false; }
  }, [visible, recoAmount]);

  /** N'exécute l'action qu'UNE fois par ouverture (les trois boutons ferment ou naviguent). */
  const once = (fn: () => void) => () => {
    if (fired.current) return;
    fired.current = true;
    fn();
  };

  const saisi = num(montant);
  const nouveauTotal = total + saisi;
  /* MÊME règle que le moteur (`enDepassement`, lib/finance/pilotageView) : `base > 0` en fait
     partie. Sans cette condition, un utilisateur dont le reste disponible n'est pas encore calculé
     (compte neuf, base à 0) voyait « ce cumul dépasse ton reste disponible (0 €) » dès le premier
     euro — alors que le tableau de bord, lui, ne signalait aucun dépassement. Deux réponses
     opposées à la même question, à deux endroits de la même page. */
  const depasse = base > 0 && nouveauTotal > base;
  const isEpargne = type === 'epargne';
  const titre = isEpargne ? 'Pré-épargne' : 'Pré-investissement';
  // Violet du THÈME : la valeur en dur était celle du thème sombre, figée en mode clair.
  const accent = isEpargne ? COLORS.green : COLORS.violet;

  function confirmReset() {
    // Confirmation in-app (§7) — plus de window.confirm navigateur.
    Alert.alert('Remettre à 0', 'Remettre le cumul à 0 ? Aucun virement ne sera créé.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Remettre à 0', style: 'destructive', onPress: onReset },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAwareOverlay style={styles.overlay} onBackdropPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name={isEpargne ? 'shield-outline' : 'trending-up-outline'} size={20} color={accent} />
              <Text style={styles.title}>{titre}</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Accumule un montant à mettre de côté. Il est déduit de ton « Budget libre à allouer » tant que tu n'as pas fait le virement.
          </Text>

          <Text style={styles.label}>Montant à ajouter</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={montant}
              onChangeText={(t) => setMontant(sanitizeAmountInput(t))}
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
              <Ionicons name="warning-outline" size={15} color={COLORS.danger} />
              <Text style={styles.warnText}>
                Ce cumul dépasse ton reste disponible ({Math.round(base).toLocaleString('fr-FR')} {CURRENCY_SYMBOL}).
              </Text>
            </View>
          )}

          {/* Boutons — teintés par le DOMAINE (vert épargne / violet investissement), qui a déjà
              sa couleur partout ailleurs dans l'app. L'encre du libellé est déduite de cette
              teinte : elle était écrite en dur (`#06281f`), donc illisible dès que l'accent
              changeait. */}
          <AppButton
            label="Enregistrer"
            size="lg"
            tone={accent}
            disabled={saisi <= 0}
            onPress={once(() => { if (saisi > 0) onSave(saisi); })}
            style={{ marginTop: 4 }}
          />
          <AppButton
            label={`Créer le virement global (${Math.round(nouveauTotal).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL})`}
            variant="secondary"
            icon="swap-horizontal"
            tone={accent}
            disabled={nouveauTotal <= 0}
            onPress={once(() => onCreateTransfer(nouveauTotal))}
            style={{ marginTop: 8 }}
          />

          {total > 0 && (
            <TouchableOpacity style={styles.resetBtn} onPress={confirmReset}>
              <Ionicons name="lock-open-outline" size={14} color={COLORS.danger} />
              <Text style={styles.resetLabel}>Remettre à 0</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </KeyboardAwareOverlay>
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
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      borderRadius: 12, paddingVertical: 13, borderWidth: 1,
    },
    secondaryLabel: { fontSize: 13, fontWeight: '700' },
    resetBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      alignSelf: 'center', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10,
      borderWidth: 1, borderColor: c.danger + '44', backgroundColor: c.danger + '12',
    },
    resetLabel: { fontSize: 12, color: c.danger, fontWeight: '700' },
  });
}
