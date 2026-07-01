import { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, DeviceEventEmitter } from 'react-native';
import { COMPTES_TAB_PRESSED } from '../../../components/CustomTabBar';
import ScreenGradient from '../../../components/ScreenGradient';
import OnboardingHintBanner from '../../../components/OnboardingHintBanner';
import AdSlot from '../../../components/AdSlot';
import { tabBarRect, headerProfileRect } from '../../../lib/tourTargets';
import { useOnbHighlight, onbGlow } from '../../../lib/onbHighlight';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts, useArchivedAccounts } from '../../../hooks/useAccounts';
import { useAccountInvitations, useRespondAccountInvitation } from '../../../hooks/useSharedAccounts';
import { ACCOUNT_ICONS } from '../../../theme/colors';
import { semanticText } from '../../../theme/palette';
import GuideOverlay from '../../../components/GuideOverlay';
import CreditsTab from '../../../components/CreditsTab';
import type { BubbleStep } from '../../../components/GuideOverlay';
import { useScreenGuide } from '../../../hooks/useScreenGuide';
import { useAppColors } from '../../../hooks/useAppColors';
import { currencySymbolFor, convertAmount } from '../../../lib/currency';
import { useCurrencyRates } from '../../../hooks/useCurrencyRates';
import { useProfile } from '../../../hooks/useProfile';
import { useAccountsTotalsFilter } from '../../../hooks/useUiPrefs';
import { useSavingsConfig, SAVINGS_DEFAULTS } from '../../../hooks/useSavingsConfig';


const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

