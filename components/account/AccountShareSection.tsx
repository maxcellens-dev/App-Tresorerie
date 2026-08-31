/**
 * AccountShareSection — gestion du partage d'un compte (owner uniquement).
 * - Inviter un utilisateur par son code public, OU ajouter un membre « simple nom » (externe).
 * - Choisir le rôle : écriture (saisit ses propres transactions) ou consultation (lecture du passé).
 * - Lister / changer le rôle / retirer les membres.
 *
 * Gate : le partage d'un compte PERSO (non joint) est conditionné au flag admin
 * perso_account_sharing_enabled (Soft : si OFF, on masque le formulaire d'invitation mais on garde
 * la gestion des membres déjà partagés). Les comptes JOINTS dédiés ne sont jamais gatés.
 */
import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import AppButton from '../ui/AppButton';
import SegmentedControl from '../ui/SegmentedControl';
import { Ionicons } from '@expo/vector-icons';
import { useAppColors } from '../../hooks/theme/useAppColors';
import { useReadOnlyGuard } from '../../hooks/platform/useReadOnlyGuard';
import { useFeatureFlags } from '../../hooks/config/useFeatureFlags';
import {
  useAccountMembers, useInviteToAccount, useSetMemberRole, useRemoveMember, useRenameMember,
} from '../../hooks/data/useSharedAccounts';
import type { Account } from '../../types/database';

