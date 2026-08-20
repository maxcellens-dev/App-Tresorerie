/**
 * Pop-up de BILAN, affichée une fois après la clôture d'un mois — UNIQUEMENT si elle a un montant
 * à annoncer.
 *
 * ⚠️ Elle avait une seconde variante, sans montant : « Période clôturée — ton mois est figé ». Elle
 * n'apprenait rien (la modale de clôture venait de se fermer, le mois avait changé de liste sous
 * les yeux de l'utilisateur) et surgissait au pire moment : rendue depuis le Pilotage, un `<Modal>`
 * vit dans sa PROPRE FENÊTRE et passe donc au-dessus de n'importe quel écran ouvert par-dessus —
 * y compris l'écran Clôture, où elle semblait commenter la réouverture qu'on venait de faire.
 * Une confirmation qui n'ajoute rien à ce que l'écran montre déjà n'a pas lieu d'être.
 *
 * Il ne reste donc que le cas qui dit quelque chose : « il te restait X € sur ton enveloppe ».
 *
 * ⚠️ Masquée en consultation admin (« connecté en tant que ») : l'afficher consommerait le bilan du
 * compte cible, qui ne le verrait alors jamais. C'est l'appelant qui tient cette règle, via
 * `visible` — elle est trop facile à perdre pour être laissée implicite.
 */
import { useMemo } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import type { AppColors } from '../../theme/palette';

interface Props {
  visible: boolean;
  /** Reliquat d'enveloppe du mois clôturé. Strictement positif — sinon la pop-up ne s'affiche pas. */
  surplus: number;
  /** Montant formaté en devise (l'appelant tient le format de l'écran). */
  formatAmount: (n: number) => string;
  onClose: () => void;
  colors: AppColors;
}

export default function ClosureBilanModal({ visible, surplus, formatAmount, onClose, colors }: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible && surplus > 0} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.bilanOverlay}>
        <View style={styles.bilanCard}>
          <Text style={styles.bilanEmoji}>💰</Text>
          <Text style={styles.bilanTitle}>Félicitations !</Text>
          <Text style={styles.bilanText}>
            Il te restait <Text style={{ color: colors.green, fontWeight: '800' }}>{formatAmount(surplus)}</Text> sur ton enveloppe le mois dernier. Tes recommandations ont été mises à jour pour intégrer ce surplus.
          </Text>
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