export default function AccountsListScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const onbAccount = useOnbHighlight('account_initialized');
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const { welcome } = useLocalSearchParams<{ welcome?: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const accountsQuery = useAllAccounts(user?.id);
  const archivedQuery = useArchivedAccounts(user?.id);
  const { data: acctInvitations = [] } = useAccountInvitations(user?.id);
  const respondInvite = useRespondAccountInvitation(user?.id);
  // Choix du type de compte à la création (comme les projets) : personnel ou partagé/joint.
  const [showCreateType, setShowCreateType] = useState(false);
  // #6 — onglets de la page : « Comptes » (actuel) / « Crédits » (module crédit).
  const [tab, setTab] = useState<'comptes' | 'credits'>('comptes');
  // Retaper l'onglet « Comptes » du menu → toujours revenir au sous-onglet « Comptes » (pas « Crédits »).
  // Le retour-arrière depuis un détail crédit passe par router.back → ne déclenche pas ce reset.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(COMPTES_TAB_PRESSED, () => setTab('comptes'));
    return () => sub.remove();
  }, []);
  const openCreate = (joint: boolean) => { setShowCreateType(false); router.push(`/(tabs)/comptes/add${joint ? '?joint=1' : ''}` as any); };

  // ── Guide "bulles" ──
  const insets = useSafeAreaInsets();
  const guide = useScreenGuide('comptes', user?.id);
  const scrollRef = useRef<ScrollView>(null);
  const addBtnRef = useRef<any>(null);
  const transferBtnRef = useRef<any>(null);
  const actionsRef = useRef<any>(null);

  const GUIDE_STEPS: BubbleStep[] = [
    {
      getRef: () => actionsRef,
      icon: 'add-circle',
      iconColor: COLORS.green,
      title: 'Commence ici',
      description: 'Ajoute tes comptes (courant, épargne, investissement) avec leur solde réel du jour.\n\nUn « Virement » déplace de l\'argent d\'un compte à l\'autre.',
    },
    {
      getRect: () => tabBarRect(),
      icon: 'apps',
      iconColor: COLORS.green,
      title: 'Ta navigation',
      description: 'La barre du bas réunit tout l\'essentiel : Comptes, Transactions, Pilotage, Projets et Projection.',
    },
    {
      getRect: () => headerProfileRect(insets.top),
      icon: 'person-circle',
      iconColor: COLORS.green,
      title: 'Ton menu',
      description: 'En haut à droite : ton profil, tes réglages, ton abonnement et l\'assistance. \n\nTout est là.',
    },
  ];
  
  const { data: allAccounts = [], isLoading } = accountsQuery;
  const { data: archivedAccounts = [] } = archivedQuery;

  // Comptes PERSO (mon argent : owner + non joint) vs comptes PARTAGÉS (joints + reçus d'autres users).
  // Les totaux/agrégats ne portent QUE sur les comptes perso (décision : les partagés/joints n'impactent
  // pas mes finances). Les comptes partagés s'affichent dans une section dédiée.
  const accounts = allAccounts.filter((a) => a._role === 'owner' && !a.is_joint);
  const sharedAccounts = allAccounts.filter((a) => a._role !== 'owner' || a.is_joint);

  const TYPE_ORDER: Record<string, number> = { checking: 0, savings: 1, investment: 2, other: 3 };
  const sortAccts = (list: typeof allAccounts) =>
    [...list].sort((a, b) => {
      const typeA = TYPE_ORDER[a.type] ?? 4;
      const typeB = TYPE_ORDER[b.type] ?? 4;
      if (typeA !== typeB) return typeA - typeB;
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
  const sharedSorted = useMemo(() => sortAccts(sharedAccounts), [allAccounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortedAccounts = useMemo(() =>
    sortAccts(accounts),
    [accounts]
  );

  // Couleur par type de compte, pilotée par les couleurs sémantiques (réactif au Style Editor).
  const accountColor = (type: string) =>
    type === 'savings' ? COLORS.savings
    : type === 'investment' ? COLORS.investment
    : type === 'checking' ? COLORS.checking
    : COLORS.textSecondary;

  // ── Multi-devises : chaque compte garde sa devise ; les AGRÉGATS sont convertis dans la devise
  // de référence de l'utilisateur (profiles.currency_code). « ≈ » si plusieurs devises en jeu.
  const { data: profile } = useProfile(user?.id);
  const { data: rates = { EUR: 1 } } = useCurrencyRates();
  const { data: savingsCfg = SAVINGS_DEFAULTS } = useSavingsConfig();
  const refCode = profile?.currency_code ?? 'EUR';
  const refSymbol = currencySymbolFor(refCode);
  const mixedCurrencies = new Set(accounts.map((a) => a.currency || 'EUR')).size > 1;
  // Taux manquant → on garde la valeur brute (rare ; agrégat alors indicatif).
  const toRef = (a: { balance: number; currency?: string }) =>
    convertAmount(Number(a.balance), a.currency || 'EUR', refCode, rates) ?? Number(a.balance);
  // #5 — Dans les AGRÉGATS (patrimoine, total liquidités), un compte partagé compte à hauteur de mon %
  // d'impact (la LISTE garde le solde réel par compte). _impact_pct = undefined → 100% (compte perso).
  const impactFactor = (a: any) => (a._impact_pct != null ? a._impact_pct / 100 : 1);
  const toRefWeighted = (a: any) => toRef(a) * impactFactor(a);
  // #2 — Filtre persistant des totaux : tout / perso / partagés.
  const { filter: totalsFilter, setFilter: setTotalsFilter } = useAccountsTotalsFilter(user?.id);
  const isShared = (a: any) => !!a.is_joint || a._role !== 'owner';
  const matchesFilter = (a: any) => totalsFilter === 'all' ? true : (totalsFilter === 'shared' ? isShared(a) : !isShared(a));
  const sumRef = (filter: (a: any) => boolean) => accounts.filter((a) => matchesFilter(a) && filter(a)).reduce((s, a) => s + toRefWeighted(a), 0);

  const total = accounts.filter(matchesFilter).reduce((s, a) => s + toRefWeighted(a), 0);
  const totalChecking = sumRef((a) => a.type === 'checking');
  const totalSavings = sumRef((a) => a.type === 'savings');
  const totalInvested = sumRef((a) => a.type === 'investment');
  const approx = mixedCurrencies ? '≈ ' : '';

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
      <StatusBar style={COLORS.mode === 'light' ? 'dark' : 'light'} />
      <ScreenGradient />
      <OnboardingHintBanner />
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <ScrollView
          ref={scrollRef}
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
          {/* ── Vue d'ensemble patrimoine (avant le total) ── */}
          {/* Décorrélé de pilotageData : les totaux viennent des comptes (convertis en référence). */}
          {accounts.length > 0 && (
            <View>
            <View style={styles.overviewHeaderRow}>
              <Text style={styles.overviewTitle}>Patrimoine</Text>
              {/* #2 — filtre persistant des totaux (visible s'il y a des comptes partagés) */}
              {accounts.some(isShared) && (
                <View style={styles.totalsFilterRow}>
                  {(['all', 'perso', 'shared'] as const).map((f) => (
                    <TouchableOpacity key={f} onPress={() => setTotalsFilter(f)} style={[styles.totalsFilterChip, totalsFilter === f && styles.totalsFilterChipActive]}>
                      <Text style={[styles.totalsFilterText, totalsFilter === f && styles.totalsFilterTextActive]}>{f === 'all' ? 'Tout' : f === 'perso' ? 'Perso' : 'Partagés'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.overviewRow}>
              {(() => {
                // Agrégats convertis dans la devise de référence (multi-devises).
                // Seuils du profil (en devise de référence), configurables ; défauts sinon.
                const s = totalSavings;
                // Seuils stockés en EUR (base, config admin globale) → convertis dans la devise de
                // référence pour être comparés à l'épargne (elle-même convertie). Ref = EUR → neutre.
                // Une valeur personnalisée sur le profil utilisateur reste prioritaire.
                const toRefAmount = (v: number) => convertAmount(v, 'EUR', refCode, rates) ?? v;
                const thMin = toRefAmount((profile as any)?.safety_threshold_min ?? savingsCfg.min);
                const thOpt = toRefAmount((profile as any)?.safety_threshold_optimal ?? savingsCfg.optimal);
                const thComf = toRefAmount((profile as any)?.safety_threshold_comfort ?? savingsCfg.comfort);
                const sCol = s < thMin ? COLORS.danger : s < thOpt ? COLORS.orange : COLORS.savings;
                const sKw = s < thMin ? savingsCfg.label_critical : s < thOpt ? savingsCfg.label_low : s < thComf ? savingsCfg.label_healthy : savingsCfg.label_comfort;
                return [
                  { label: 'Courant', value: totalChecking, color: COLORS.checking, icon: 'wallet-outline', sub: null },
                  { label: 'Épargne', value: s, color: sCol, icon: 'leaf-outline', sub: sKw },
                  { label: 'Investi', value: totalInvested, color: COLORS.investment, icon: 'trending-up-outline', sub: null },
                ].map((item) => (
                  <View key={item.label} style={[styles.overviewCard, { borderLeftColor: item.color }]}>
                    <Ionicons name={item.icon as any} size={14} color={item.color} style={{ marginBottom: 2 }} />
                    <Text style={styles.overviewLabel}>{item.label}</Text>
                    <Text style={[styles.overviewValue, { color: semanticText(item.color, COLORS) }]}>
                      {approx}{item.value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {refSymbol}
                    </Text>
                    {item.sub && <Text style={[styles.overviewSub, { color: semanticText(item.color, COLORS) }]}>{item.sub}</Text>}
                  </View>
                ));
              })()}
            </View>
            {/* #6c — Total liquidités : petit, aligné à droite, SANS libellé (sous la vue d'ensemble). */}
            <Text style={styles.totalLiquidSmall}>
              {approx}{totalFormatted.sign}{totalFormatted.int},{totalFormatted.dec} {refSymbol}
            </Text>
            </View>
          )}

          {/* ── Onglets Comptes / Crédits (#6b : à la place de l'ancien « Total Liquidités ») ── */}
          <View style={styles.tabsRow}>
            {(['comptes', 'credits'] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.tabItem, tab === t && styles.tabItemActive]} onPress={() => setTab(t)} activeOpacity={0.8} accessibilityRole="button">
                <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>{t === 'comptes' ? 'Comptes' : 'Crédits'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'credits' ? (
            <CreditsTab userId={user?.id} />
          ) : (
          <>
          {/* ── Actions rapides du compte ── */}
          <View style={styles.hero}>

            {/* Quick actions + zone pub compacte (maison) à droite, gérable en admin */}
            <View style={styles.quickActions}>
              <View style={styles.quickBtnGroup} ref={actionsRef}>
                <TouchableOpacity
                  ref={addBtnRef}
                  style={styles.quickBtn}
                  activeOpacity={0.75}
                  onPress={() => setShowCreateType(true)}
                >
                  <View style={styles.quickIcon}>
                    <Ionicons name="add" size={22} color={COLORS.emerald} />
                  </View>
                  <Text style={styles.quickLabel}>Créer Compte</Text>
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
              <AdSlot placement="comptes_actions" compact style={{ marginLeft: 16 }} />
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
                onPress={() => { setWelcomeDismissed(true); setShowCreateType(true); }}
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
            <View style={[styles.accountList, onbAccount ? onbGlow(COLORS, true) : null]}>
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
                      <Text style={[styles.accountBalance, acc.balance < 0 && { color: COLORS.danger }]}>
                        {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} style={{ marginTop: 2 }} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* ── Comptes partagés (joints + reçus d'autres utilisateurs) ── */}
          {(sharedSorted.length > 0 || acctInvitations.length > 0) && (
            <View style={{ marginTop: 18 }}>
              <Text style={styles.overviewTitle}>Comptes partagés</Text>
              {sharedSorted.length > 0 && (
              <View style={styles.accountList}>
                {sharedSorted.map((acc, idx) => {
                  const color = accountColor(acc.type);
                  const iconName = ACCOUNT_ICONS[acc.type] ?? 'cash-outline';
                  const isLast = idx === sharedSorted.length - 1;
                  const tag = acc.is_joint ? 'Joint' : acc._role === 'read' ? 'Consultation' : 'Écriture';
                  return (
                    <TouchableOpacity
                      key={acc.id}
                      style={[styles.accountRow, !isLast && styles.accountRowBorder]}
                      onPress={() => router.push(`/(tabs)/comptes/${acc.id}`)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                    >
                      <View style={[styles.accountIconCircle, { backgroundColor: color + '1A' }]}>
                        <Ionicons name={(acc.is_joint ? 'people' : iconName) as any} size={18} color={color} />
                      </View>
                      <View style={styles.accountInfo}>
                        <Text style={styles.accountName}>{acc.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.accountType}>{TYPE_LABELS[acc.type] ?? acc.type}</Text>
                          <View style={styles.sharedTag}><Text style={styles.sharedTagText}>{tag}</Text></View>
                        </View>
                      </View>
                      <View style={styles.accountBalanceWrap}>
                        <Text style={[styles.accountBalance, acc.balance < 0 && { color: COLORS.danger }]}>
                          {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                        </Text>
                        <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} style={{ marginTop: 2 }} />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              )}
              {/* Invitations en attente — sous les comptes partagés (la section apparaît même sans
                  compte partagé tant qu'il y a une invitation, et disparaît une fois traitée). */}
              {acctInvitations.map((inv) => (
                <View key={inv.invite_id} style={[styles.inviteCard, { marginTop: 8 }]}>
                  <View style={[styles.accountIconCircle, { backgroundColor: COLORS.emerald + '1A' }]}>
                    <Ionicons name={inv.is_joint ? 'people-outline' : 'wallet-outline'} size={18} color={COLORS.emerald} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteName} numberOfLines={1}>{inv.account_name}</Text>
                    <Text style={styles.inviteSub} numberOfLines={1}>
                      {inv.from_name} t'invite · {inv.is_joint ? 'compte joint' : 'compte partagé'} · {inv.role === 'read' ? 'consultation' : 'écriture'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.inviteDecline}
                    onPress={() => respondInvite.mutate({ inviteId: inv.invite_id, accept: false })}
                    disabled={respondInvite.isPending || isImpersonating}
                    accessibilityRole="button"
                  >
                    <Ionicons name="close" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.inviteAccept}
                    onPress={() => respondInvite.mutate({ inviteId: inv.invite_id, accept: true })}
                    disabled={respondInvite.isPending || isImpersonating}
                    accessibilityRole="button"
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {archivedAccounts.length > 0 && (
            <View style={styles.archivedSection}>
              {/* En-tête repliable : masqué tant qu'il n'y a aucun compte archivé (cf. guard ci-dessus). */}
              <TouchableOpacity
                style={styles.archivedHeader}
                onPress={() => setArchivedExpanded((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Ionicons name={archivedExpanded ? 'chevron-down' : 'chevron-forward'} size={16} color={COLORS.textSecondary} />
                <Text style={styles.archivedTitle}>Archivés ({archivedAccounts.length})</Text>
              </TouchableOpacity>
              {archivedExpanded && (
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
                        {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
          <Text style={styles.hint}>Ajoutez un compte pour suivre vos soldes et faire des virements.</Text>

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <View style={{ paddingHorizontal: 16 }}>
            <AdSlot placement="comptes" />
          </View>
          </>
          )}
        </ScrollView>
      </SafeAreaView>

      <GuideOverlay
        visible={guide.visible}
        steps={GUIDE_STEPS}
        currentStep={guide.step}
        onNext={() => guide.goNext(GUIDE_STEPS.length)}
        onSkip={guide.skip}
        scrollRef={scrollRef}
        screenTitle="Comptes"
      />

      {/* Choix du type de compte — MÊME forme que le modal « Quel type de projet ? » */}
      <Modal visible={showCreateType} transparent animationType="fade" onRequestClose={() => setShowCreateType(false)}>
        <TouchableOpacity style={styles.createOverlay} activeOpacity={1} onPress={() => setShowCreateType(false)}>
          <TouchableOpacity style={styles.createCard} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.createTitle}>Quel type de compte ?</Text>
            <TouchableOpacity style={styles.createOpt} onPress={() => openCreate(false)} activeOpacity={0.85}>
              <View style={[styles.createOptIcon, { backgroundColor: COLORS.emerald + '22' }]}>
                <Ionicons name="person" size={22} color={COLORS.emerald} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createOptTitle}>Personnel</Text>
                <Text style={styles.createOptSub}>Un compte à toi (courant, épargne, investissement…)</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.createOpt} onPress={() => openCreate(true)} activeOpacity={0.85}>
              <View style={[styles.createOptIcon, { backgroundColor: '#3b82f6' + '22' }]}>
                <Ionicons name="people" size={22} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.createOptTitle}>Partagé (joint)</Text>
                <Text style={styles.createOptSub}>Partagé avec d'autres utilisateurs. Tu enverras les invitations après création.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
  overviewTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary, paddingHorizontal: 24, marginBottom: 8, marginTop: 4 },
  overviewHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  totalLiquidSmall: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'right', paddingHorizontal: 24, marginTop: 6 },
  tabsRow: { flexDirection: 'row', gap: 22, paddingHorizontal: 24, marginTop: 14, marginBottom: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.cardBorder },
  tabItem: { paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive: { borderBottomColor: c.text },
  tabLabel: { fontSize: 17, fontWeight: '700', color: c.textSecondary },
  tabLabelActive: { color: c.text, fontWeight: '800' },
  totalsFilterRow: { flexDirection: 'row', gap: 4, marginBottom: 8, marginTop: 4 },
  totalsFilterChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: c.cardBorder },
  totalsFilterChipActive: { backgroundColor: c.text + '12', borderColor: c.text },
  totalsFilterText: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  totalsFilterTextActive: { color: c.text, fontWeight: '700' },
  overviewRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginBottom: 0 },
  overviewCard: { flex: 1, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, borderLeftWidth: 3, padding: 10 },
  overviewLabel: { fontSize: 10, fontWeight: '600', color: c.textSecondary, marginBottom: 2 },
  overviewValue: { fontSize: 13, fontWeight: '800', lineHeight: 17 },
  overviewSub: { fontSize: 9, fontWeight: '700', marginTop: 1 },

  // ── Hero ──
  hero: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 20,
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
    alignItems: 'center',
    marginTop: 24,
  },
  quickBtnGroup: {
    flexDirection: 'row',
    gap: 16,
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
  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.emerald + '55',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  inviteName: { fontSize: 14.5, fontWeight: '700', color: c.text },
  inviteSub: { fontSize: 11.5, color: c.textSecondary, marginTop: 1 },
  inviteDecline: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.danger + '55' },
  inviteAccept: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: c.emerald },
  sharedTag: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 6, backgroundColor: c.emerald + '1A', borderWidth: 1, borderColor: c.emerald + '44' },
  sharedTagText: { fontSize: 10, fontWeight: '700', color: c.emerald },
  createOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 22 },
  createCard: { width: '100%', maxWidth: 380, backgroundColor: c.cardSolid ?? c.card, borderRadius: 20, borderWidth: 1, borderColor: c.cardBorder, padding: 20, gap: 12 },
  createTitle: { fontSize: 18, fontWeight: '800', color: c.text },
  createOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderWidth: 1, borderColor: c.cardBorder, borderRadius: 14, padding: 14 },
  createOptIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  createOptTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  createOptSub: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
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
  archivedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginLeft: 24, marginBottom: 4 },
  archivedTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary },

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