export default function AccountShareSection({ account }: { account: Account }) {
  const COLORS = useAppColors();
  /* Consultation admin : ces écritures portent sur le compte visité et sur l'accès de tiers. */
  const roGuard = useReadOnlyGuard();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { data: flags } = useFeatureFlags();
  const { data: members = [] } = useAccountMembers(account.id);
  const invite = useInviteToAccount(account.id);
  const setRole = useSetMemberRole(account.id);
  const removeMember = useRemoveMember(account.id);
  const rename = useRenameMember(account.id);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [role, setRole_] = useState<'write' | 'read'>('write');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Seul le propriétaire gère le partage.
  if (account._role && account._role !== 'owner') return null;

  const isJoint = !!account.is_joint;
  const sharingAllowed = isJoint || !!flags?.perso_account_sharing_enabled;

  const doInvite = async () => {
    const c = code.trim();
    const n = name.trim();
    if (!c && !n) { Alert.alert('Invitation', 'Saisis un code utilisateur ou un nom.'); return; }
    try {
      await invite.mutateAsync({ code: c || undefined, name: n, role });
      setCode(''); setName('');
    } catch (e: any) {
      Alert.alert('Invitation', e?.message ?? "Impossible d'inviter.");
    }
  };

  /* Ces trois écritures touchent l'ACCÈS de quelqu'un d'autre au compte (retirer, renommer,
     passer de consultation à écriture). Elles étaient muettes en cas d'échec : la liste revenait
     à son état précédent, et on croyait avoir retiré un accès qui était toujours là. */
  const onShareError = (fallback: string) => (e: unknown) =>
    Alert.alert('Un souci', e instanceof Error ? e.message : fallback);

  const confirmRemove = (memberId: string, label: string) => {
    if (roGuard.blocked()) return;
    Alert.alert('Retirer l’accès', `Retirer ${label} de ce compte ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => removeMember.mutate(memberId, { onError: onShareError("L'accès n'a pas pu être retiré.") }) },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Ionicons name="people-outline" size={18} color={COLORS.text} />
        <Text style={styles.title}>{isJoint ? 'Membres du compte joint' : 'Partager ce compte'}</Text>
      </View>

      {/* Liste des membres */}
      {members.length === 0 ? (
        <Text style={styles.empty}>Aucun membre pour l'instant.</Text>
      ) : (
        members.map((m) => (
          <View key={m.id} style={styles.memberRow}>
            <View style={[styles.avatar, { backgroundColor: COLORS.emerald + '1A' }]}>
              <Ionicons name="person" size={15} color={COLORS.emerald} />
            </View>
            <View style={{ flex: 1 }}>
              {editingId === m.id ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, paddingVertical: 6 }]}
                    value={editName}
                    onChangeText={setEditName}
                    autoFocus
                    placeholder="Nom"
                    placeholderTextColor={COLORS.textSecondary}
                  />
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Valider le nouveau nom" onPress={() => { rename.mutate({ memberId: m.id, name: editName }, { onError: onShareError("Le nom n'a pas pu être modifié.") }); setEditingId(null); }}>
                    <Ionicons name="checkmark" size={20} color={COLORS.text} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.memberName} numberOfLines={1}>{m.display_name}</Text>
                  {/* Un membre RÉEL (compte) a un statut + un mode d'accès. Un « simple nom » (user_id null)
                      n'est pas un utilisateur : ni « en attente », ni rôle d'accès — juste un participant. */}
                  <Text style={styles.memberSub}>{m.user_id ? 'Membre' : 'Participant (hors app)'}</Text>
                </>
              )}
            </View>
            {/* Renommer un invité « simple nom » (non inscrit) */}
            {!m.user_id && editingId !== m.id && (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Modifier" style={styles.iconBtn} onPress={() => { setEditingId(m.id); setEditName(m.display_name); }}>
                <Ionicons name="pencil" size={15} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
            {/* Rôle cliquable (écriture/consultation) UNIQUEMENT pour un membre réel : un « simple nom »
                n'accède pas à l'app, il n'a donc pas de mode d'accès. */}
            {m.user_id && (
              <TouchableOpacity
                style={styles.roleBadge}
                onPress={() => setRole.mutate({ memberId: m.id, role: m.role === 'read' ? 'write' : 'read' }, { onError: onShareError("Le mode d'accès n'a pas pu être changé.") })}
                disabled={setRole.isPending}
              >
                <Text style={styles.roleBadgeText}>{m.role === 'read' ? 'Consultation' : 'Écriture'}</Text>
                <Ionicons name="swap-horizontal" size={13} color={COLORS.text} />
              </TouchableOpacity>
            )}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" style={styles.removeBtn} onPress={() => confirmRemove(m.id, m.display_name)}>
              <Ionicons name="close" size={16} color={COLORS.danger} />
            </TouchableOpacity>
          </View>
        ))
      )}

      {/* Formulaire d'invitation (masqué si partage perso désactivé en admin) */}
      {sharingAllowed ? (
        <View style={styles.inviteBox}>
          <Text style={styles.inviteLabel}>Inviter quelqu'un</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="Code utilisateur (depuis son profil)"
            placeholderTextColor={COLORS.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nom (optionnel, ou simple nom externe)"
            placeholderTextColor={COLORS.textSecondary}
          />
          <SegmentedControl
            options={[{ value: 'write', label: 'Écriture' }, { value: 'read', label: 'Consultation' }]}
            value={role}
            onChange={(v) => setRole_(v as 'write' | 'read')}
            role="radio"
            style={{ marginBottom: 10 }}
          />
          <AppButton
            label="Envoyer l'invitation / Ajouter membre"
            loading={invite.isPending}
            onPress={doInvite}
          />
        </View>
      ) : (
        <Text style={styles.disabledNote}>Le partage de comptes perso est actuellement désactivé.</Text>
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    wrap: { marginTop: 8, marginBottom: 20, borderTopWidth: 1, borderTopColor: c.cardBorder, paddingTop: 18 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    empty: { fontSize: 12.5, color: c.textSecondary, marginBottom: 8 },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    memberName: { fontSize: 14, fontWeight: '600', color: c.text },
    memberSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
    roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: c.text + '33', backgroundColor: c.text + '0D' },
    roleBadgeText: { fontSize: 11.5, fontWeight: '700', color: c.text },
    iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.cardBorder },
    removeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.danger + '55' },
    inviteBox: { marginTop: 14, gap: 8 },
    inviteLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: c.text, fontSize: 14 },
    roleRow: { flexDirection: 'row', gap: 8 },
    /* Rôle et bouton d'invitation : `SegmentedControl` + `AppButton`. Le bouton était en `c.text`
       sur `c.bg` — une troisième couleur de bouton, propre à cet écran, qui ne suivait pas
       l'accent. */
    disabledNote: { fontSize: 12, color: c.textSecondary, fontStyle: 'italic', marginTop: 10 },
  });
}
