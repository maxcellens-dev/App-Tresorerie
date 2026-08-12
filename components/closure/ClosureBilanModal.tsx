/**
 * Pop-up de BILAN, affichée une fois après la clôture d'un mois.
 *
 * C'est la troisième responsabilité que portait `MonthlyClosure` — après la bannière et le
 * formulaire de clôture. Elle n'a rien à voir avec les deux autres : elle ne saisit rien, ne
 * calcule rien, et ne s'affiche qu'APRÈS coup, une seule fois.
 *
 * ⚠️ Masquée en consultation admin (« connecté en tant que ») : l'afficher consommerait le bilan du
 * compte cible, qui ne le verrait alors jamais. C'est l'appelant qui tient cette règle, via
 * `visible` — elle est trop facile à perdre pour être laissée implicite.
 */
import { useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  /** Reliquat d'enveloppe du mois clôturé. À 0 ou moins, on félicite quand même — sans le montant. */
  surplus: number;
  /** Montant formaté en devise (l'appelant tient le format de l'écran). */
  formatAmount: (n: number) => string;
  onClose: () => void;
  colors: AppColors;
}

export default function ClosureBilanModal({ visible, surplus, formatAmount, onClose, colors }: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.bilanOverlay}>
        <View style={styles.bilanCard}>
          {surplus > 0 ? (
            <>
              <Text style={styles.bilanEmoji}>💰</Text>
              <Text style={styles.bilanTitle}>Félicitations !</Text>
              <Text style={styles.bilanText}>
                Il te restait <Text style={{ color: colors.green, fontWeight: '800' }}>{formatAmount(surplus)}</Text> sur ton enveloppe le mois dernier. Tes recommandations ont été mises à jour pour intégrer ce surplus.
              </Text>
            </>
          ) : (
            <>
              <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.emerald} />
              <Text style={styles.bilanTitle}>Période clôturée</Text>
              <Text style={styles.bilanText}>Ton mois est figé. Place au mois en cours !</Text>
            </>
          )}
          <TouchableOpacity style={styles.bilanBtn} onPress={onClose} accessibilityRole="button">
            <Text style={styles.bilanBtnText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    bilanOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 28 },
    bilanCard: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: c.cardBorder, padding: 28, alignItems: 'center', gap: 12 },
    bilanEmoji: { fontSize: 52 },
    bilanTitle: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'center' },
    bilanText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },
    bilanBtn: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 40, marginTop: 8 },
    bilanBtnText: { fontSize: 15, fontWeight: '700', color: c.bg },
  });
}
