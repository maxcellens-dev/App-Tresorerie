/**
 * « Montants réservés » — le détail de tout ce qui est mis de côté sans avoir quitté le compte
 * courant : le conservé du mois, les cumuls manuels (pré-épargne / pré-invest) et le réservé par
 * projet. Chaque ligne est une PORTE : elle mène au geste qui la modifie ou la libère.
 *
 * Extraite de `app/(tabs)/pilotage.tsx` à l'identique.
 *
 * ⚠️ Les cumuls manuels restent affichés MÊME À ZÉRO : c'est par eux qu'on saisit un montant la
 * première fois. Les masquer quand ils sont vides rendrait la fonction inatteignable.
 */
import { useMemo } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AppColors } from '../../theme/palette';
import type { PreSavingType } from '../../types/database';

/** Une ligne « réservé par projet », telle que le moteur la fournit. */
export interface ReservedProject {
  id: string;
  name: string;
  total: number;
  source_account_id: string | null;
  linked_account_id: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  colors: AppColors;
  /** Total conservé sur le compte courant ce mois-ci. */
  reservationsTotal: number;
  preEpargneTotal: number;
  preInvestTotal: number;
  reservedByProject: ReservedProject[];
  /** Formatteur de montant de l'écran, passé tel quel pour un rendu identique. */
  fmtMain: (n: number) => string;
  /** Ouvre la saisie du conservé, pré-remplie au total courant. */
  onEditConserve: (prefill: string) => void;
  /** Ouvre la modale d'un cumul manuel (ajout / remise à zéro / virement). */
  onOpenPreSaving: (type: PreSavingType) => void;
  /** Libère le conservé du mois (remet à 0). */
  onReleaseConserve: () => void;
  /** Libère le réservé d'un projet. */
  onReleaseProject: (projectId: string) => void;
  /** Crée un virement depuis un projet réservé. */
  onTransferProject: (project: ReservedProject) => void;
}

