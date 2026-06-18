/**
 * Relyka World — détail d'un projet partagé.
 * Onglets « Dépenses » et « Équilibres ». Ajout de dépense, invitation de participants.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, ActivityIndicator, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../../components/ScreenGradient';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { CURRENCY_SYMBOL } from '../../../../lib/currency';
import {
  useRwProject, useRwExpenses, useRwInviteByCode, useAddRwParticipant, useDeleteRwExpense,
  useDeleteRwProject, useUpdateRwProject, useRwRealtime, computeBalances, settleUp, type RwExpense,
} from '../../../../hooks/useRelykaWorld';

const PROJ_EMOJIS = ['💸', '🏖️', '✈️', '🍽️', '🎉', '🏠', '🚗', '⛰️', '🛒', '🎲'];

const fmt = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY_SYMBOL}`;

export default function RelykaWorldDetail() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;

  useRwRealtime(projectId);
  const { data: projData, isLoading } = useRwProject(projectId);
  const { data: expData } = useRwExpenses(projectId);
  const inviteByCode = useRwInviteByCode(projectId);
  const addParticipant = useAddRwParticipant(projectId);
  const deleteProject = useDeleteRwProject(user?.id);
  const updateProject = useUpdateRwProject(projectId);

  const project = projData?.project;
  const participants = projData?.participants ?? [];
  const expenses = expData?.expenses ?? [];
  const shares = expData?.shares ?? [];
  const isOwner = project?.owner_id === user?.id;

  const [tab, setTab] = useState<'expenses' | 'balances'>('expenses');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [freeName, setFreeName] = useState('');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEmoji, setEditEmoji] = useState('💸');
  const openEdit = () => { setEditName(project?.name ?? ''); setEditDesc(project?.description ?? ''); setEditEmoji(project?.emoji || '💸'); setShowEdit(true); };
  const saveEdit = async () => {
    if (!editName.trim()) return;
    await updateProject.mutateAsync({ name: editName.trim(), description: editDesc.trim(), emoji: editEmoji });
    setShowEdit(false);
  };

  const nameOf = (pid: string) => participants.find((p) => p.id === pid)?.display_name ?? '?';
  const myParticipantId = participants.find((p) => p.user_id === user?.id)?.id;

  const total = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  // Ma part = somme de mes quotes-parts (ce que je dois payer au final).
  const myShare = useMemo(() => shares.filter((s) => s.participant_id === myParticipantId).reduce((sum, s) => sum + s.amount, 0), [shares, myParticipantId]);
  // Ce que j'ai avancé = somme des dépenses dont je suis le payeur (sorties de ma poche).
  const myPaid = useMemo(() => expenses.filter((e) => e.paid_by === myParticipantId).reduce((sum, e) => sum + e.amount, 0), [expenses, myParticipantId]);

  const balances = useMemo(() => computeBalances(participants, expenses, shares), [participants, expenses, shares]);
  const settlements = useMemo(() => settleUp(participants.map((p) => ({ id: p.id, amount: balances.get(p.id) ?? 0 }))), [participants, balances]);
  const myBalance = myParticipantId ? (balances.get(myParticipantId) ?? 0) : 0;

  // Dépenses groupées par date.
  const grouped = useMemo(() => {
    const m = new Map<string, RwExpense[]>();
    for (const e of expenses) { const k = e.date; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()];
  }, [expenses]);

  const onInviteByCode = async () => {
    if (!inviteCode.trim()) return;
    setInviteBusy(true); setInviteErr(null);
    try {
      await inviteByCode.mutateAsync({ code: inviteCode.trim(), name: '' });
      setInviteCode(''); setShowInvite(false);
    } catch (e: any) { setInviteErr(e?.message ?? 'Invitation impossible.'); }
    finally { setInviteBusy(false); }
  };
  const onAddFreeName = async () => {
    if (!freeName.trim()) return;
    await addParticipant.mutateAsync(freeName.trim());
    setFreeName('');
  };

  const confirmDeleteProject = () => {
    Alert.alert('Supprimer le projet', 'Tout le projet et ses dépenses seront supprimés pour tous les participants.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => { await deleteProject.mutateAsync(projectId!); goBack(); } },
    ]);
  };

  if (isLoading) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={styles.safe} edges={[]}><ScreenHeader title="Projet" onBack={goBack} /><ActivityIndicator color={COLORS.emerald} style={{ marginTop: 40 }} /></SafeAreaView></View>;
  }
  if (!project) {
    return <View style={styles.root}><ScreenGradient /><SafeAreaView style={styles.safe} edges={[]}><ScreenHeader title="Projet" onBack={goBack} /><Text style={styles.empty}>Projet introuvable.</Text></SafeAreaView></View>;
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScreenHeader title={`${project.emoji || '💸'} ${project.name}`} onBack={goBack} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          {/* Inviter */}
          <View style={styles.topRow}>
            <TouchableOpacity style={styles.inviteBtn} onPress={() => setShowInvite(true)} activeOpacity={0.85}>
              <Ionicons name="person-add-outline" size={16} color="#3b82f6" />
              <Text style={styles.inviteBtnText}>Inviter / participants ({participants.length})</Text>
            </TouchableOpacity>
            {isOwner && (
              <TouchableOpacity style={styles.editProjBtn} onPress={openEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="create-outline" size={18} color={COLORS.text} />
              </TouchableOpacity>
            )}
            {isOwner && (
              <TouchableOpacity style={styles.deleteProjBtn} onPress={confirmDeleteProject} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
              </TouchableOpacity>
            )}
          </View>

          {/* Onglets */}
          <View style={styles.tabs}>
            <TouchableOpacity style={[styles.tab, tab === 'expenses' && styles.tabActive]} onPress={() => setTab('expenses')}>
              <Text style={[styles.tabText, tab === 'expenses' && styles.tabTextActive]}>Dépenses</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'balances' && styles.tabActive]} onPress={() => setTab('balances')}>
              <Text style={[styles.tabText, tab === 'balances' && styles.tabTextActive]}>Équilibres</Text>
            </TouchableOpacity>
          </View>

          {tab === 'expenses' ? (
            <>
              <View style={styles.totalsRow}>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>J'ai avancé</Text><Text style={styles.totalValue}>{fmt(myPaid)}</Text></View>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>Ma part</Text><Text style={styles.totalValue}>{fmt(myShare)}</Text></View>
                <View style={styles.totalCol}><Text style={styles.totalLabel}>Total projet</Text><Text style={styles.totalValue}>{fmt(total)}</Text></View>
              </View>
              {expenses.length === 0 ? (
                <Text style={styles.empty}>Aucune dépense. Ajoutez-en une !</Text>
              ) : grouped.map(([date, items]) => (
                <View key={date}>
                  <Text style={styles.dateHeader}>{new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                  {items.map((e) => (
                    <TouchableOpacity key={e.id} style={styles.expCard} activeOpacity={0.8}
                      onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/add-expense?projectId=${projectId}&expenseId=${e.id}` as any)}>
                      <Text style={styles.expEmoji}>{e.emoji || '🧾'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.expTitle} numberOfLines={1}>{e.title || 'Dépense'}</Text>
                        <Text style={styles.expSub}>Payé par {nameOf(e.paid_by)}{e.account_id ? '' : ' · cash'}</Text>
                      </View>
                      <Text style={styles.expAmount}>{fmt(e.amount)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </>
          ) : (
            <>
              <View style={[styles.balanceHeadCard, { borderColor: (myBalance >= 0 ? COLORS.emerald : COLORS.danger) + '55' }]}>
                <Text style={styles.balanceHeadText}>
                  {Math.abs(myBalance) < 0.01 ? 'Vous êtes à jour ✅' : myBalance > 0 ? `On vous doit ${fmt(myBalance)}` : `Vous devez ${fmt(-myBalance)}`}
                </Text>
              </View>
              <Text style={styles.sectionLabel}>Soldes par participant</Text>
              {participants.map((p) => {
                const b = balances.get(p.id) ?? 0;
                return (
                  <View key={p.id} style={styles.balRow}>
                    <Text style={styles.balName}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                    <Text style={[styles.balAmount, { color: Math.abs(b) < 0.01 ? COLORS.textSecondary : b > 0 ? COLORS.emerald : COLORS.danger }]}>
                      {b > 0 ? '+' : ''}{fmt(b)}
                    </Text>
                  </View>
                );
              })}
              {settlements.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Remboursements suggérés</Text>
                  {settlements.map((s, i) => (
                    <View key={i} style={styles.settleRow}>
                      <Text style={styles.settleText}><Text style={{ fontWeight: '800', color: COLORS.text }}>{nameOf(s.from)}</Text> doit <Text style={{ fontWeight: '800', color: COLORS.text }}>{fmt(s.amount)}</Text> à <Text style={{ fontWeight: '800', color: COLORS.text }}>{nameOf(s.to)}</Text></Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* Ajouter une dépense */}
        <TouchableOpacity style={styles.fab} activeOpacity={0.85}
          onPress={() => router.push(`/(tabs)/(secondary)/relyka-world/add-expense?projectId=${projectId}` as any)}>
          <Ionicons name="add" size={24} color="#fff" />
          <Text style={styles.fabText}>Ajouter une dépense</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Modal inviter */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Participants</Text>
              <TouchableOpacity onPress={() => setShowInvite(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Inviter un utilisateur Relyka (par son ID)</Text>
            <TextInput style={styles.input} value={inviteCode} onChangeText={(t) => setInviteCode(t.toUpperCase())} placeholder="Ex. A1B2C3D4" placeholderTextColor={COLORS.textSecondary} autoCapitalize="characters" />
            {!!inviteErr && <Text style={styles.errText}>{inviteErr}</Text>}
            <TouchableOpacity style={[styles.modalCta, (!inviteCode.trim() || inviteBusy) && { opacity: 0.5 }]} onPress={onInviteByCode} disabled={!inviteCode.trim() || inviteBusy}>
              {inviteBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalCtaText}>Envoyer l'invitation</Text>}
            </TouchableOpacity>

            <View style={styles.sep} />
            <Text style={styles.label}>Ou ajouter une personne non inscrit</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} value={freeName} onChangeText={setFreeName} placeholder="Ex. Julie" placeholderTextColor={COLORS.textSecondary} />
              <TouchableOpacity style={styles.addNameBtn} onPress={onAddFreeName} disabled={!freeName.trim()}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.sep} />
            <Text style={styles.label}>Participants actuels</Text>
            {participants.map((p) => (
              <Text key={p.id} style={styles.partItem}>• {p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}{p.pending ? ' · en attente' : ''}</Text>
            ))}
          </View>
        </View>
      </Modal>

      {/* Modal édition projet */}
      <Modal visible={showEdit} transparent animationType="slide" onRequestClose={() => setShowEdit(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Modifier le projet</Text>
              <TouchableOpacity onPress={() => setShowEdit(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Icône</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {PROJ_EMOJIS.map((e) => (
                <TouchableOpacity key={e} style={[styles.editEmojiPick, editEmoji === e && { borderColor: COLORS.emerald, borderWidth: 2 }]} onPress={() => setEditEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Nom du projet *</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Nom" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.label}>Description</Text>
            <TextInput style={styles.input} value={editDesc} onChangeText={setEditDesc} placeholder="Description (optionnel)" placeholderTextColor={COLORS.textSecondary} />
            <TouchableOpacity style={[styles.modalCta, !editName.trim() && { opacity: 0.5 }]} onPress={saveEdit} disabled={!editName.trim()} activeOpacity={0.85}>
              <Text style={styles.modalCtaText}>Enregistrer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    empty: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 24 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    inviteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3b82f6' + '1A', borderWidth: 1, borderColor: '#3b82f6' + '55', borderRadius: 999, paddingVertical: 10 },
    inviteBtnText: { fontSize: 13, fontWeight: '700', color: '#3b82f6' },
    editProjBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    deleteProjBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.danger + '14' },
    editEmojiPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    tabs: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: c.cardBorder },
    tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
    tabActive: { backgroundColor: c.emerald },
    tabText: { fontSize: 14, fontWeight: '700', color: c.textSecondary },
    tabTextActive: { color: c.bg },
    totalsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    totalCol: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
    totalLabel: { fontSize: 11, color: c.textSecondary, textAlign: 'center' },
    totalValue: { fontSize: 14.5, fontWeight: '800', color: c.text, marginTop: 4 },
    dateHeader: { fontSize: 13, fontWeight: '800', color: c.textSecondary, marginTop: 12, marginBottom: 8 },
    expCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    expEmoji: { fontSize: 22 },
    expTitle: { fontSize: 14, fontWeight: '700', color: c.text },
    expSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    expAmount: { fontSize: 15, fontWeight: '800', color: c.text },
    balanceHeadCard: { backgroundColor: c.card, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16, alignItems: 'center' },
    balanceHeadText: { fontSize: 16, fontWeight: '800', color: c.text },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 },
    balRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 14, marginBottom: 8 },
    balName: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
    balAmount: { fontSize: 14, fontWeight: '800' },
    settleRow: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    settleText: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
    fab: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.emerald, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 13, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
    fabText: { fontSize: 15, fontWeight: '800', color: c.bg },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalCard: { backgroundColor: c.cardSolid ?? c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 36, borderWidth: 1, borderColor: c.cardBorder, maxHeight: '85%' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text },
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 10, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    errText: { fontSize: 12, color: c.danger, marginBottom: 8 },
    modalCta: { backgroundColor: c.emerald, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 2 },
    modalCtaText: { fontSize: 15, fontWeight: '800', color: c.bg },
    addNameBtn: { width: 48, height: 48, borderRadius: 12, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    sep: { height: 1, backgroundColor: c.cardBorder, marginVertical: 16 },
    partItem: { fontSize: 13, color: c.text, marginBottom: 4 },
    detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
    detailCard: { width: '100%', maxWidth: 360, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 22, alignItems: 'center' },
    detailEmoji: { fontSize: 36 },
    detailTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginTop: 6 },
    detailAmount: { fontSize: 24, fontWeight: '900', color: c.emerald, marginTop: 4 },
    detailSub: { fontSize: 12.5, color: c.textSecondary, marginTop: 4, textAlign: 'center' },
    shareRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 6 },
    shareName: { fontSize: 14, color: c.text },
    shareAmount: { fontSize: 14, fontWeight: '700', color: c.text },
    detailActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
    editExpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder },
    editExpText: { fontSize: 13, fontWeight: '700', color: c.text },
    deleteExpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: c.danger + '14' },
    deleteExpText: { fontSize: 13, fontWeight: '700', color: c.danger },
  });
}
