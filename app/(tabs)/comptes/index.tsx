import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts, useArchivedAccounts } from '../../hooks/useAccounts';
import { accountColor, ACCOUNT_ICONS } from '../../theme/colors';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

export default function AccountsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const accountsQuery = useAccounts(user?.id);
  const archivedQuery = useArchivedAccounts(user?.id);
  
  const { data: accounts = [], isLoading } = accountsQuery;
  const { data: archivedAccounts = [] } = archivedQuery;

  const total = accounts.reduce((s, a) => s + a.balance, 0);
  
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        accountsQuery.refetch?.(),
        archivedQuery.refetch?.(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.addBtn}
              activeOpacity={0.8}
              onPress={() => router.push('/(tabs)/comptes/add')}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={24} color={COLORS.text} />
              <Text style={styles.addBtnLabel}>Compte</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.addBtn}
              activeOpacity={0.8}
              onPress={() => router.push('/(tabs)/comptes/transfer')}
              accessibilityRole="button"
            >
              <Ionicons name="swap-horizontal" size={22} color={COLORS.text} />
              <Text style={styles.addBtnLabel}>Virement</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.emerald}
              progressBackgroundColor={COLORS.card}
            />
          }
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
          ) : (
            <>
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Total liquidités</Text>
                <Text style={styles.totalAmount}>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</Text>
              </View>
              {accounts.length === 0 ? (
                <Text style={styles.empty}>Aucun compte. Ajoutez un compte pour suivre vos soldes.</Text>
              ) : (
                accounts.map((acc) => {
                  const color = accountColor(acc.type);
                  const iconName = ACCOUNT_ICONS[acc.type] ?? 'cash-outline';
                  return (
                    <TouchableOpacity
                      key={acc.id}
                      style={[styles.accountCard, { borderLeftWidth: 3, borderLeftColor: color }]}
                      onPress={() => router.push(`/(tabs)/comptes/${acc.id}`)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                    >
                      <View style={styles.accountRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Ionicons name={iconName as any} size={16} color={color} />
                          <Text style={styles.accountName}>{acc.name}</Text>
                        </View>
                        <Text style={[styles.accountBalance, { color }]}>
                          {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {acc.currency}
                        </Text>
                      </View>
                      <Text style={styles.accountType}>{TYPE_LABELS[acc.type] ?? acc.type}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </>
          )}
          {archivedAccounts.length > 0 && (
            <View style={styles.archivedSection}>
              <Text style={styles.archivedTitle}>Comptes archivés</Text>
              <Text style={styles.archivedHint}>Comptes fermés, non utilisables pour virements ou nouvelles transactions.</Text>
              {archivedAccounts.map((acc) => (
                <View key={acc.id} style={styles.archivedCard}>
                  <View style={styles.accountRow}>
                    <Text style={styles.archivedName}>{acc.name}</Text>
                    <Text style={styles.archivedBalance}>
                      {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {acc.currency}
                    </Text>
                  </View>
                  <Text style={styles.accountType}>{TYPE_LABELS[acc.type] ?? acc.type} · Archivé</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={styles.hint}>Ajoutez un compte pour suivre vos soldes et faire des virements.</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },
  totalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 20,
    marginBottom: 16,
  },
  totalLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 },
  totalAmount: { fontSize: 28, fontWeight: '800', color: COLORS.emerald },
  accountCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountName: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  accountBalance: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  accountType: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  empty: { padding: 24, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 16 },
  archivedSection: { marginTop: 24, marginBottom: 16 },
  archivedTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 6 },
  archivedHint: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 },
  archivedCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    padding: 16,
    marginBottom: 12,
    opacity: 0.85,
  },
  archivedName: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary },
  archivedBalance: { fontSize: 14, color: COLORS.textSecondary },
  hint: { marginTop: 16, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
});
