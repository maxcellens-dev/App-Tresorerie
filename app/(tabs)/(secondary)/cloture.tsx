import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import ScreenGradient from '../../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { useAuth } from '../../../contexts/AuthContext';
import { useMonthlyClosure, monthLabel } from '../../../hooks/useMonthlyClosure';

export default function ClotureScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { enabled, closures, pendingMonths, closeMonths, reopenMonth } = useMonthlyClosure(user?.id);

  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void } | null>(null);
  const askConfirm = (opts: { title: string; message: string; confirmLabel: string; confirmColor: string; onConfirm: () => void }) => setConfirmModal(opts);

  const closedSorted = [...closures].sort((a, b) => b.month_key.localeCompare(a.month_key));
  const pendingDesc = [...pendingMonths].sort((a, b) => b.localeCompare(a)); // plus récent en haut

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <View style={styles.pageHeader}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={COLORS.text} />
            <Text style={{ color: COLORS.text, marginLeft: 4, fontSize: 14, fontWeight: '600' }}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Clôture mensuelle</Text>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {!enabled ? (
            <Text style={styles.subtitle}>La clôture mensuelle n'est pas activée.</Text>
          ) : (
            <>
              <Text style={styles.subtitle}>Rouvrez une période pour pouvoir y saisir/modifier des transactions, ou clôturez un mois en attente.</Text>

              <Text style={styles.sectionTitle}>Mois en attente</Text>
              <View style={styles.card}>
                {pendingDesc.length === 0 ? (
                  <Text style={styles.empty}>Aucun mois en attente.</Text>
                ) : (
                  pendingDesc.map((mk) => (
                    <View key={mk} style={styles.row}>
                      <Ionicons name="hourglass-outline" size={18} color={COLORS.yellow} />
                      <Text style={styles.rowLabel}>{monthLabel(mk)}</Text>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => askConfirm({ title: 'Clôturer le mois', message: `Clôturer ${monthLabel(mk)} ? Les transactions de cette période seront verrouillées.`, confirmLabel: 'Clôturer', confirmColor: COLORS.emerald, onConfirm: () => closeMonths.mutate({ monthKeys: [mk], surplus: 0 }) })}
                      >
                        <Ionicons name="lock-closed-outline" size={14} color={COLORS.emerald} />
                        <Text style={[styles.actionText, { color: COLORS.emerald }]}>Clôturer</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>

              <Text style={styles.sectionTitle}>Mois clôturés</Text>
              <View style={styles.card}>
                {closedSorted.length === 0 ? (
                  <Text style={styles.empty}>Aucun mois clôturé.</Text>
                ) : (
                  closedSorted.map((c) => (
                    <View key={c.month_key} style={styles.row}>
                      <Ionicons name="lock-closed" size={18} color={COLORS.textSecondary} />
                      <Text style={styles.rowLabel}>{monthLabel(c.month_key)}</Text>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => askConfirm({ title: 'Rouvrir le mois', message: `Rouvrir ${monthLabel(c.month_key)} ? Vous pourrez de nouveau modifier ses transactions.`, confirmLabel: 'Rouvrir', confirmColor: COLORS.blue, onConfirm: () => reopenMonth.mutate(c.month_key) })}
                      >
                        <Ionicons name="lock-open-outline" size={14} color={COLORS.blue} />
                        <Text style={[styles.actionText, { color: COLORS.blue }]}>Rouvrir</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
              <Text style={styles.note}>Astuce : pour clôturer avec saisie de votre solde réel, utilisez la bannière de clôture sur le Pilotage.</Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Confirmation in-app */}
      <Modal visible={!!confirmModal} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setConfirmModal(null)}>
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setConfirmModal(null)}>
          <TouchableOpacity style={styles.confirmBox} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.confirmTitle}>{confirmModal?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmModal?.message}</Text>
            <View style={styles.confirmBtns}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setConfirmModal(null)}>
                <Text style={styles.confirmCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmOk, { borderColor: confirmModal?.confirmColor ?? COLORS.emerald, backgroundColor: (confirmModal?.confirmColor ?? COLORS.emerald) + '18' }]}
                onPress={() => { const cb = confirmModal?.onConfirm; setConfirmModal(null); cb?.(); }}
              >
                <Text style={[styles.confirmOkText, { color: confirmModal?.confirmColor ?? COLORS.emerald }]}>{confirmModal?.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
    pageHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginBottom: 4 },
    backBtn: { padding: 4, marginRight: 12 },
    title: { fontSize: 24, fontWeight: '700', color: c.text },
    subtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 20, lineHeight: 20 },
    sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
    card: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.cardBorder, paddingHorizontal: 16, marginBottom: 20 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: c.cardBorder },
    rowLabel: { flex: 1, fontSize: 15, color: c.text, fontWeight: '600', textTransform: 'capitalize' },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder },
    actionText: { fontSize: 12, fontWeight: '700' },
    empty: { fontSize: 13, color: c.textSecondary, paddingVertical: 14, textAlign: 'center' },
    note: { fontSize: 12, color: c.textSecondary, lineHeight: 17, fontStyle: 'italic' },
    confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    confirmBox: { backgroundColor: c.cardSolid, borderRadius: 16, padding: 24, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: c.cardBorder },
    confirmTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 10 },
    confirmMessage: { fontSize: 14, color: c.textSecondary, marginBottom: 24, lineHeight: 20 },
    confirmBtns: { flexDirection: 'row', gap: 12 },
    confirmCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    confirmCancelText: { color: c.textSecondary, fontWeight: '600', fontSize: 15 },
    confirmOk: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    confirmOkText: { fontWeight: '700', fontSize: 15 },
  });
}
