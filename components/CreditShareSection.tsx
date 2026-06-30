/**
 * CreditShareSection — partage d'un crédit (propriétaire uniquement) : inviter des utilisateurs par
 * code public en consultation / écriture, lister / changer le rôle / retirer. Calqué sur AccountShareSection.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../hooks/useAppColors';
import { useCreditMembers, useInviteToCredit, useSetCreditMemberRole, useRemoveCreditMember } from '../hooks/useSharedCredits';
import type { Credit } from '../types/database';

export default function CreditShareSection({ credit }: { credit: Credit }) {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: members = [] } = useCreditMembers(credit.id);
  const invite = useInviteToCredit(credit.id);
  const setRole = useSetCreditMemberRole(credit.id);
  const removeMember = useRemoveCreditMember(credit.id);

  const [code, setCode] = useState('');
  const [role, setRole_] = useState<'write' | 'read'>('read');

  if (credit._role && credit._role !== 'owner') return null; // seul le propriétaire partage

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
          <TouchableOpacity style={styles.removeBtn} onPress={() => confirmRemove(m.id, m.display_name)}>
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
