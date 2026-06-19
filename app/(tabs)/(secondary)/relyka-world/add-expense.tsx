/**
 * Relyka World — ajout d'une dépense partagée.
 * Choix du payeur, du compte (vraie transaction) ou « cash », et répartition entre participants.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenGradient from '../../../../components/ScreenGradient';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useAuth } from '../../../../contexts/AuthContext';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useAccounts } from '../../../../hooks/useAccounts';
import { useCategories } from '../../../../hooks/useCategories';
import { CURRENCY_SYMBOL } from '../../../../lib/currency';
import { todayISO, formatDateFrench } from '../../../../lib/dateUtils';
import CalendarWithPicker from '../../../../components/CalendarWithPicker';
import { useRwProject, useRwExpenses, useAddRwExpense, useUpdateRwExpense, useDeleteRwExpense } from '../../../../hooks/useRelykaWorld';
import { Alert } from 'react-native';

const EMOJIS = ['🧾', '🍽️', '🛒', '🚕', '🏨', '🎟️', '⛽', '🍺', '🎁', '✈️'];

export default function AddRwExpense() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ projectId: string; expenseId?: string }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  const expenseId = Array.isArray(params.expenseId) ? params.expenseId[0] : params.expenseId;

  // Retour vers le projet : on dépile l'écran d'ajout pour RÉVÉLER l'instance [id] déjà montée
  // (router.back) — pas de remontage (donc pas de re-souscription realtime), et on retombe
  // toujours sur le projet, jamais sur le Pilotage. Repli explicite si pile vide (ouverture directe).
  const backToProject = React.useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(`/(tabs)/(secondary)/relyka-world/${projectId}` as any);
  }, [router, projectId]);

  const { data: projData } = useRwProject(projectId);
  const { data: expData } = useRwExpenses(projectId);
  const { data: accounts = [] } = useAccounts(user?.id);
  const { data: categories = [] } = useCategories(user?.id);
  const addExpense = useAddRwExpense(projectId, user?.id);
  const updateExpense = useUpdateRwExpense(projectId, user?.id);
  const deleteExpense = useDeleteRwExpense(projectId, user?.id);
  const editing = expData?.expenses.find((e) => e.id === expenseId) ?? null;

  const onDelete = () => {
    if (!editing) return;
    Alert.alert('Supprimer la dépense', 'Cette dépense (et la transaction liée à ton compte) sera supprimée.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: async () => {
        try { await deleteExpense.mutateAsync(editing); backToProject(); }
        catch (e: any) { Alert.alert('Erreur', e?.message ?? 'Suppression impossible. Réessaie.'); }
      } },
    ]);
  };
  // Catégorie « Projets » (comme une transaction de projet classique).
  const projetsCategoryId = useMemo(() => (categories as any[]).find((c) => c.name === 'Projets' && c.type === 'expense')?.id ?? null, [categories]);

  const project = projData?.project;
  const participants = projData?.participants ?? [];
  const myParticipantId = participants.find((p) => p.user_id === user?.id)?.id;
  const checkingAccounts = useMemo(() => accounts.filter((a) => a.type === 'checking'), [accounts]);

  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState('🧾');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | undefined>(myParticipantId);
  const [accountId, setAccountId] = useState<string | 'cash'>('cash');
  const [involved, setInvolved] = useState<Set<string>>(new Set(participants.map((p) => p.id)));
  const [date, setDate] = useState(todayISO());
  const [showCal, setShowCal] = useState(false);
  const [busy, setBusy] = useState(false);

  // Initialise les sélections quand les participants arrivent (création seulement).
  React.useEffect(() => {
    if (editing) return;
    if (participants.length && involved.size === 0) setInvolved(new Set(participants.map((p) => p.id)));
    if (!paidBy && myParticipantId) setPaidBy(myParticipantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.length, editing]);

  // Pré-remplissage en mode édition (une seule fois).
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (!editing || !expData || prefilled.current) return;
    setTitle(editing.title); setEmoji(editing.emoji || '🧾');
    setAmount(String(editing.amount).replace('.', ',')); setDate(editing.date);
    setPaidBy(editing.paid_by); setAccountId(editing.account_id ?? 'cash');
    const sh = expData.shares.filter((s) => s.expense_id === editing.id);
    if (sh.length) setInvolved(new Set(sh.map((s) => s.participant_id)));
    prefilled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, expData]);

  const amountNum = parseFloat(amount.replace(',', '.')) || 0;
  const involvedList = participants.filter((p) => involved.has(p.id));
  const perHead = involvedList.length > 0 ? amountNum / involvedList.length : 0;
  const paidByMe = paidBy && paidBy === myParticipantId;

  const toggle = (id: string) => setInvolved((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const canSave = title.trim().length > 0 && amountNum > 0 && !!paidBy && involvedList.length > 0 && !busy;

  const onSave = async () => {
    if (!canSave || !projectId) return;
    setBusy(true);
    try {
      // Répartition équitable entre les participants concernés (ajustement des centimes sur le 1er).
      const base = Math.floor((amountNum / involvedList.length) * 100) / 100;
      const shares = involvedList.map((p) => ({ participant_id: p.id, amount: base }));
      const diff = Math.round((amountNum - base * involvedList.length) * 100) / 100;
      if (shares.length) shares[0].amount = Math.round((shares[0].amount + diff) * 100) / 100;
      const common = {
        title: title.trim(), emoji, amount: amountNum, date, paidBy: paidBy!,
        shares,
        accountId: paidByMe && accountId !== 'cash' ? accountId : null,
        projectName: project?.name ?? 'Projet',
        categoryId: projetsCategoryId,
      };
      if (editing) await updateExpense.mutateAsync({ expense: editing, ...common, iAmPayer: !!paidByMe });
      else await addExpense.mutateAsync(common);
      backToProject();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible d\'enregistrer la dépense. Vérifie ta connexion et réessaie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScreenHeader title={editing ? 'Modifier la dépense' : 'Ajouter une dépense'} onBack={backToProject} />
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Icône</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              {EMOJIS.map((e) => (
                <TouchableOpacity key={e} style={[styles.emojiPick, emoji === e && styles.emojiPickActive]} onPress={() => setEmoji(e)}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Titre</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ex. Restaurant" placeholderTextColor={COLORS.textSecondary} />

            <Text style={styles.label}>Montant ({CURRENCY_SYMBOL})</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0,00" placeholderTextColor={COLORS.textSecondary} keyboardType="decimal-pad" />

            <Text style={styles.label}>Date</Text>
            <TouchableOpacity style={[styles.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]} onPress={() => setShowCal(true)} activeOpacity={0.7}>
              <Text style={{ color: COLORS.text, fontSize: 15 }}>{formatDateFrench(date)}</Text>
              <Ionicons name="calendar-outline" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <Text style={styles.label}>Payé par</Text>
            <View style={styles.chipsWrap}>
              {participants.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, paidBy === p.id && styles.chipActive]} onPress={() => setPaidBy(p.id)}>
                  <Text style={[styles.chipText, paidBy === p.id && styles.chipTextActive]}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Compte (seulement si payé par moi) → vraie transaction, sinon cash */}
            {paidByMe && (
              <>
                <Text style={styles.label}>Depuis quel compte ?</Text>
                <View style={styles.chipsWrap}>
                  <TouchableOpacity style={[styles.chip, accountId === 'cash' && styles.chipActive]} onPress={() => setAccountId('cash')}>
                    <Ionicons name="cash-outline" size={14} color={accountId === 'cash' ? COLORS.bg : COLORS.textSecondary} />
                    <Text style={[styles.chipText, accountId === 'cash' && styles.chipTextActive]}>  Cash (aucune transaction)</Text>
                  </TouchableOpacity>
                  {checkingAccounts.map((a) => (
                    <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                      <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {accountId !== 'cash' && <Text style={styles.hint}>Une dépense de {amountNum.toFixed(2)} {CURRENCY_SYMBOL} sera enregistrée sur ce compte.</Text>}
              </>
            )}

            <Text style={styles.label}>Partagé entre {involvedList.length > 0 ? `(${perHead.toFixed(2)} ${CURRENCY_SYMBOL} / pers.)` : ''}</Text>
            {participants.map((p) => {
              const on = involved.has(p.id);
              return (
                <TouchableOpacity key={p.id} style={styles.partRow} onPress={() => toggle(p.id)} activeOpacity={0.7}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? COLORS.emerald : COLORS.textSecondary} />
                  <Text style={styles.partName}>{p.display_name}{p.user_id === user?.id ? ' (moi)' : ''}</Text>
                  <Text style={styles.partShare}>{on ? `${perHead.toFixed(2)} ${CURRENCY_SYMBOL}` : '—'}</Text>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={[styles.cta, !canSave && { opacity: 0.5 }]} onPress={onSave} disabled={!canSave} activeOpacity={0.85}>
              {busy ? <ActivityIndicator color={COLORS.bg} /> : <Text style={styles.ctaText}>{editing ? 'Enregistrer' : 'Sauvegarder'}</Text>}
            </TouchableOpacity>
            {editing && (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                <Text style={styles.deleteBtnText}>Supprimer la dépense</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={showCal} transparent animationType="fade" onRequestClose={() => setShowCal(false)}>
        <TouchableOpacity style={styles.calOverlay} activeOpacity={1} onPress={() => setShowCal(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.calCard} onPress={() => {}}>
            <CalendarWithPicker
              current={date}
              accentColor={COLORS.emerald}
              bgColor={COLORS.cardSolid ?? COLORS.card}
              textColor={COLORS.text}
              textSecondaryColor={COLORS.textSecondary}
              onDayPress={(d) => { setDate(d.dateString); setShowCal(false); }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
    label: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 6, marginTop: 8 },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 8, marginTop: -2 },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: c.text, fontSize: 15, marginBottom: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    emojiPick: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, marginRight: 8 },
    emojiPickActive: { borderColor: c.emerald, borderWidth: 2 },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    chipActive: { backgroundColor: c.emerald, borderColor: c.emerald },
    chipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    chipTextActive: { color: c.bg },
    partRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, padding: 12, marginBottom: 8 },
    partName: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
    partShare: { fontSize: 13, fontWeight: '700', color: c.text },
    cta: { backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 16 },
    ctaText: { fontSize: 15, fontWeight: '800', color: c.bg },
    deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, marginTop: 10, borderRadius: 12, backgroundColor: c.danger + '14' },
    deleteBtnText: { fontSize: 14, fontWeight: '700', color: c.danger },
    calOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    calCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 18, borderWidth: 1, borderColor: c.cardBorder, padding: 10 },
  });
}
