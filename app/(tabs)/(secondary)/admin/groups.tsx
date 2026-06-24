/**
 * Admin — Groupes d'utilisateurs. Créer/supprimer des groupes custom (visibles admin uniquement) et
 * y affecter des utilisateurs. Sert au ciblage des notifications (écran Notifications).
 * (Premium / Normal existent déjà via profiles.is_premium ; ici ce sont des groupes libres.)
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Pressable } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';

interface Group { id: string; name: string; color: string | null; count: number }
interface UserRow { id: string; full_name: string | null; email: string | null }

export default function AdminGroups() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? false;

  const [newName, setNewName] = useState('');
  const [membersOf, setMembersOf] = useState<Group | null>(null);
  const [search, setSearch] = useState('');

  const { data: groups = [] } = useQuery({
    queryKey: ['user_groups'],
    queryFn: async (): Promise<Group[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('user_groups').select('id, name, color, user_group_members(count)').order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((g: any) => ({ id: g.id, name: g.name, color: g.color, count: g.user_group_members?.[0]?.count ?? 0 }));
    },
    enabled: isAdmin,
  });

  // Liste des utilisateurs (pour affectation) — recherche e-mail / nom.
  const { data: users = [] } = useQuery({
    queryKey: ['admin_users_for_groups'],
    queryFn: async (): Promise<UserRow[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name', { ascending: true }).limit(500);
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
    enabled: isAdmin,
  });

  // Membres du groupe ouvert (set de profile_id).
  const { data: memberIds = [] } = useQuery({
    queryKey: ['group_members', membersOf?.id],
    queryFn: async (): Promise<string[]> => {
      if (!supabase || !membersOf) return [];
      const { data, error } = await supabase.from('user_group_members').select('profile_id').eq('group_id', membersOf.id);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.profile_id);
    },
    enabled: isAdmin && !!membersOf,
  });
  const memberSet = useMemo(() => new Set(memberIds), [memberIds]);

  const createGroup = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const name = newName.trim();
      if (!name) throw new Error('Nom requis');
      const { error } = await supabase.from('user_groups').insert({ name, created_by: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: ['user_groups'] }); },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error('Backend indisponible');
      const { error } = await supabase.from('user_groups').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_groups'] }),
  });

  const toggleMember = useMutation({
    mutationFn: async (u: UserRow) => {
      if (!supabase || !membersOf) throw new Error('Backend indisponible');
      if (memberSet.has(u.id)) {
        const { error } = await supabase.from('user_group_members').delete().eq('group_id', membersOf.id).eq('profile_id', u.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_group_members').insert({ group_id: membersOf.id, profile_id: u.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group_members', membersOf?.id] });
      qc.invalidateQueries({ queryKey: ['user_groups'] });
    },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });

  const confirmDelete = (g: Group) => Alert.alert('Supprimer', `Supprimer le groupe « ${g.name} » ?`, [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Supprimer', style: 'destructive', onPress: () => deleteGroup.mutate(g.id) },
  ]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.full_name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
  }, [users, search]);

  if (!isAdmin) {
    return (
      <View style={styles.root}><StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} /><Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>

        <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          <Text style={styles.title}>Groupes d'utilisateurs</Text>
          <Text style={styles.subtitle}>Crée des groupes et affecte des utilisateurs pour cibler des notifications. « Premium » et « Normal » existent déjà séparément.</Text>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Nouveau groupe</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newName} onChangeText={setNewName} placeholder="Ex. Bêta-testeurs" placeholderTextColor={COLORS.textSecondary} maxLength={40} />
              <TouchableOpacity style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]} onPress={() => createGroup.mutate()} disabled={!newName.trim() || createGroup.isPending}>
                {createGroup.isPending ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Ionicons name="add" size={20} color={COLORS.bg} />}
              </TouchableOpacity>
            </View>
          </View>

          {groups.length === 0 ? (
            <Text style={styles.empty}>Aucun groupe. Créez-en un ci-dessus.</Text>
          ) : (
            groups.map((g) => (
              <View key={g.id} style={styles.groupRow}>
                <View style={[styles.groupIcon, { backgroundColor: COLORS.violet + '22' }]}>
                  <Ionicons name="people" size={16} color={COLORS.violet} />
                </View>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => { setSearch(''); setMembersOf(g); }}>
                  <Text style={styles.groupName}>{g.name}</Text>
                  <Text style={styles.groupMeta}>{g.count} membre{g.count > 1 ? 's' : ''} · appuyez pour gérer</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDelete(g)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </KeyboardAwareScrollView>
      </SafeAreaView>

      {/* Membres d'un groupe */}
      <Modal visible={!!membersOf} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setMembersOf(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMembersOf(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{membersOf?.name}</Text>
              <TouchableOpacity onPress={() => setMembersOf(null)} style={{ padding: 4 }}><Ionicons name="close" size={22} color={COLORS.text} /></TouchableOpacity>
            </View>
            <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Rechercher un utilisateur (nom / e-mail)" placeholderTextColor={COLORS.textSecondary} />
            <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }} style={{ maxHeight: '78%' }}>
              {filteredUsers.map((u) => {
                const inGroup = memberSet.has(u.id);
                return (
                  <TouchableOpacity key={u.id} style={styles.userRow} activeOpacity={0.7} onPress={() => toggleMember.mutate(u)}>
                    <Ionicons name={inGroup ? 'checkbox' : 'square-outline'} size={20} color={inGroup ? COLORS.emerald : COLORS.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.userName} numberOfLines={1}>{u.full_name || '(sans nom)'}</Text>
                      <Text style={styles.userEmail} numberOfLines={1}>{u.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {filteredUsers.length === 0 && <Text style={styles.empty}>Aucun utilisateur.</Text>}
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16, lineHeight: 18 },
    card: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 16 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 8 },
    createBtn: { width: 48, borderRadius: 10, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    empty: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginBottom: 8 },
    groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 14, marginBottom: 10 },
    groupIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    groupName: { fontSize: 15, fontWeight: '700', color: c.text },
    groupMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    text: { color: c.text, padding: 20 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: c.cardBorder },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text, flex: 1 },
    userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    userName: { fontSize: 14, fontWeight: '600', color: c.text },
    userEmail: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  });
}
