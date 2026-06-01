import { useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts, useArchivedAccounts } from '../../hooks/useAccounts';
import { accountColor, ACCOUNT_ICONS } from '../../theme/colors';
import GuideOverlay from '../../components/GuideOverlay';
import type { BubbleStep } from '../../components/GuideOverlay';
import { useScreenGuide } from '../../hooks/useScreenGuide';
import { useAppColors } from '../../hooks/useAppColors';
import { CURRENCY_SYMBOL } from '../../lib/currency';


const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

export default function AccountsListScreen() {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const { user } = useAuth();
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const accountsQuery = useAccounts(user?.id);
  const archivedQuery = useArchivedAccounts(user?.id);

  // ── Guide "bulles" ──
  const guide = useScreenGuide('comptes', user?.id);
  const addBtnRef = useRef<any>(null);
  const transferBtnRef = useRef<any>(null);

  const GUIDE_STEPS: BubbleStep[] = [
    {
      getRef: () => addBtnRef,
      icon: 'add-circle',
      iconColor: '#34d399',
      title: '+ Compte',
      description: 'Ajoutez tous vos comptes : courant, épargne (Livret A, LDDS…) et investissement. C\'est la base du pilotage.',
    },
    {
      getRef: () => transferBtnRef,
      icon: 'swap-horizontal',
      iconColor: '#60a5fa',
      title: 'Virement',
      description: 'Transférez de l\'argent entre vos propres comptes. Le virement est tracé dans les deux comptes automatiquement.',
    },
  ];
  
  const { data: accounts = [], isLoading } = accountsQuery;
  const { data: archivedAccounts = [] } = archivedQuery;

  const TYPE_ORDER: Record<string, number> = { checking: 0, savings: 1, investment: 2, other: 3 };
  const sortedAccounts = useMemo(() =>
    [...accounts].sort((a, b) => {
      const typeA = TYPE_ORDER[a.type] ?? 4;
      const typeB = TYPE_ORDER[b.type] ?? 4;
      if (typeA !== typeB) return typeA - typeB;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    }),
    [accounts]
  );

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
              ref={addBtnRef}
              style={styles.addBtn}
              activeOpacity={0.8}
              onPress={() => router.push('/(tabs)/comptes/add')}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={24} color={COLORS.emerald} />
              <Text style={[styles.addBtnLabel, { color: COLORS.emerald }]}>Compte</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              ref={transferBtnRef}
              style={styles.addBtn}
              activeOpacity={0.8}
              onPress={() => router.push('/(tabs)/comptes/transfer')}
              accessibilityRole="button"
            >
              <Ionicons name="swap-horizontal" size={22} color="#60a5fa" />
              <Text style={[styles.addBtnLabel, { color: '#60a5fa' }]}>Virement</Text>
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
          {/* Banner de bienvenue — premier lancement après questionnaire */}
          {welcome === '1' && !welcomeDismissed && (
            <View style={styles.welcomeBanner}>
              <View style={styles.welcomeBannerRow}>
                <Text style={styles.welcomeBannerEmoji}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeBannerTitle}>Bienvenue ! Votre profil est créé.</Text>
                  <Text style={styles.welcomeBannerText}>
                    Commencez par ajouter vos comptes bancaires, d'épargne et d'investissement pour que l'application puisse calculer vos recommandations.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setWelcomeDismissed(true)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={18} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.welcomeBannerBtn}
                onPress={() => { setWelcomeDismissed(true); router.push('/(tabs)/comptes/add'); }}
              >
                <Ionicons name="add" size={16} color="#020617" />
                <Text style={styles.welcomeBannerBtnLabel}>Ajouter mon premier compte</Text>
              </TouchableOpacity>
            </View>
          )}

          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
          ) : (
            <>
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Total liquidités</Text>
                <Text style={styles.totalAmount}>{total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}</Text>
              </View>
              {accounts.length === 0 ? (
                <Text style={styles.empty}>Aucun compte. Ajoutez un compte pour suivre vos soldes.</Text>
              ) : (
                sortedAccounts.map((acc) => {
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
                          {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
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
                      {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
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

      <GuideOverlay
        visible={guide.visible}
        steps={GUIDE_STEPS}
        currentStep={guide.step}
        onNext={() => guide.goNext(GUIDE_STEPS.length)}
        onSkip={guide.skip}
        screenTitle="Comptes"
      />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  addBtnLabel: { fontSize: 14, fontWeight: '600', color: c.text },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },
  totalCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 20,
    marginBottom: 16,
  },
  totalLabel: { fontSize: 13, color: c.textSecondary, marginBottom: 4 },
  totalAmount: { fontSize: 28, fontWeight: '800', color: c.emerald },
  accountCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 16,
    marginBottom: 12,
  },
  accountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountName: { fontSize: 16, fontWeight: '600', color: c.text },
  accountBalance: { fontSize: 16, fontWeight: '700', color: c.text },
  accountType: { fontSize: 12, color: c.textSecondary, marginTop: 4 },
  empty: { padding: 24, color: c.textSecondary, textAlign: 'center', marginBottom: 16 },
  archivedSection: { marginTop: 24, marginBottom: 16 },
  archivedTitle: { fontSize: 15, fontWeight: '700', color: c.textSecondary, marginBottom: 6 },
  archivedHint: { fontSize: 12, color: c.textSecondary, marginBottom: 12 },
  archivedCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.cardBorder,
    padding: 16,
    marginBottom: 12,
    opacity: 0.85,
  },
  archivedName: { fontSize: 16, fontWeight: '600', color: c.textSecondary },
  archivedBalance: { fontSize: 14, color: c.textSecondary },
  hint: { marginTop: 16, fontSize: 13, color: c.textSecondary, textAlign: 'center' },
  welcomeBanner: {
    backgroundColor: '#0d2318', borderRadius: 16, borderWidth: 1,
    borderColor: '#34d39940', padding: 16, marginBottom: 16, gap: 12,
  },
  welcomeBannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  welcomeBannerEmoji: { fontSize: 28 },
  welcomeBannerTitle: { fontSize: 15, fontWeight: '700', color: '#34d399', marginBottom: 4 },
  welcomeBannerText: { fontSize: 13, color: '#cbd5e1', lineHeight: 18 },
  welcomeBannerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#34d399', borderRadius: 12, paddingVertical: 12,
  },
  welcomeBannerBtnLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
});
}
