/**
 * Admin — Utilisateurs (page unique, 3 onglets) :
 *  • Utilisateurs : recherche + passage Premium ⇄ Normal + « Consulter » (impersonation).
 *  • Groupes : groupes custom pour cibler les notifications (créer / supprimer / affecter des membres).
 *  • Inactifs : lister les inactifs (≥ 1 / 6 / 12 / 15 mois) OU rechercher n'importe quel compte
 *    (actif ou non), puis SUPPRIMER la sélection (compte + données) — DOUBLE confirmation, et la
 *    liste des noms concernés à l'écran de confirmation.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Platform, Alert, Modal, Pressable } from 'react-native';
import KeyboardAwareScrollView from '../../../../components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/ScreenHeader';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ScreenGradient from '../../../../components/ScreenGradient';
import { useAuth } from '../../../../contexts/AuthContext';
import { useProfile } from '../../../../hooks/useProfile';
import { useAppColors } from '../../../../hooks/useAppColors';
import { useNavBack } from '../../../../hooks/useNavBack';
import { useResponsive } from '../../../../hooks/useResponsive';
import { pageColumn } from '../../../../lib/webLayout';
import { supabase } from '../../../../lib/supabase';
import { sheetWidth } from '../../../../lib/appLayout';
import { useInactiveUsers, useAdminUserSearch, useDeleteUsers, useAuthOrphans, type InactiveUser } from '../../../../hooks/useInactiveUsers';

type Tab = 'users' | 'groups' | 'inactive';

export default function AdminUsers() {
  const COLORS = useAppColors();
  const s = useMemo(() => makeStyles(COLORS), [COLORS]);
  const goBack = useNavBack();
  const { isDesktop } = useResponsive(); // web bureau : colonne centrée, comme les autres pages admin
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin === true;
  const [tab, setTab] = useState<Tab>('users');

  if (!isAdmin) {
    return <View style={s.root}><ScreenGradient /><SafeAreaView style={[s.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}><ScreenHeader title="Utilisateurs" onBack={goBack} /><Text style={s.text}>Accès réservé aux administrateurs.</Text></SafeAreaView></View>;
  }

  return (
    <View style={s.root}>
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <SafeAreaView style={[s.safe, pageColumn(isDesktop, 'dashboard')]} edges={['left', 'right', 'bottom']}>
        <ScreenHeader title="Utilisateurs" onBack={goBack} />

        <View style={s.tabs}>
          {([['users', 'Utilisateurs'], ['groups', 'Groupes'], ['inactive', 'Inactifs']] as [Tab, string][]).map(([k, lbl]) => (
            <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)}>
              <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'users' && <UsersPanel COLORS={COLORS} s={s} />}
        {tab === 'groups' && <GroupsPanel COLORS={COLORS} s={s} userId={user?.id} />}
        {tab === 'inactive' && <InactivePanel COLORS={COLORS} s={s} />}
      </SafeAreaView>
    </View>
  );
}

/* ══════════════ Onglet UTILISATEURS ══════════════ */
interface AdminUser { id: string; full_name: string | null; email: string | null; is_premium: boolean }
function UsersPanel({ COLORS, s }: { COLORS: any; s: any }) {
  const router = useRouter();
  const { user, impersonate } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['admin_user_search', query],
    queryFn: async (): Promise<AdminUser[]> => {
      if (!supabase || query.trim().length < 2) return [];
      const q = `%${query.trim()}%`;
      const { data, error } = await supabase.from('profiles').select('id, full_name, email, is_premium').or(`email.ilike.${q},full_name.ilike.${q}`).limit(25);
      if (error) throw error;
      return (data ?? []) as AdminUser[];
    },
    enabled: query.trim().length >= 2,
  });

  async function togglePremium(u: AdminUser) {
    if (!supabase) return;
    setBusyId(u.id);
    try {
      const next = !u.is_premium;
      await supabase.from('profiles').update({ is_premium: next, premium_manual: next }).eq('id', u.id);
      await qc.invalidateQueries({ queryKey: ['admin_user_search', query] });
      if (u.id === user?.id) qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    } finally { setBusyId(null); }
  }
  const consult = (u: AdminUser) => { impersonate(u.id, u.email); router.replace('/(tabs)/pilotage'); };

  const results = search.data ?? [];
  return (
    <>
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Rechercher par e-mail ou nom…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false} />
        {query.length > 0 && <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={COLORS.textSecondary} /></TouchableOpacity>}
      </View>
      <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        <AuthOrphans COLORS={COLORS} s={s} />
        {query.trim().length < 2 ? <Text style={s.hint}>Saisissez au moins 2 caractères pour rechercher.</Text>
          : search.isLoading ? <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} />
          : results.length === 0 ? <Text style={s.hint}>Aucun utilisateur trouvé.</Text>
          : results.map((u) => (
            <View key={u.id} style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{u.full_name || '—'}</Text>
                <Text style={s.email} numberOfLines={1}>{u.email || u.id}</Text>
                {u.is_premium && <Text style={s.premiumTag}>★ Premium</Text>}
              </View>
              <View style={s.actionsCol}>
                <TouchableOpacity style={[s.toggleBtn, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b', flexDirection: 'row', alignItems: 'center', gap: 5 }]} onPress={() => consult(u)} activeOpacity={0.85}>
                  <Ionicons name="eye-outline" size={14} color="#f59e0b" /><Text style={[s.toggleText, { color: '#f59e0b' }]}>Consulter</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.toggleBtn, { backgroundColor: u.is_premium ? COLORS.danger + '18' : COLORS.emerald + '18', borderColor: u.is_premium ? COLORS.danger : COLORS.emerald }]} onPress={() => togglePremium(u)} disabled={busyId === u.id} activeOpacity={0.85}>
                  {busyId === u.id ? <ActivityIndicator size="small" color={COLORS.emerald} /> : <Text style={[s.toggleText, { color: u.is_premium ? COLORS.danger : COLORS.emerald }]}>{u.is_premium ? 'Retirer Premium' : 'Passer Premium'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
      </KeyboardAwareScrollView>
    </>
  );
}

/**
 * Comptes d'authentification SANS profil — invisibles partout ailleurs (tous les écrans d'admin
 * partent de `profiles`). C'est ce qui rendait indéchiffrable « il a créé, supprimé, recréé son
 * compte, et je ne le vois plus » : on ne pouvait pas distinguer un compte réellement supprimé
 * d'une inscription restée en plan. Rien à signaler → le bloc ne s'affiche pas.
 */
function AuthOrphans({ COLORS, s }: { COLORS: any; s: any }) {
  const { data: orphans = [] } = useAuthOrphans(true);
  if (orphans.length === 0) return null;
  const fmt = (d: string) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); };
  return (
    <View style={[s.card, { flexDirection: 'column', alignItems: 'stretch', borderColor: COLORS.yellow + '66', backgroundColor: COLORS.yellow + '10' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Ionicons name="warning-outline" size={18} color={COLORS.yellow} />
        <Text style={[s.name, { color: COLORS.yellow }]}>{orphans.length} compte(s) sans profil</Text>
      </View>
      <Text style={[s.email, { marginBottom: 8 }]}>
        Inscrits côté authentification, absents de « profiles ». « Non confirmé » = l’e-mail de
        vérification n’a jamais été ouvert, l’inscription n’est pas allée au bout.
      </Text>
      {orphans.slice(0, 10).map((o) => (
        <Text key={o.id} style={s.since} numberOfLines={1}>
          • {o.email || o.id} — créé le {fmt(o.created_at)} — {o.confirmed_at ? 'confirmé' : 'NON confirmé'}
        </Text>
      ))}
      {orphans.length > 10 && <Text style={s.since}>…et {orphans.length - 10} autre(s)</Text>}
    </View>
  );
}

/* ══════════════ Onglet GROUPES ══════════════ */
interface Group { id: string; name: string; color: string | null; count: number }
interface UserRow { id: string; full_name: string | null; email: string | null }
function GroupsPanel({ COLORS, s, userId }: { COLORS: any; s: any; userId: string | undefined }) {
  const qc = useQueryClient();
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
  });
  const { data: users = [] } = useQuery({
    queryKey: ['admin_users_for_groups'],
    queryFn: async (): Promise<UserRow[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from('profiles').select('id, full_name, email').order('full_name', { ascending: true }).limit(500);
      if (error) throw error;
      return (data ?? []) as UserRow[];
    },
  });
  const { data: memberIds = [] } = useQuery({
    queryKey: ['group_members', membersOf?.id],
    queryFn: async (): Promise<string[]> => {
      if (!supabase || !membersOf) return [];
      const { data, error } = await supabase.from('user_group_members').select('profile_id').eq('group_id', membersOf.id);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.profile_id);
    },
    enabled: !!membersOf,
  });
  const memberSet = useMemo(() => new Set(memberIds), [memberIds]);

  const createGroup = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Backend indisponible');
      const name = newName.trim(); if (!name) throw new Error('Nom requis');
      const { error } = await supabase.from('user_groups').insert({ name, created_by: userId ?? null });
      if (error) throw error;
    },
    onSuccess: () => { setNewName(''); qc.invalidateQueries({ queryKey: ['user_groups'] }); },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });
  const deleteGroup = useMutation({
    mutationFn: async (id: string) => { if (!supabase) throw new Error('Backend indisponible'); const { error } = await supabase.from('user_groups').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_groups'] }),
  });
  const toggleMember = useMutation({
    mutationFn: async (u: UserRow) => {
      if (!supabase || !membersOf) throw new Error('Backend indisponible');
      if (memberSet.has(u.id)) { const { error } = await supabase.from('user_group_members').delete().eq('group_id', membersOf.id).eq('profile_id', u.id); if (error) throw error; }
      else { const { error } = await supabase.from('user_group_members').insert({ group_id: membersOf.id, profile_id: u.id }); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['group_members', membersOf?.id] }); qc.invalidateQueries({ queryKey: ['user_groups'] }); },
    onError: (e: any) => Alert.alert('Erreur', e?.message ?? 'Échec'),
  });
  const confirmDeleteGroup = (g: Group) => Alert.alert('Supprimer', `Supprimer le groupe « ${g.name} » ?`, [
    { text: 'Annuler', style: 'cancel' }, { text: 'Supprimer', style: 'destructive', onPress: () => deleteGroup.mutate(g.id) },
  ]);
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => (u.full_name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q));
  }, [users, search]);

  return (
    <>
      <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <Text style={s.subtitle}>Crée des groupes et affecte des utilisateurs pour cibler des notifications. « Premium » et « Normal » existent déjà séparément.</Text>
        <View style={s.groupCard}>
          <Text style={s.fieldLabel}>Nouveau groupe</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[s.input, { flex: 1 }]} value={newName} onChangeText={setNewName} placeholder="Ex. Bêta-testeurs" placeholderTextColor={COLORS.textSecondary} maxLength={40} />
            <TouchableOpacity style={[s.createBtn, !newName.trim() && { opacity: 0.5 }]} onPress={() => createGroup.mutate()} disabled={!newName.trim() || createGroup.isPending}>
              {createGroup.isPending ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Ionicons name="add" size={20} color={COLORS.bg} />}
            </TouchableOpacity>
          </View>
        </View>
        {groups.length === 0 ? <Text style={s.empty}>Aucun groupe. Créez-en un ci-dessus.</Text>
          : groups.map((g) => (
            <View key={g.id} style={s.groupRow}>
              <View style={[s.groupIcon, { backgroundColor: COLORS.violet + '22' }]}><Ionicons name="people" size={16} color={COLORS.violet} /></View>
              <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => { setSearch(''); setMembersOf(g); }}>
                <Text style={s.groupName}>{g.name}</Text>
                <Text style={s.groupMeta}>{g.count} membre{g.count > 1 ? 's' : ''} · appuyez pour gérer</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDeleteGroup(g)} hitSlop={8}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
            </View>
          ))}
      </KeyboardAwareScrollView>

      <Modal visible={!!membersOf} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setMembersOf(null)}>
        <Pressable style={s.modalOverlay} onPress={() => setMembersOf(null)}>
          <Pressable style={s.modalSheet} onPress={() => {}}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle} numberOfLines={1}>{membersOf?.name}</Text>
              <TouchableOpacity onPress={() => setMembersOf(null)} style={{ padding: 4 }}><Ionicons name="close" size={22} color={COLORS.text} /></TouchableOpacity>
            </View>
            <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="Rechercher un utilisateur (nom / e-mail)" placeholderTextColor={COLORS.textSecondary} />
            <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }} style={{ maxHeight: '78%' }}>
              {filteredUsers.map((u) => {
                const inGroup = memberSet.has(u.id);
                return (
                  <TouchableOpacity key={u.id} style={s.userRow} activeOpacity={0.7} onPress={() => toggleMember.mutate(u)}>
                    <Ionicons name={inGroup ? 'checkbox' : 'square-outline'} size={20} color={inGroup ? COLORS.emerald : COLORS.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.userName} numberOfLines={1}>{u.full_name || '(sans nom)'}</Text>
                      <Text style={s.userEmail} numberOfLines={1}>{u.email}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {filteredUsers.length === 0 && <Text style={s.empty}>Aucun utilisateur.</Text>}
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* ══════════════ Onglet INACTIFS ══════════════
   Deux façons d'alimenter la même liste à cocher :
    • le SEUIL d'inactivité (+1 / 6 / 12 / 15 mois) — la purge de masse ;
    • la RECHERCHE par nom ou e-mail, qui porte sur TOUS les comptes, actifs ou non — pour viser
      quelqu'un de précis (compte de test, doublon, demande de suppression).
   Les deux modes partagent la sélection, la double confirmation et le bouton de suppression, mais
   PAS le pré-cochage : une liste d'inactifs arrive tout cochée (c'est son but), une recherche
   arrive vide (cocher d'office des comptes ACTIFS serait une invitation à l'accident). */
const MONTH_OPTIONS = [1, 6, 12, 15];
/* Tableau vide PARTAGÉ : `data = []` en valeur par défaut fabriquerait un nouveau tableau à chaque
   rendu tant que la requête n'a pas répondu (chargement… ou erreur). Cette identité changeante
   relançait l'effet de pré-cochage ci-dessous, qui pose un `new Set()` — toujours une nouvelle
   valeur d'état — donc un nouveau rendu, donc un nouveau tableau : boucle infinie. Sur mobile,
   où la RPC met plus longtemps à répondre, l'onglet figeait l'app jusqu'à la fermer. */
const NO_USERS: InactiveUser[] = [];
function InactivePanel({ COLORS, s }: { COLORS: any; s: any }) {
  const [months, setMonths] = useState(6);
  const [query, setQuery] = useState('');
  const searching = query.trim().length >= 2;

  const { data: inactiveData, isLoading: inactiveLoading, error: inactiveError } = useInactiveUsers(months, true);
  const { data: foundData, isLoading: searchLoading, error: searchError } = useAdminUserSearch(query, searching);
  const inactiveList = inactiveData ?? NO_USERS;
  const found = foundData ?? NO_USERS;
  const del = useDeleteUsers();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = searching ? found : inactiveList;
  const isLoading = searching ? searchLoading : inactiveLoading;
  // Une RPC en échec renvoie une liste vide : sans ça, l'écran annonçait « aucun inactif 🎉 ».
  const error = searching ? searchError : inactiveError;

  // Inactifs : tout coché (resynchronisé au changement de seuil / après purge). Recherche : rien.
  useEffect(() => {
    setSelected(searching ? new Set() : new Set(inactiveList.map((u) => u.id)));
  }, [searching, inactiveList]);

  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  /* On ne supprime QUE ce qui est à l'écran : sans ça, cocher quelqu'un puis affiner la recherche
     laissait une sélection invisible partir avec le lot. */
  const visible = useMemo(() => list.filter((u) => selected.has(u.id)), [list, selected]);
  const allChecked = list.length > 0 && visible.length === list.length;

  const fmtSince = (u: InactiveUser) => {
    const d = u.last_active ?? u.created_at;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return `${u.last_active ? 'vu' : 'créé'} le ${dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  };
  const nameOf = (u: InactiveUser) => u.full_name || u.email || u.id;

  const doDelete = () => {
    del.mutate(visible.map((u) => u.id), {
      onSuccess: (r) => Alert.alert('Terminé', `${r.deleted} compte(s) supprimé(s)${r.skipped ? `, ${r.skipped} ignoré(s) (admin/soi)` : ''}.`),
      onError: (e: any) => Alert.alert('Échec', e?.message ?? 'Erreur'),
    });
  };
  const confirmDelete = () => {
    const n = visible.length;
    if (n === 0) return;
    // On NOMME qui va disparaître : sur une recherche, la sélection peut viser un compte actif.
    const who = visible.slice(0, 5).map((u) => `• ${nameOf(u)}`).join('\n') + (n > 5 ? `\n• …et ${n - 5} autre(s)` : '');
    Alert.alert(`Supprimer ${n} utilisateur(s) ?`, `${who}\n\nLeur compte ET TOUTES leurs données seront supprimés définitivement. Action IRRÉVERSIBLE.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Continuer', style: 'destructive', onPress: () => Alert.alert('Confirmation finale', `Dernière vérification : ${n} compte(s) vont être effacés pour toujours.`, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer définitivement', style: 'destructive', onPress: doDelete },
      ]) },
    ]);
  };

  return (
    <>
      <View style={s.searchBox}>
        <Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput
          style={s.searchInput} value={query} onChangeText={setQuery}
          placeholder="Rechercher un compte à supprimer (nom ou e-mail)…"
          placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" autoCorrect={false}
        />
        {query.length > 0 && <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={COLORS.textSecondary} /></TouchableOpacity>}
      </View>

      {/* Le seuil d'inactivité n'a plus de sens pendant une recherche : elle balaie tout le monde. */}
      {!searching && (
        <View style={s.chipRow}>
          {MONTH_OPTIONS.map((m) => (
            <TouchableOpacity key={m} style={[s.chip, months === m && s.chipOn]} onPress={() => setMonths(m)}>
              <Text style={[s.chipTxt, months === m && s.chipTxtOn]}>+{m} mois</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={s.selRow}>
        <Text style={s.selCount}>
          {searching
            ? `${list.length} résultat${list.length > 1 ? 's' : ''} · ${visible.length} sélectionné${visible.length > 1 ? 's' : ''}`
            : `${list.length} inactif${list.length > 1 ? 's' : ''} · ${visible.length} sélectionné${visible.length > 1 ? 's' : ''}`}
        </Text>
        {list.length > 0 && (
          <TouchableOpacity onPress={() => setSelected(allChecked ? new Set() : new Set(list.map((u) => u.id)))}>
            <Text style={s.selAll}>{allChecked ? 'Tout décocher' : 'Tout cocher'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAwareScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {isLoading ? <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} />
          : error ? <Text style={[s.hint, { color: COLORS.danger }]}>Impossible de charger la liste : {(error as any)?.message ?? 'erreur inconnue'}</Text>
          : list.length === 0 ? (
            <Text style={s.hint}>
              {searching ? `Aucun compte ne correspond à « ${query.trim()} ».` : `Aucun utilisateur inactif depuis +${months} mois. 🎉`}
            </Text>
          )
          : list.map((u) => {
            const checked = selected.has(u.id);
            return (
              <TouchableOpacity key={u.id} style={s.card} activeOpacity={0.7} onPress={() => toggle(u.id)}>
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? COLORS.danger : COLORS.textSecondary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.name} numberOfLines={1}>{u.full_name || u.email || '(sans nom)'}</Text>
                  <Text style={s.email} numberOfLines={1}>{u.email || u.id}</Text>
                  <Text style={s.since}>Dernière activité : {fmtSince(u)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        {searching && (
          <Text style={s.hint}>Ta recherche porte sur tous les comptes, actifs ou non. Les admins et ton propre compte n’y figurent jamais.</Text>
        )}
      </KeyboardAwareScrollView>

      {list.length > 0 && (
        <TouchableOpacity style={[s.deleteBtn, (visible.length === 0 || del.isPending) && { opacity: 0.5 }]} onPress={confirmDelete} disabled={visible.length === 0 || del.isPending}>
          {del.isPending ? <ActivityIndicator color="#fff" /> : (
            <><Ionicons name="trash" size={18} color="#fff" /><Text style={s.deleteTxt}>Supprimer {visible.length} compte{visible.length > 1 ? 's' : ''} + données</Text></>
          )}
        </TouchableOpacity>
      )}
    </>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    text: { color: c.text, padding: 20 },

    tabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
    tab: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder, alignItems: 'center', backgroundColor: c.card },
    tabOn: { backgroundColor: c.emerald, borderColor: c.emerald },
    tabTxt: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
    tabTxtOn: { color: c.bg },

    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
    searchInput: { flex: 1, color: c.text, fontSize: 14, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hint: { color: c.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 14, lineHeight: 18 },

    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    name: { fontSize: 14, fontWeight: '700', color: c.text },
    email: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    since: { fontSize: 11, color: c.textSecondary, marginTop: 3 },
    premiumTag: { fontSize: 11, color: c.yellow, fontWeight: '700', marginTop: 3 },
    actionsCol: { gap: 6, alignItems: 'stretch' },
    toggleBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
    toggleText: { fontSize: 12, fontWeight: '700' },

    // Groupes
    groupCard: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 16, marginBottom: 16 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    input: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, marginBottom: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    createBtn: { width: 48, borderRadius: 10, backgroundColor: c.emerald, alignItems: 'center', justifyContent: 'center' },
    empty: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginBottom: 8 },
    groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, padding: 14, marginBottom: 10 },
    groupIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    groupName: { fontSize: 15, fontWeight: '700', color: c.text },
    groupMeta: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { ...sheetWidth, backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '88%', borderWidth: 1, borderColor: c.cardBorder },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    modalTitle: { fontSize: 18, fontWeight: '800', color: c.text, flex: 1 },
    userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: c.cardBorder },
    userName: { fontSize: 14, fontWeight: '600', color: c.text },
    userEmail: { fontSize: 12, color: c.textSecondary, marginTop: 1 },

    // Inactifs
    chipRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.cardBorder, backgroundColor: c.card },
    chipOn: { backgroundColor: c.danger, borderColor: c.danger },
    chipTxt: { fontSize: 13, fontWeight: '700', color: c.text },
    chipTxtOn: { color: '#fff' },
    selRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    selCount: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600' },
    selAll: { fontSize: 12.5, color: c.emerald, fontWeight: '700' },
    deleteBtn: { position: 'absolute', left: 0, right: 0, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.danger, borderRadius: 12, paddingVertical: 15 },
    deleteTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
}
