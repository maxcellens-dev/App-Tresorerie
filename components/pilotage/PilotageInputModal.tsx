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
import React, { useEffect, useMemo, useRef } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import type { AppColors } from '../../theme/palette';
import KeyboardAwareOverlay from '../layout/KeyboardAwareOverlay';
import AppButton from '../ui/AppButton';
// Règle de saisie PARTAGÉE par tous les champs de montant de l'app (cf. lib/ui/amountInput).
import { sanitizeAmountInput } from '../../lib/ui/amountInput';

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

  /* ── VERROU SYNCHRONE contre la double soumission ────────────────────────────────────────────────
     « Conserver ce mois » n'est PAS idempotent : la mutation efface les réservations du mois puis en
     réinsère une. Deux taps rapprochés lancent deux effacements suivis de deux insertions — et le
     montant « Réservé » se retrouve doublé, alors qu'il est DÉDUIT du Relyka. Fermer la modale ne
     protège pas : `visible` est un état React, il ne prend effet qu'au rendu SUIVANT, et le second
     tap passe avant. Une référence, elle, se pose immédiatement (cf. hooks/useSubmitLock).
     Remise à zéro à chaque ouverture : la modale sert plusieurs fois par session. */
  const fired = useRef(false);
  useEffect(() => { if (visible) fired.current = false; }, [visible]);
  const saveOnce = () => {
    if (fired.current) return;
    fired.current = true;
    onSave();
  };

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
              /* Chiffres et UN SEUL séparateur décimal, au plus deux décimales.
                 Le filtre se contentait de retirer les caractères non numériques, ce qui laissait
                 passer plusieurs séparateurs — et les appelants lisent la valeur avec
                 `parseFloat(v.replace(',', '.'))`, qui ne remplace que la PREMIÈRE virgule. Saisir
                 « 1.234,56 » (séparateur de milliers, courant) affichait donc 1.234,56 à l'écran et
                 enregistrait 1,23 €, sans le moindre signal. Ce que le champ MONTRE est désormais
                 exactement ce qui sera lu — une valeur mal tapée reste visible, donc corrigeable. */
              onChangeText={(v) => onChangeValue(sanitizeAmountInput(v))}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              autoFocus
            />
            <Text style={s.varModalUnit} numberOfLines={1}>{unit}</Text>
          </View>
          {children}
          {/* « Annuler » à GAUCHE et en creux, l'action à droite et pleine : l'ordre et le poids
              sont les mêmes dans tous les modaux de l'app (cf. components/ui/AppButton). */}
          <View style={s.varModalActions}>
            {canCancel && <AppButton label="Annuler" variant="secondary" size="lg" full onPress={onCancel} />}
            <AppButton label={saveLabel} size="lg" full disabled={saveDisabled} onPress={saveOnce} />
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
    // Boutons du modal : `components/ui/AppButton`.
  });
}
