/**
 * Admin — Utilisateurs. Recherche par e-mail / nom et passage Premium ⇄ Normal manuel.
 * (Lecture/écriture des profils via les policies admin — migration 052.)
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ScreenGradient from '../../../components/ScreenGradient';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { useAppColors } from '../../../hooks/useAppColors';
import { useNavBack } from '../../../hooks/useNavBack';
import { supabase } from '../../../lib/supabase';

interface AdminUser { id: string; full_name: string | null; email: string | null; is_premium: boolean }

export default function AdminUsers() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const goBack = useNavBack();
  const { user, impersonate } = useAuth();
  const qc = useQueryClient();

  function consult(u: AdminUser) {
    impersonate(u.id, u.email);
    router.replace('/(tabs)/home');
  }
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = useQuery({
    queryKey: ['admin_user_search', query],
    queryFn: async (): Promise<AdminUser[]> => {
      if (!supabase || query.trim().length < 2) return [];
      const q = `%${query.trim()}%`;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_premium')
        .or(`email.ilike.${q},full_name.ilike.${q}`)
        .limit(25);
      if (error) throw error;
      return (data ?? []) as AdminUser[];
    },
    enabled: isAdmin && query.trim().length >= 2,
  });

  async function togglePremium(u: AdminUser) {
    if (!supabase) return;
    setBusyId(u.id);
    try {
      await supabase.from('profiles').update({ is_premium: !u.is_premium }).eq('id', u.id);
      await qc.invalidateQueries({ queryKey: ['admin_user_search', query] });
      if (u.id === user?.id) qc.invalidateQueries({ queryKey: ['profile', user?.id] });
    } finally { setBusyId(null); }
  }

  if (!isAdmin) {
    return <View style={styles.root}><SafeAreaView style={styles.safe} edges={['top']}><Text style={styles.text}>Accès réservé aux administrateurs.</Text></SafeAreaView></View>;
  }

  const results = search.data ?? [];

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} /><Text style={styles.backText}>Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Utilisateurs</Text>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={COLORS.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher par e-mail ou nom…"
            placeholderTextColor={COLORS.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={COLORS.textSecondary} /></TouchableOpacity>
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {query.trim().length < 2 ? (
            <Text style={styles.hint}>Saisissez au moins 2 caractères pour rechercher.</Text>
          ) : search.isLoading ? (
            <ActivityIndicator color={COLORS.emerald} style={{ marginTop: 24 }} />
          ) : results.length === 0 ? (
            <Text style={styles.hint}>Aucun utilisateur trouvé.</Text>
          ) : (
            results.map((u) => (
              <View key={u.id} style={styles.card}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{u.full_name || '—'}</Text>
                  <Text style={styles.email} numberOfLines={1}>{u.email || u.id}</Text>
                  {u.is_premium && <Text style={styles.premiumTag}>★ Premium</Text>}
                </View>
                <View style={styles.actionsCol}>
                  <TouchableOpacity
                    style={[styles.toggleBtn, { backgroundColor: '#f59e0b18', borderColor: '#f59e0b', flexDirection: 'row', alignItems: 'center', gap: 5 }]}
                    onPress={() => consult(u)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="eye-outline" size={14} color="#f59e0b" />
                    <Text style={[styles.toggleText, { color: '#f59e0b' }]}>Consulter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleBtn, { backgroundColor: u.is_premium ? COLORS.danger + '18' : COLORS.emerald + '18', borderColor: u.is_premium ? COLORS.danger : COLORS.emerald }]}
                    onPress={() => togglePremium(u)}
                    disabled={busyId === u.id}
                    activeOpacity={0.85}
                  >
                    {busyId === u.id ? <ActivityIndicator size="small" color={COLORS.emerald} /> : (
                      <Text style={[styles.toggleText, { color: u.is_premium ? COLORS.danger : COLORS.emerald }]}>
                        {u.is_premium ? 'Retirer Premium' : 'Passer Premium'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    backText: { fontSize: 14, fontWeight: '600', color: c.text },
    title: { fontSize: 22, fontWeight: '800', color: c.text, marginBottom: 12 },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
    searchInput: { flex: 1, color: c.text, fontSize: 14, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
    hint: { color: c.textSecondary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14, marginBottom: 10 },
    name: { fontSize: 14, fontWeight: '700', color: c.text },
    email: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
    premiumTag: { fontSize: 11, color: c.yellow, fontWeight: '700', marginTop: 3 },
    actionsCol: { gap: 6, alignItems: 'stretch' },
    toggleBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
    toggleText: { fontSize: 12, fontWeight: '700' },
    text: { color: c.text, padding: 20 },
  });
}
