/**
 * « Ton Relyka a été recalculé » — la CONSÉQUENCE d'un changement de référence des dépenses
 * variables, annoncée franchement plutôt que noyée derrière la modale de détail.
 *
 * Extraite de `app/(tabs)/pilotage.tsx` à l'identique : mêmes textes, mêmes seuils, et toujours
 * aucune croix de fermeture — on sort par « Compris », c'est un acquittement, pas une info à balayer.
 */
import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PilotageModalShell from './PilotageModalShell';
import { CURRENCY_SYMBOL } from '../../lib/finance/currency';
import type { AppColors } from '../../theme/palette';

export interface RelykaShift { before: number; after: number }

interface Props {
  /** `null` = rien à annoncer. Porte les deux montants encadrant le recalcul. */
  shift: RelykaShift | null;
  onClose: () => void;
  colors: AppColors;
}

export default function RelykaShiftModal({ shift, onClose, colors }: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const money = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} ${CURRENCY_SYMBOL}`;

  return (
    <PilotageModalShell
      visible={!!shift}
      title="Ton Relyka a été recalculé"
      onClose={onClose}
      colors={colors}
      showClose={false}
      boxStyle={{ gap: 10 }}
    >
      <View style={styles.relykaShiftRow}>
        <Text style={styles.relykaShiftOld}>{money(shift?.before ?? 0)}</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.textSecondary} />
        <Text style={styles.relykaShiftNew}>{money(shift?.after ?? 0)}</Text>
      </View>
      <Text style={[styles.detailNote, { textAlign: 'center', marginTop: 8 }]}>
        {(shift && shift.after === shift.before)
          ? 'Même montant : cette référence donnait déjà le même budget variable.'
          : (shift && shift.after > shift.before)
            ? 'Ta nouvelle référence prévoit moins de dépenses variables : il te reste donc plus à décider ce mois-ci.'
            : 'Ta nouvelle référence prévoit plus de dépenses variables : Relyka met davantage de côté pour elles.'}
      </Text>
      <TouchableOpacity style={styles.varModeSave} onPress={onClose} activeOpacity={0.85}>
        <Text style={styles.varModeSaveText}>Compris</Text>
      </TouchableOpacity>
    </PilotageModalShell>
  );
}

/* Règles RECOPIÉES À L'IDENTIQUE depuis pilotage.tsx : un déplacement ne doit rien changer au
   rendu, pas même d'un point de taille. */
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    relykaShiftRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 },
    relykaShiftOld: { fontSize: 15, color: c.textSecondary, textDecorationLine: 'line-through' },
    relykaShiftNew: { fontSize: 26, fontWeight: '800', color: c.emerald },
    detailNote: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginBottom: 4 },
    varModeSave: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14,
    },
    varModeSaveText: { fontSize: 13, fontWeight: '800', color: c.bg },
  });
}
