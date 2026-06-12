import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { useAllSupportRequests, useDeleteSupportRequest, useDeleteClosedSupportRequests, type SupportRequest } from '../../../hooks/useSupport';
import SupportThreadModal from '../../../components/SupportThreadModal';

function confirmThen(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(message)) onYes();
  } else {
    Alert.alert('Confirmer', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: onYes },
    ]);
  }
}


type Filter = 'open' | 'closed' | 'all';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminAssistance() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const { data: requests = [], isLoading, refetch } = useAllSupportRequests(!!isAdmin);
  const deleteRequest = useDeleteSupportRequest();
  const deleteClosed = useDeleteClosedSupportRequests();
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<SupportRequest | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const closedCount = requests.filter((r) => r.status === 'closed').length;

  const filtered = useMemo(() => {
    const list = filter === 'all' ? requests : requests.filter((r) => r.status === filter);
    // Demandes avec message non lu en premier, puis par date.
    return [...list].sort((a, b) => Number(b.admin_unread) - Number(a.admin_unread) || b.last_message_at.localeCompare(a.last_message_at));
  }, [requests, filter]);

  const openCount = requests.filter((r) => r.status === 'open').length;
  const unreadCount = requests.filter((r) => r.admin_unread).length;

  const onRefresh = async () => { setRefreshing(true); try { await refetch(); } finally { setRefreshing(false); } };

  if (!isAdmin) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <Text style={styles.text}>Accès réservé aux administrateurs.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Assistance</Text>
        <Text style={styles.subtitle}>
          {openCount} demande{openCount > 1 ? 's' : ''} en cours{unreadCount > 0 ? ` · ${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : ''}.
        </Text>

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
            onPress={() => confirmThen(`Supprimer définitivement ${closedCount} demande${closedCount > 1 ? 's' : ''} clôturée${closedCount > 1 ? 's' : ''} ?`, () => deleteClosed.mutate())}
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
                <TouchableOpacity
                  style={styles.cardDeleteBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => confirmThen(`Supprimer la demande « ${r.subject} » de ${r.profile_email || 'cet utilisateur'} ?`, () => deleteRequest.mutate(r.id))}
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
    backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backLabel: { fontSize: 16, color: c.text, marginLeft: 4 },
    title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 6 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
    filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
    bulkDeleteBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.danger + '55', backgroundColor: c.danger + '12', marginBottom: 14 },
    bulkDeleteText: { fontSize: 12, fontWeight: '700', color: c.danger },
    cardDeleteBtn: { padding: 4 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder },
    chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipText: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
    chipTextActive: { color: c.bg },
    scroll: { flex: 1 },
    empty: { color: c.textSecondary, textAlign: 'center', marginTop: 32, fontSize: 14 },
    reqCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    reqSubject: { fontSize: 15, fontWeight: '700', color: c.text },
    reqEmail: { fontSize: 12, color: c.emerald, marginTop: 2 },
    reqMeta: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
    unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
    text: { color: c.text, padding: 20 },
  });
}
