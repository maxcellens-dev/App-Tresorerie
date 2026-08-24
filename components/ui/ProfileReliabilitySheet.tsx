/**
 * FICHE « SUR QUOI TON PROFIL REPOSE » — le détail de la fiabilité, à la demande.
 *
 * L'information tenait dans une carte pleine largeur sous le profil : trois lignes de manques et
 * leurs gestes, en permanence, pour quelque chose qu'on consulte une fois. Elle poussait le contenu
 * utile — la répartition, les mesures — sous la ligne de flottaison.
 *
 * Elle vit donc ici, derrière un point d'exclamation posé sur la carte du profil : le NIVEAU reste
 * visible en un mot (c'est ce qui compte au quotidien), le DÉTAIL s'ouvre quand on se demande
 * pourquoi. Rien n'est caché — c'est la même information, au bon moment.
 *
 * Chaque manque garde sa règle d'écriture : jamais un constat nu, toujours le geste qui le lève,
 * et l'écran où le faire (cf. lib/finance/profileReliability).
 */
import { useMemo } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { sheetWidth } from '../../lib/ui/appLayout';
import type { ProfileReliability } from '../../lib/finance/profileReliability';

interface Props {
  reliability: ProfileReliability;
  onClose: () => void;
  /** Ouverture de l'écran où un manque se comble. Absent = les manques ne sont pas cliquables. */
  onNavigate?: (route: string) => void;
}

export default function ProfileReliabilitySheet({ reliability, onClose, onNavigate }: Props) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);

  const tone = reliability.tone === 'good' ? (COLORS.green ?? COLORS.emerald)
    : reliability.tone === 'warn' ? COLORS.orange : COLORS.danger;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: tone + '1F', borderColor: tone + '4D' }]}>
              <Ionicons name="pulse-outline" size={20} color={tone} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: tone }]} numberOfLines={1}>{reliability.title}</Text>
              <Text style={styles.subtitle}>Sur quoi ton profil repose</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={{ padding: 2 }} accessibilityLabel="Fermer">
              <Ionicons name="close" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.summary}>{reliability.summary}</Text>

          {/* Ce que le classement ne peut pas savoir — et le geste qui le lui apprend. */}
          {reliability.gaps.length > 0 && (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {reliability.gaps.map((gap) => {
                const clickable = !!gap.route && !!onNavigate;
                return (
                  <TouchableOpacity
                    key={gap.id}
                    style={styles.gapRow}
                    activeOpacity={clickable ? 0.7 : 1}
                    disabled={!clickable}
                    accessibilityRole={clickable ? 'button' : undefined}
                    onPress={() => { if (gap.route && onNavigate) { onClose(); onNavigate(gap.route); } }}
                  >
                    <Ionicons
                      name={gap.severity === 'blocking' ? 'alert-circle-outline' : 'information-circle-outline'}
                      size={16}
                      color={gap.severity === 'blocking' ? COLORS.orange : COLORS.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.gapLabel}>{gap.label}</Text>
                      <Text style={styles.gapAction}>{gap.action}</Text>
                    </View>
                    {clickable && <Ionicons name="chevron-forward" size={15} color={COLORS.textSecondary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* LA PHRASE QUI DÉSAMORCE. « Incomplet » se lit comme un reproche tant qu'on n'a pas dit
              que le palier, lui, reste calculé et utilisable. */}
          <Text style={styles.footNote}>
            Ton profil est calculé quoi qu’il arrive : ces éléments le rendent seulement plus juste.
          </Text>

          <TouchableOpacity style={[styles.btn, { backgroundColor: tone }]} onPress={onClose} activeOpacity={0.85}>
            <Text style={[styles.btnLabel, { color: COLORS.bg }]}>J’ai compris</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    overlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    },
    card: {
      ...sheetWidth, maxWidth: 400,
      backgroundColor: c.cardSolid, borderRadius: 24,
      borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    title: { fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
    subtitle: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    summary: { fontSize: 14, lineHeight: 20, color: c.text },

    // Hauteur bornée : au-delà de quatre manques, la fiche sortirait de l'écran sans qu'on puisse
    // la refermer.
    list: { maxHeight: 260 },
    gapRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.cardBorder,
    },
    gapLabel: { fontSize: 13.5, fontWeight: '600', color: c.text },
    gapAction: { fontSize: 12, color: c.textSecondary, lineHeight: 17, marginTop: 2 },

    footNote: { fontSize: 11.5, color: c.textSecondary, lineHeight: 16.5, fontStyle: 'italic' },
    btn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 2 },
    btnLabel: { fontSize: 15, fontWeight: '800' },
  });
}