export default function ReservedModal({
  visible, onClose, colors, reservationsTotal, preEpargneTotal, preInvestTotal,
  reservedByProject, fmtMain, onEditConserve, onOpenPreSaving,
  onReleaseConserve, onReleaseProject, onTransferProject,
}: Props) {
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cumuls = [
    { type: 'epargne' as PreSavingType, label: 'Pré-épargne', total: preEpargneTotal, icon: 'shield-outline', color: colors.green },
    { type: 'invest' as PreSavingType, label: 'Pré-invest', total: preInvestTotal, icon: 'trending-up-outline', color: colors.violet },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.reservedOverlay} onPress={onClose}>
        <Pressable style={styles.reservedSheet} onPress={() => {}}>
          <View style={styles.reservedHeader}>
            <Text style={styles.reservedTitle}>Montants réservés</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {/* Conservé du mois — tap → saisie manuelle (0 pour libérer). */}
            <Text style={styles.reservedSectionLabel}>Conservé ce mois</Text>
            <TouchableOpacity
              style={styles.reservedItem}
              activeOpacity={0.7}
              onPress={() => onEditConserve(reservationsTotal > 0 ? String(Math.round(reservationsTotal)) : '')}
            >
              <View style={[styles.reservedItemIcon, { backgroundColor: colors.blue + '22' }]}>
                <Ionicons name="hourglass-outline" size={16} color={colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reservedItemName}>Conservé sur le compte courant</Text>
                <Text style={styles.reservedItemHint}>
                  {reservationsTotal > 0 ? 'Se réinitialise chaque mois · appuyez pour modifier' : 'Appuyez pour conserver un montant'}
                </Text>
              </View>
              <Text style={[styles.reservedItemAmount, { color: reservationsTotal > 0 ? colors.blue : colors.textSecondary }]}>{fmtMain(reservationsTotal)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ marginLeft: 6 }} />
            </TouchableOpacity>
            {reservationsTotal > 0 && (
              <View style={styles.reservedActions}>
                <TouchableOpacity style={styles.reservedReleaseBtn} activeOpacity={0.7} onPress={onReleaseConserve} accessibilityRole="button">
                  <Ionicons name="lock-open-outline" size={14} color={colors.danger} />
                  <Text style={styles.reservedReleaseText}>Libérer</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Cumuls manuels — TOUJOURS visibles (même à 0) pour permettre la saisie. */}
            <Text style={styles.reservedSectionLabel}>Cumuls (saisie manuelle)</Text>
            {cumuls.map((c) => (
              <TouchableOpacity
                key={c.type}
                style={styles.reservedItem}
                activeOpacity={0.7}
                onPress={() => onOpenPreSaving(c.type)}
              >
                <View style={[styles.reservedItemIcon, { backgroundColor: c.color + '22' }]}>
                  <Ionicons name={c.icon as any} size={16} color={c.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reservedItemName}>{c.label}</Text>
                  <Text style={styles.reservedItemHint}>
                    {c.total > 0 ? 'En attente de virement · appuyez pour gérer' : 'Appuyez pour ajouter un montant'}
                  </Text>
                </View>
                <Text style={[styles.reservedItemAmount, { color: c.total > 0 ? c.color : colors.textSecondary }]}>{fmtMain(c.total)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            ))}

            {/* Réservé par projet */}
            {reservedByProject.map((r) => (
              <View key={r.id} style={styles.reservedProjectBlock}>
                <View style={styles.reservedItem}>
                  <View style={[styles.reservedItemIcon, { backgroundColor: colors.blue + '22' }]}>
                    <Ionicons name="bookmark" size={16} color={colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reservedItemName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.reservedItemHint}>Projet · réservé jusqu'à utilisation</Text>
                  </View>
                  <Text style={[styles.reservedItemAmount, { color: colors.blue }]}>{fmtMain(r.total)}</Text>
                </View>
                <View style={styles.reservedActions}>
                  <TouchableOpacity style={styles.reservedReleaseBtn} activeOpacity={0.7} onPress={() => onReleaseProject(r.id)} accessibilityRole="button">
                    <Ionicons name="lock-open-outline" size={14} color={colors.danger} />
                    <Text style={styles.reservedReleaseText}>Libérer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reservedTransferBtn} activeOpacity={0.7} onPress={() => onTransferProject(r)} accessibilityRole="button">
                    <Ionicons name="swap-horizontal" size={14} color={colors.green} />
                    <Text style={styles.reservedTransferText}>Créer un virement</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Règles recopiées à l'identique depuis pilotage.tsx. */
function makeStyles(c: AppColors) {
  return StyleSheet.create({
    reservedOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    reservedSheet: {
      width: '100%', maxWidth: 460, backgroundColor: c.bg, borderRadius: 20,
      padding: 18, borderWidth: 1, borderColor: c.cardBorder, gap: 8,
    },
    reservedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    reservedTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    reservedSectionLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
    reservedItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    reservedItemIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    reservedItemName: { fontSize: 14, fontWeight: '700', color: c.text },
    reservedItemHint: { fontSize: 11, color: c.textSecondary, marginTop: 1 },
    reservedItemAmount: { fontSize: 15, fontWeight: '800' },
    reservedProjectBlock: {
      borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14,
      paddingHorizontal: 12, marginTop: 8, backgroundColor: c.card,
    },
    reservedActions: { flexDirection: 'row', gap: 8, paddingBottom: 12, paddingTop: 2 },
    reservedReleaseBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
      borderWidth: 1, borderColor: c.danger + '44', backgroundColor: c.danger + '12',
    },
    reservedReleaseText: { fontSize: 12, fontWeight: '700', color: c.danger },
    reservedTransferBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10,
      borderWidth: 1, borderColor: c.green + '44', backgroundColor: c.green + '12',
    },
    reservedTransferText: { fontSize: 12, fontWeight: '700', color: c.green },
  });
}
