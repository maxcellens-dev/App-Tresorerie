import { useState, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl } from 'react-native';
import ScreenGradient from '../../components/ScreenGradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useAccounts, useArchivedAccounts } from '../../hooks/useAccounts';
import { ACCOUNT_ICONS } from '../../theme/colors';
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

  // Couleur par type de compte, pilotée par les couleurs sémantiques (réactif au Style Editor).
  const accountColor = (type: string) =>
    type === 'savings' ? COLORS.savings
    : type === 'investment' ? COLORS.investment
    : type === 'checking' ? COLORS.checking
    : COLORS.textSecondary;

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

  // Formatage du total : partie entière + centimes séparés
  const totalFormatted = (() => {
    const abs = Math.abs(total);
    const [int, dec] = abs.toFixed(2).split('.');
    const intFmt = Number(int).toLocaleString('fr-FR');
    return { sign: total < 0 ? '-' : '', int: intFmt, dec };
  })();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScreenGradient />
      <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
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
          {/* ── Hero : solde total ── */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Total liquidités</Text>
            <View style={styles.heroAmountRow}>
              <Text style={styles.heroAmount}>
                {totalFormatted.sign}{totalFormatted.int}
                <Text style={styles.heroDec}>,{totalFormatted.dec} {CURRENCY_SYMBOL}</Text>
              </Text>
            </View>

            {/* Quick actions */}
            <View style={styles.quickActions}>
              <TouchableOpacity
                ref={addBtnRef}
                style={styles.quickBtn}
                activeOpacity={0.75}
                onPress={() => router.push('/(tabs)/comptes/add')}
              >
                <View style={styles.quickIcon}>
                  <Ionicons name="add" size={22} color={COLORS.emerald} />
                </View>
                <Text style={styles.quickLabel}>Compte</Text>
              </TouchableOpacity>
              <TouchableOpacity
                ref={transferBtnRef}
                style={styles.quickBtn}
                activeOpacity={0.75}
                onPress={() => router.push('/(tabs)/comptes/transfer')}
              >
                <View style={styles.quickIcon}>
                  <Ionicons name="swap-horizontal" size={20} color={COLORS.emerald} />
                </View>
                <Text style={styles.quickLabel}>Virement</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Banner de bienvenue */}
          {welcome === '1' && !welcomeDismissed && (
            <View style={styles.welcomeBanner}>
              <View style={styles.welcomeBannerRow}>
                <Text style={styles.welcomeBannerEmoji}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeBannerTitle}>Bienvenue ! Votre profil est créé.</Text>
                  <Text style={styles.welcomeBannerText}>
                    Commencez par ajouter vos comptes bancaires, d'épargne et d'investissement.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setWelcomeDismissed(true)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.welcomeBannerBtn}
                onPress={() => { setWelcomeDismissed(true); router.push('/(tabs)/comptes/add'); }}
              >
                <Ionicons name="add" size={16} color={COLORS.bg} />
                <Text style={styles.welcomeBannerBtnLabel}>Ajouter mon premier compte</Text>
              </TouchableOpacity>
            </View>
          )}

          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
          ) : accounts.length === 0 ? (
            <Text style={styles.empty}>Aucun compte. Appuyez sur « Compte » pour commencer.</Text>
          ) : (
            /* ── Liste Revolut ── */
            <View style={styles.accountList}>
              {sortedAccounts.map((acc, idx) => {
                const color = accountColor(acc.type);
                const iconName = ACCOUNT_ICONS[acc.type] ?? 'cash-outline';
                const isLast = idx === sortedAccounts.length - 1;
                return (
                  <TouchableOpacity
                    key={acc.id}
                    style={[styles.accountRow, !isLast && styles.accountRowBorder]}
                    onPress={() => router.push(`/(tabs)/comptes/${acc.id}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    {/* Icône circulaire */}
                    <View style={[styles.accountIconCircle, { backgroundColor: color + '1A' }]}>
                      <Ionicons name={iconName as any} size={18} color={color} />
                    </View>
                    {/* Nom + type */}
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{acc.name}</Text>
                      <Text style={styles.accountType}>{TYPE_LABELS[acc.type] ?? acc.type}</Text>
                    </View>
                    {/* Solde */}
                    <View style={styles.accountBalanceWrap}>
                      <Text style={styles.accountBalance}>
                        {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} style={{ marginTop: 2 }} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {archivedAccounts.length > 0 && (
            <View style={styles.archivedSection}>
              <Text style={styles.archivedTitle}>Comptes archivés</Text>
              <Text style={styles.archivedHint}>Comptes fermés — non utilisables pour de nouvelles opérations.</Text>
              <View style={styles.accountList}>
                {archivedAccounts.map((acc, idx) => (
                  <View key={acc.id} style={[styles.accountRow, idx < archivedAccounts.length - 1 && styles.accountRowBorder, { opacity: 0.55 }]}>
                    <View style={[styles.accountIconCircle, { backgroundColor: COLORS.cardBorder }]}>
                      <Ionicons name="archive-outline" size={16} color={COLORS.textSecondary} />
                    </View>
                    <View style={styles.accountInfo}>
                      <Text style={[styles.accountName, { color: COLORS.textSecondary }]}>{acc.name}</Text>
                      <Text style={styles.accountType}>{TYPE_LABELS[acc.type] ?? acc.type} · Archivé</Text>
                    </View>
                    <Text style={[styles.accountBalance, { color: COLORS.textSecondary }]}>
                      {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {CURRENCY_SYMBOL}
                    </Text>
                  </View>
                ))}
              </View>
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
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  loader: { marginVertical: 40 },

  // ── Hero ──
  hero: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
  },
  heroLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: c.textSecondary,
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  heroAmountRow: { flexDirection: 'row', alignItems: 'flex-end' },
  heroAmount: {
    fontSize: 44,
    fontWeight: '700',
    color: c.text,
    letterSpacing: -1,
    lineHeight: 52,
  },
  heroDec: {
    fontSize: 26,
    fontWeight: '600',
    color: c.textSecondary,
    lineHeight: 44,
  },

  // ── Quick actions ──
  quickActions: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
  quickBtn: {
    alignItems: 'center',
    gap: 7,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.emerald + '22',
  },
  quickLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

  // ── Liste comptes ──
  accountList: {
    marginHorizontal: 16,
    backgroundColor: c.card,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 24,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  accountRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: c.cardBorder,
  },
  accountIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  accountInfo: { flex: 1, gap: 2 },
  accountName: { fontSize: 15, fontWeight: '600', color: c.text },
  accountType: { fontSize: 12, color: c.textSecondary },
  accountBalanceWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  accountBalance: { fontSize: 15, fontWeight: '600', color: c.text },

  // ── Empty ──
  empty: {
    marginHorizontal: 24,
    padding: 32,
    color: c.textSecondary,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Archivés ──
  archivedSection: { marginTop: 8, marginBottom: 16 },
  archivedTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 4, marginLeft: 24 },
  archivedHint: { fontSize: 12, color: c.textSecondary, marginBottom: 10, marginLeft: 24 },

  // ── Hint bas de page ──
  hint: { marginTop: 8, marginBottom: 16, fontSize: 13, color: c.textSecondary, textAlign: 'center' },

  // ── Bienvenue ──
  welcomeBanner: {
    marginHorizontal: 16,
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.emerald + '40',
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  welcomeBannerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  welcomeBannerEmoji: { fontSize: 28 },
  welcomeBannerTitle: { fontSize: 15, fontWeight: '700', color: c.emerald, marginBottom: 4 },
  welcomeBannerText: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  welcomeBannerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.emerald, borderRadius: 14, paddingVertical: 12,
  },
  welcomeBannerBtnLabel: { fontSize: 14, fontWeight: '700', color: c.bg },
});
}
