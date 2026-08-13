/**
 * Coquille des modales de SAISIE D'UN MONTANT du Pilotage : « Conserver ce mois »,
 * « Dépenses variables », « Marge de sécurité ». Toutes trois posaient le même gabarit —
 * voile, boîte, titre, explication, champ + unité, rangée Annuler / Enregistrer.
 *
 * ⚠️ `canCancel` n'est PAS un détail d'ergonomie. Les étapes 3 et 4 du parcours de démarrage se
 * jouent dans deux de ces modales : elles doivent alors se terminer par une valeur enregistrée,
 * jamais par un abandon. À `false`, le bouton « Annuler » disparaît, le tap sur le voile ne ferme
 * plus et le retour matériel non plus. Perdre cette règle rendrait l'étape contournable, donc le
 * profil financier incalculable.
 */
import React, { useMemo } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import type { AppColors } from '../../theme/palette';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';

interface Props {
  visible: boolean;
  title: string;
  /** Texte d'explication sous le titre. */
  hint: React.ReactNode;
  value: string;
  onChangeValue: (v: string) => void;
  /** Unité affichée à droite du champ (symbole de devise, « / semaine »…). */
  unit: string;
  onSave: () => void;
  onCancel: () => void;
  /** `false` pendant une étape OBLIGATOIRE du parcours de démarrage (cf. avertissement ci-dessus). */
  canCancel?: boolean;
  /** Désactive « Enregistrer » tant que la saisie n'est pas exploitable. */
  saveDisabled?: boolean;
  saveLabel?: string;
  colors: AppColors;
  /** Contenu libre inséré entre le champ et les boutons (équivalent mensuel, sélecteur de mode…). */
  children?: React.ReactNode;
}

export default function PilotageInputModal({
  visible, title, hint, value, onChangeValue, unit, onSave, onCancel,
  canCancel = true, saveDisabled = false, saveLabel = 'Enregistrer', colors, children,
}: Props) {
  const s = useMemo(() => makeStyles(colors), [colors]);
  const dismiss = () => { if (canCancel) onCancel(); };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <KeyboardAwareOverlay style={s.varModalOverlay} onBackdropPress={dismiss}>
        <Pressable style={s.varModalBox} onPress={() => {}}>
          <Text style={s.varModalTitle}>{title}</Text>
          <Text style={s.varModalHint}>{hint}</Text>
          <View style={s.varModalInputRow}>
            <TextInput
              style={s.varModalInput}
              value={value}
              // Chiffres, point et virgule uniquement : le clavier décimal laisse passer autre chose
              // selon les claviers tiers, et un `parseFloat` sur du texte rend NaN.
              onChangeText={(v) => onChangeValue(v.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              autoFocus
            />
            <Text style={s.varModalUnit} numberOfLines={1}>{unit}</Text>
          </View>
          {children}
          <View style={s.varModalActions}>
            {canCancel && (
              <TouchableOpacity style={s.varModalCancel} onPress={onCancel} accessibilityRole="button">
                <Text style={s.varModalCancelText}>Annuler</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.varModalSave, saveDisabled && { opacity: 0.45 }]}
              onPress={onSave}
              disabled={saveDisabled}
              accessibilityRole="button"
            >
              <Text style={s.varModalSaveText}>{saveLabel}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </KeyboardAwareOverlay>
    </Modal>
  );
}

/** Règles recopiées à l'identique depuis pilotage.tsx (déplacement sans changement de rendu). */
export function makeStyles(c: AppColors) {
  return StyleSheet.create({
    varModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    varModalBox: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22 },
    varModalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 8 },
    varModalHint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 18 },
    varModalInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    varModalInput: {
      flexGrow: 0, flexShrink: 1, width: 150, maxWidth: '60%',
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, fontSize: 20, fontWeight: '700', color: c.text,
    },
    varModalUnit: { fontSize: 14, color: c.textSecondary, fontWeight: '600', flexShrink: 0 },
    varModalActions: { flexDirection: 'row', gap: 12, marginTop: 22 },
    varModalCancel: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    varModalCancelText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
    varModalSave: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center' },
    varModalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  });
}
