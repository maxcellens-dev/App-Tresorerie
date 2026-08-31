import React, { useMemo, useState } from 'react';
import { chipStyles } from '../../../../lib/ui/controls';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/layout/ScreenHeader';
import ScreenGradient from '../../../../components/layout/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/data/useProfile';
import { useAppColors } from '../../../../hooks/theme/useAppColors';
import { useResponsive } from '../../../../hooks/theme/useResponsive';
import { pageColumn } from '../../../../lib/ui/webLayout';
import { useNavBack } from '../../../../hooks/platform/useNavBack';
import { useAllSupportRequests, useDeleteSupportRequest, useDeleteClosedSupportRequests, type SupportRequest } from '../../../../hooks/admin/useSupport';
import SupportThreadModal from '../../../../components/ui/SupportThreadModal';

function confirmThen(message: string, onYes: () => void) {
  // Confirmation in-app (§7)
  Alert.alert('Confirmer', message, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: onYes },
  ]);
}


type Filter = 'open' | 'closed' | 'all';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminAssistance() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const { data: profile, isSuccess: profileLoaded } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;

  const { data, isLoading, isError, refetch } = useAllSupportRequests(!!isAdmin);
  const requests = data?.rows ?? [];
  const total = data?.total ?? 0;
  const deleteRequest = useDeleteSupportRequest();
  const deleteClosed = useDeleteClosedSupportRequests();
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<SupportRequest | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Dernière action de suppression : succès ou échec, dit à l'écran (c'était muet). */
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const closedIds = requests.filter((r) => r.status === 'closed').map((r) => r.id);
  const closedCount = closedIds.length;

  const filtered = useMemo(() => {
    const list = filter === 'all' ? requests : requests.filter((r) => r.status === filter);
    // Demandes avec message non lu en premier, puis par date. `?? ''` : une date absente faisait
    // planter la comparaison et vidait toute la page.
    return [...list].sort((a, b) =>
      Number(b.admin_unread) - Number(a.admin_unread)
      || (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
  }, [requests, filter]);

  const openCount = requests.filter((r) => r.status === 'open').length;
  const unreadCount = requests.filter((r) => r.admin_unread).length;

  const onRefresh = async () => { setRefreshing(true); try { await refetch(); } finally { setRefreshing(false); } };

  const say = (text: string, ok: boolean) => {
    setActionMsg({ text, ok });
    setTimeout(() => setActionMsg(null), ok ? 3000 : 6000);
  };
  const removeOne = (r: SupportRequest) => deleteRequest.mutate(r.id, {
    onSuccess: () => say('Demande supprimée.', true),
    onError: (e: any) => say(`Suppression impossible : ${e?.message ?? 'réessaie'}`, false),
  });
  // On ne supprime QUE les demandes réellement listées à l'écran (cf. useDeleteClosedSupportRequests).
  const removeClosed = () => deleteClosed.mutate(closedIds, {
    onSuccess: () => say(`${closedIds.length} demande${closedIds.length > 1 ? 's' : ''} supprimée${closedIds.length > 1 ? 's' : ''}.`, true),
    onError: (e: any) => say(`Suppression impossible : ${e?.message ?? 'réessaie'}`, false),
  });

  /* Tant que le profil n'a pas répondu, on ne SAIT pas si la personne est administratrice —
     `is_admin` vaut `false` par défaut. L'écran affichait donc « Accès réservé » à un
     administrateur pendant tout le chargement, avant de se raviser. */
  if (!profileLoaded) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Assistance" onBack={goBack} />
          <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 32 }} />
        </SafeAreaView>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <ScreenGradient />
        <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
          <ScreenHeader title="Assistance" onBack={goBack} />
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[styles.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Assistance" onBack={goBack} />

        <Text style={styles.subtitle}>
          {openCount} demande{openCount > 1 ? 's' : ''} en cours{unreadCount > 0 ? ` · ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : ''}.
          {/* La liste est plafonnée : on le DIT, sinon « 200 demandes » passe pour un total. */}
          {total > requests.length ? ` ${requests.length} affichées sur ${total}.` : ''}
        </Text>

        {isError && (
          <Text style={[styles.empty, { color: COLORS.danger, marginTop: 0, marginBottom: 12 }]}>
            Les demandes n'ont pas pu être chargées. Tire vers le bas pour réessayer.
          </Text>
        )}
        {actionMsg && (
          <Text style={[styles.actionMsg, { color: actionMsg.ok ? COLORS.green : COLORS.danger }]}>{actionMsg.text}</Text>
        )}

        <View style={styles.filterRow}>
          {(['open', 'closed', 'all'] as Filter[]).map((f) => (
            <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
              <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>
                {f === 'open' ? 'En cours' : f === 'closed' ? 'Clôturées' : 'Toutes'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {filter === 'closed' && closedCount > 0 && (
          <TouchableOpacity
            style={styles.bulkDeleteBtn}
            activeOpacity={0.7}
            onPress={() => confirmThen(`Supprimer définitivement ${closedCount} demande${closedCount > 1 ? 's' : ''} clôturée${closedCount > 1 ? 's' : ''} ?`, removeClosed)}
          >
            <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
            <Text style={styles.bulkDeleteText}>Supprimer les clôturées ({closedCount})</Text>
          </TouchableOpacity>
        )}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.emerald} />}
        >
          {isLoading ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 32 }} />
          ) : filtered.length === 0 ? (
            <Text style={styles.empty}>Aucune demande {filter === 'open' ? 'en cours' : filter === 'closed' ? 'clôturée' : ''}.</Text>
          ) : (
            filtered.map((r) => (
              <TouchableOpacity key={r.id} style={styles.reqCard} activeOpacity={0.7} onPress={() => setOpen(r)}>
                <View style={[styles.statusDot, { backgroundColor: r.status === 'closed' ? COLORS.textSecondary : COLORS.green }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqSubject} numberOfLines={1}>{r.subject}</Text>
                  <Text style={styles.reqEmail} numberOfLines={1}>{r.profile_email || 'Utilisateur'}</Text>
                  <Text style={styles.reqMeta}>{formatDate(r.last_message_at)}</Text>
                </View>
                {r.admin_unread && <View style={styles.unreadDot} />}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Supprimer la demande"
                  style={styles.cardDeleteBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => confirmThen(`Supprimer la demande « ${r.subject} » de ${r.profile_email || 'cet utilisateur'} ?`, () => removeOne(r))}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      <SupportThreadModal
        visible={!!open}
        requestId={open?.id ?? null}
        subject={open?.subject ?? ''}
        status={open?.status ?? 'open'}
        role="admin"
        authorId={user?.id}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    bulkDeleteBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', marginBottom: 14 },
    bulkDeleteText: { fontSize: 12, fontWeight: '700', color: c.danger },
    cardDeleteBtn: { padding: 4 },
    chip: { ...chipStyles(c).chip },
    chipActive: { ...chipStyles(c).chipActive },
    chipText: { ...chipStyles(c).label },
    chipTextActive: { ...chipStyles(c).labelActive },
    scroll: { flex: 1 },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 32, fontSize: 14 },
    reqCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    reqSubject: { fontSize: 15, fontWeight: '700', color: c.text },
    reqEmail: { fontSize: 12, color: c.emerald, marginTop: 2 },
    reqMeta: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    text: { color: c.text, padding: 20 },
    actionMsg: { fontSize: 12.5, fontWeight: '700', marginBottom: 10 },
  });
}
