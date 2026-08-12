/**
 * CreditShareSection — partage d'un crédit (propriétaire uniquement).
 *
 * DEUX choses différentes vivent ici, et il faut les garder distinctes :
 *
 *   1. La NATURE du crédit — perso ou partagé — c'est-à-dire QUI PORTE LA DETTE. Un crédit souscrit
 *      à deux reste partagé même si personne d'autre ne l'a ouvert dans l'app. C'est ce drapeau
 *      (`credits.is_shared`, migration 166) qui sépare les récaps de l'onglet Crédits.
 *   2. Les ACCÈS — qui peut voir ou modifier la fiche (`credit_members`, consultation / écriture).
 *      Donner un accès en consultation à quelqu'un ne rend pas la dette commune.
 *
 * Les confondre, c'était compter dans « mes crédits partagés » tout ce qu'on avait simplement montré
 * à quelqu'un, et rien de ce qu'on porte réellement à plusieurs.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useCreditMembers, useInviteToCredit, useSetCreditMemberRole, useRemoveCreditMember } from '../hooks/useSharedCredits';
import { useUpdateCredit } from '../hooks/useCredits';
import type { Credit } from '../types/database';

export default function CreditShareSection({ credit }: { credit: Credit }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: members = [] } = useCreditMembers(credit.id);
  const invite = useInviteToCredit(credit.id);
  const setRole = useSetCreditMemberRole(credit.id);
  const removeMember = useRemoveCreditMember(credit.id);
  const updateCredit = useUpdateCredit(credit.profile_id);

  const [code, setCode] = useState('');
  const [role, setRole_] = useState<'write' | 'read'>('read');

  if (credit._role && credit._role !== 'owner') return null; // seul le propriétaire partage

  const isShared = credit.is_shared === true;

  const doInvite = async () => {
    const c = code.trim();
    if (!c) { Alert.alert('Inviter', 'Saisis le code utilisateur.'); return; }
    try { await invite.mutateAsync({ code: c, role }); setCode(''); }
    catch (e: any) { Alert.alert('Inviter', e?.message ?? "Impossible d'inviter."); }
  };

  const confirmRemove = (memberId: string, label: string) => {
    Alert.alert('Retirer l’accès', `Retirer ${label} de ce crédit ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => removeMember.mutate(memberId) },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Ionicons name="people-outline" size={18} color={COLORS.text} />
        <Text style={styles.title}>Partager ce crédit</Text>
      </View>
      {/* ── 1. NATURE du crédit : qui porte la dette ? ── */}
      <Text style={styles.blockLabel}>Ce crédit est</Text>
      <View style={styles.natureRow}>
        {([false, true] as const).map((v) => (
          <TouchableOpacity
            key={String(v)}
            style={[styles.natureChip, isShared === v && styles.natureChipActive]}
            onPress={() => updateCredit.mutate({ id: credit.id, is_shared: v })}
            disabled={updateCredit.isPending}
            activeOpacity={0.8}
          >
            <Ionicons
              name={v ? 'people' : 'person'}
              size={16}
              color={isShared === v ? COLORS.emerald : COLORS.textSecondary}
            />
            <Text style={[styles.natureChipText, isShared === v && styles.natureChipTextActive]}>
              {v ? 'Partagé' : 'Personnel'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>
        {isShared
          ? 'Dette portée à plusieurs (couple, associés…). Elle est totalisée à part dans le récap de l\'onglet Crédits.'
          : 'Dette que tu portes seul. Elle est totalisée dans « Mes crédits ».'}
        {' '}C'est une question de responsabilité, pas d'accès : donner la consultation à quelqu'un ne rend pas la dette commune.
      </Text>

      {/* ── 2. ACCÈS : qui peut voir / modifier la fiche ? ── */}
      <Text style={[styles.blockLabel, { marginTop: 14 }]}>Qui a accès à la fiche</Text>
      <Text style={styles.hint}>Les invités voient ce crédit (pour ne pas le recréer). Leur trésorerie n'est pas impactée s'ils n'ont pas accès au compte de prélèvement.</Text>

      {members.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <View style={[styles.avatar, { backgroundColor: COLORS.blue + '1A' }]}>
            <Ionicons name="person" size={15} color={COLORS.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName} numberOfLines={1}>{m.display_name}</Text>
            <Text style={styles.memberSub}>{m.user_id ? 'Membre' : 'En attente'}</Text>
          </View>
          <TouchableOpacity style={styles.roleBadge} onPress={() => setRole.mutate({ memberId: m.id, role: m.role === 'read' ? 'write' : 'read' })} disabled={setRole.isPending}>
            <Text style={styles.roleBadgeText}>{m.role === 'read' ? 'Consultation' : 'Écriture'}</Text>
            <Ionicons name="swap-horizontal" size={13} color={COLORS.text} />
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" style={styles.removeBtn} onPress={() => confirmRemove(m.id, m.display_name)}>
            <Ionicons name="close" size={16} color={COLORS.danger} />
          </TouchableOpacity>
        </View>
      ))}

      <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="Code utilisateur (depuis son profil)" placeholderTextColor={COLORS.textSecondary} autoCapitalize="characters" />
      <View style={styles.roleRow}>
        {(['read', 'write'] as const).map((r) => (
          <TouchableOpacity key={r} style={[styles.roleChip, role === r && styles.roleChipActive]} onPress={() => setRole_(r)}>
            <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>{r === 'write' ? 'Écriture' : 'Consultation'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.inviteBtn} onPress={doInvite} disabled={invite.isPending}>
        <Ionicons name="person-add-outline" size={16} color={COLORS.bg} />
        <Text style={styles.inviteLabel}>Inviter</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { marginTop: 18, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    title: { fontSize: 15, fontWeight: '800', color: c.text },
    hint: { fontSize: 11.5, color: c.textSecondary, marginBottom: 10, lineHeight: 16 },
    blockLabel: { fontSize: 11.5, fontWeight: '800', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
    natureRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    natureChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.bg },
    natureChipActive: { borderColor: c.emerald, backgroundColor: c.emerald + '18' },
    natureChipText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    natureChipTextActive: { color: c.emerald },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    memberName: { fontSize: 14, fontWeight: '600', color: c.text },
    memberSub: { fontSize: 11, color: c.textSecondary },
    roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: c.text + '33', backgroundColor: c.text + '0D' },
    roleBadgeText: { fontSize: 11.5, fontWeight: '700', color: c.text },
    removeBtn: { padding: 4 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: c.text, marginTop: 8 },
    roleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    roleChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center' },
    roleChipActive: { backgroundColor: c.text + '12', borderColor: c.text },
    roleChipText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    roleChipTextActive: { color: c.text, fontWeight: '700' },
    inviteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.emerald, paddingVertical: 11, borderRadius: 12, marginTop: 10 },
    inviteLabel: { color: c.bg, fontWeight: '700', fontSize: 14 },
  });
}
