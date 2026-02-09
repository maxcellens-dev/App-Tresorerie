import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useProfile } from '../../../hooks/useProfile';
import { supabase } from '../../../lib/supabase';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

interface StatsData {
  totalUsers?: number;
  totalAccounts?: number;
  totalTransactions?: number;
  lastUpdated?: string;
}

export default function StatsHub() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const isAdmin = profile?.is_admin ?? user?.email === 'maxcellens@gmail.com';

  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StatsData>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    loadStats();
  }, [isAdmin]);

  async function loadStats() {
    if (!supabase) {
      setMessage('Supabase non configuré');
      setLoading(false);
      return;
    }

    try {
      // Fetch total users
      const { count: usersCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Fetch total accounts
      const { count: accountsCount } = await supabase
        .from('accounts')
        .select('*', { count: 'exact', head: true });

      // Fetch total transactions
      const { count: transactionsCount } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      setStats({
        totalUsers: usersCount || 0,
        totalAccounts: accountsCount || 0,
        totalTransactions: transactionsCount || 0,
        lastUpdated: new Date().toLocaleString('fr-FR'),
      });
    } catch (e) {
      console.warn('Stats load error:', e);
      setMessage('Erreur chargement des statistiques');
    } finally {
      setLoading(false);
    }
  }

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

  if (loading) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={COLORS.emerald} />
          </View>
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

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Stats Hub</Text>
          <Text style={styles.subtitle}>Métriques et activity de l'application.</Text>

          {/* Stat Cards */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Ionicons name="people-outline" size={32} color={COLORS.emerald} style={{ marginBottom: 8 }} />
              <Text style={styles.statValue}>{stats.totalUsers || 0}</Text>
              <Text style={styles.statLabel}>Utilisateurs</Text>
            </View>

            <View style={styles.statCard}>
              <Ionicons name="wallet-outline" size={32} color="#0ea5a8" style={{ marginBottom: 8 }} />
              <Text style={styles.statValue}>{stats.totalAccounts || 0}</Text>
              <Text style={styles.statLabel}>Comptes</Text>
            </View>

            <View style={styles.statCard}>
              <Ionicons name="swap-vertical-outline" size={32} color="#7c3aed" style={{ marginBottom: 8 }} />
              <Text style={styles.statValue}>{stats.totalTransactions || 0}</Text>
              <Text style={styles.statLabel}>Transactions</Text>
            </View>
          </View>

          {/* Last Updated */}
          <View style={styles.card}>
            <Text style={styles.infoLabel}>Dernière mise à jour</Text>
            <Text style={styles.infoValue}>{stats.lastUpdated}</Text>
          </View>

          {/* Refresh Button */}
          <TouchableOpacity style={styles.refreshBtn} onPress={loadStats}>
            <Ionicons name="refresh-outline" size={18} color={COLORS.bg} style={{ marginRight: 6 }} />
            <Text style={styles.refreshLabel}>Actualiser</Text>
          </TouchableOpacity>

          {message && <Text style={styles.error}>{message}</Text>}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  backLabel: { fontSize: 16, color: COLORS.text, marginLeft: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24, lineHeight: 20 },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 24, flexWrap: 'wrap' },
  statCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { fontSize: 20, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  card: { backgroundColor: COLORS.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 20 },
  infoLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  infoValue: { fontSize: 14, color: COLORS.text },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.emerald, paddingVertical: 12, borderRadius: 8 },
  refreshLabel: { color: COLORS.bg, fontWeight: '700', fontSize: 16 },
  error: { marginTop: 14, fontSize: 13, color: '#ef4444', textAlign: 'center' },
  text: { color: COLORS.text },
});
