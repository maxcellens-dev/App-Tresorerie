import { useState, useMemo, useRef, useEffect } from 'react';
import { withDeferredMount } from '../../../hooks/platform/useDeferredMount';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl, Modal, DeviceEventEmitter, Alert } from 'react-native';
import { COMPTES_TAB_PRESSED } from '../../../components/layout/CustomTabBar';
import ScreenGradient from '../../../components/layout/ScreenGradient';
import AppButton from '../../../components/ui/AppButton';
import PageTabs from '../../../components/ui/PageTabs';
import { useAlignedTabsTop } from '../../../lib/ui/tabsAlign';
import CalculatorButton from '../../../components/transaction/CalculatorButton';
import OnboardingHintBanner from '../../../components/onboarding/OnboardingHintBanner';
import AdSlot from '../../../components/marketing/AdSlot';
import { useOnbHighlight, onbGlow } from '../../../lib/engagement/onbHighlight';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../../contexts/AuthContext';
import { useAllAccounts, useArchivedAccounts, useReactivateAccount } from '../../../hooks/data/useAccounts';
import { useAccountInvitations, useRespondAccountInvitation } from '../../../hooks/data/useSharedAccounts';
import { ACCOUNT_ICONS } from '../../../theme/colors';
import { semanticText } from '../../../theme/palette';
import GuideModal from '../../../components/guide/GuideModal';
import QuickAccountsModal from '../../../components/account/QuickAccountsModal';
import { useGuide } from '../../../contexts/GuideContext';
import { useIsFocused } from 'expo-router';
import CreditsTab from '../../../components/credit/CreditsTab';
import { useAppColors } from '../../../hooks/theme/useAppColors';
import { currencySymbolFor, convertAmount } from '../../../lib/finance/currency';
import { computeAccountTotals, isSharedAccount } from '../../../lib/finance/accountTotals';
import { useCurrencyRates } from '../../../hooks/data/useCurrencyRates';
import { useProfile } from '../../../hooks/data/useProfile';
import { useAccountsTotalsFilter } from '../../../hooks/config/useUiPrefs';
import { useSavingsConfig, SAVINGS_DEFAULTS } from '../../../hooks/config/useSavingsConfig';
import StaggerIn from '../../../components/layout/StaggerIn';
import { useResponsive } from '../../../hooks/theme/useResponsive';
import { contentWidth, hoverRow } from '../../../lib/ui/webLayout';


const TYPE_LABELS: Record<string, string> = {
  checking: 'Courant',
  savings: 'Épargne',
  investment: 'Investissement',
  other: 'Autre',
};

function AccountsListScreen() {
  const COLORS = useAppColors();
  const styles = useMemo(() => makeStyles(COLORS), [COLORS]);
  const { isDesktop } = useResponsive(); // web bureau : colonne de lecture centrée + survol souris
  const onbAccount = useOnbHighlight('account_initialized');
  const router = useRouter();
  const { user, isImpersonating } = useAuth();
  const { welcome, adAction, adNonce } = useLocalSearchParams<{ welcome?: string; adAction?: string; adNonce?: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const accountsQuery = useAllAccounts(user?.id);
  const archivedQuery = useArchivedAccounts(user?.id);
  const { data: acctInvitations = [] } = useAccountInvitations(user?.id);
  const respondInvite = useRespondAccountInvitation(user?.id);
  /* Réouverture d'un compte archivé. Confirmée : rouvrir remet le compte dans les totaux, les
     virements et la saisie — ce n'est pas anodin, et le message le dit. */
  const reactivate = useReactivateAccount(user?.id);
  const confirmReopen = (acc: { id: string; name: string }) => {
    Alert.alert(
      'Rouvrir ce compte',
      `« ${acc.name} » redeviendra un compte actif : son solde recomptera dans tes totaux, et il sera de nouveau proposé à la saisie et aux virements.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Rouvrir',
          onPress: () => reactivate.mutate(acc.id, {
            // Le cas le plus probable : un compte actif porte déjà ce nom. Il faut le DIRE.
            onError: (e: unknown) => Alert.alert('Un souci', e instanceof Error ? e.message : 'Impossible de rouvrir ce compte.'),
          }),
        },
      ],
    );
  };
  /* Répondre à une invitation était MUET en cas d'échec : la carte restait à l'écran, sans un mot.
     On retouchait « Accepter », toujours rien — impossible de savoir si l'invitation était expirée,
     déjà traitée ailleurs, ou si c'était le réseau. */
  const onInviteError = (e: unknown) =>
    Alert.alert('Un souci', e instanceof Error ? e.message : "L'invitation n'a pas pu être traitée. Réessaie dans un instant.");

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

  // Bannière interne ciblant un bouton de cette page (« Créer Compte », onglet « Crédits »,
  // « Ajouter un crédit »). `adNonce` change à chaque clic → l'action rejoue même si l'on est
  // déjà sur la page. Le signal est relayé à CreditsTab, qui possède sa modale de création.
  const [creditCreateSignal, setCreditCreateSignal] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (adAction === 'new-account') setShowCreateType(true);
    else if (adAction === 'credits') setTab('credits');
    else if (adAction === 'credit-new') { setTab('credits'); setCreditCreateSignal(adNonce ?? 'go'); }
  }, [adAction, adNonce]);

  // ── Guide "bulles" ──
  // Chaque étape ne fait que NOMMER l'élément à mettre en avant (`highlightKey`) : c'est le bouton
  // lui-même qui trace sa bordure (<GuideRing>), il n'y a donc AUCUNE position à mesurer ni estimer.
  // `placement` place la bulle en haut ou en bas, sans jamais recouvrir la cible.
  const scrollRef = useRef<ScrollView>(null);
  const actionsRef = useRef<any>(null); // ancre de la bulle « Commence ici » (posée juste dessous)

  
  /* ── Guide utilisateur (démarrage) ────────────────────────────────────────────────────────────
     La page Comptes est la 1ʳᵉ étape concrète : sans compte, aucun chiffre de l'app n'a de sens.
     Tant qu'aucun compte n'existe, le modal REVIENT — il ne se ferme que par une création réelle. */
  const guide = useGuide();
  const focused = useIsFocused();
  const [quickAccounts, setQuickAccounts] = useState(false);
  const askingAccount = focused && guide.active
    && (guide.is('accounts') || guide.is('accounts_checking') || guide.is('accounts_savings'));

  const overviewRef = useRef<View>(null);
  const tabsRef = useRef<View>(null);


  const { data: allAccounts = [], isLoading } = accountsQuery;
  const { data: archivedAccounts = [] } = archivedQuery;

  /* Comptes PERSO (mon argent : owner + non joint) vs comptes PARTAGÉS (joints + reçus d'autres users).
     Ces deux listes servent aux SECTIONS de la page. Les TOTAUX, eux, portent sur `allAccounts`
     (cf. plus bas) : c'est le filtre Tout / Perso / Partagés qui décide du périmètre. */
  const accounts = allAccounts.filter((a) => a._role === 'owner' && !a.is_joint);
  const sharedAccounts = allAccounts.filter((a) => a._role !== 'owner' || a.is_joint);

  // Le tri (compte principal → type → nom) est appliqué À LA SOURCE par useAllAccounts
  // (lib/accountOrder) : les deux listes filtrées ci-dessus conservent cet ordre.
  const sharedSorted = sharedAccounts;
  const sortedAccounts = accounts;

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
  // Taux manquant → on garde la valeur brute (rare ; agrégat alors indicatif).
  const toRef = (a: { balance: number; currency?: string }) =>
    convertAmount(Number(a.balance), a.currency || 'EUR', refCode, rates) ?? Number(a.balance);
  // #2 — Filtre persistant des totaux : tout / perso / partagés.
  const { filter: totalsFilter, setFilter: setTotalsFilter } = useAccountsTotalsFilter(user?.id);
  /* ⚠️ Le périmètre des totaux est `allAccounts`, PAS `accounts`.
     `accounts` vaut `allAccounts.filter(owner && !is_joint)` : aucun de ses éléments ne peut donc
     être « partagé ». Conséquences en chaîne, toutes silencieuses :
       • la condition d'affichage des puces (`accounts.some(isShared)`) était toujours FAUSSE — le
         filtre Tout / Perso / Partagés, sa préférence persistée comprise, n'a jamais été visible ;
       • s'il l'avait été, « Partagés » aurait affiché 0 € et « Tout » n'aurait montré que le perso ;
       • la pondération par % d'impact (#5, migration 103) ne s'appliquait à rien, puisqu'elle
         n'existe que pour les comptes partagés.
     C'est le FILTRE qui découpe le périmètre ; les listes de la page, elles, gardent leurs deux
     sections séparées.
     Le calcul lui-même vit dans lib/finance/accountTotals — testé, avec pour règle que la somme des
     cartes rendues égale le total affiché juste en dessous (le type « Autre » y compris). */
  const totalScope = allAccounts;

  /* Alignement des onglets avec ceux de la page Budget : chaque page mesure ce qu'elle place
     au-dessus des siens et complète jusqu'au plus haut des deux (cf. lib/ui/tabsAlign). Sans
     `totalScope`, la vue d'ensemble n'est pas rendue — la hauteur au-dessus est alors nulle. */
  const [aboveTabsH, setAboveTabsH] = useState<number | null>(null);
  const tabsTopPad = useAlignedTabsTop('accounts', totalScope.length > 0 ? aboveTabsH : 0);
  const T = computeAccountTotals(totalScope as any, totalsFilter, (v: number, cur: string) => toRef({ balance: v, currency: cur }));
  const activeFilter = T.appliedFilter;
  const hasSharedAccounts = totalScope.some(isSharedAccount as any);
  const total = T.total;
  const totalChecking = T.checking;
  const totalSavings = T.savings;
  const totalInvested = T.investment;
  const totalOther = T.other;
  const hasOther = T.hasOther;
  const approx = T.mixedCurrencies ? '≈ ' : '';

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
          contentContainerStyle={[styles.scrollContent, contentWidth(isDesktop, 'list'), isDesktop && styles.scrollContentDesktop]}
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
          {/* Question du profil progressif — la 1ʳᵉ visite des Comptes est un déclencheur sûr. */}

          {/* ── Totaux par type de compte (courant / épargne / investi / autre) ──
              Décorrélé de pilotageData : les totaux viennent des comptes (convertis en référence).
              `totalScope` : un utilisateur qui n'a QUE des comptes partagés a droit à sa vue d'ensemble. */}
          {/* La hauteur de ce bloc est MESURÉE : c'est ce que la page place au-dessus de ses
              onglets, et c'est sur elle que la page Budget se cale pour que les deux rangées
              d'onglets tombent au même endroit (cf. lib/ui/tabsAlign). Elle varie selon les
              données — trois ou quatre cartes de totaux, filtre présent ou non — d'où la mesure
              plutôt qu'une constante. */}
          {totalScope.length > 0 && (
            <View
              ref={overviewRef}
              collapsable={false}
              /* `y + height` et non `height` seule : c'est le BAS du bloc dans la page qui compte,
                 pas sa taille — sur l'autre écran, une marge la précède. */
              onLayout={(e) => setAboveTabsH(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
            >
            {/* UNE seule ligne au-dessus des cartes, et elle ne sert qu'à une chose à la fois :
                 • des comptes partagés → le filtre Tout/Perso/Partagés, à la place exacte du titre
                   (même bord gauche). Il y a un choix à faire, c'est lui qui doit occuper la ligne
                   (le titre ne disait rien de plus que ce que les cartes montrent déjà) ;
                 • aucun compte partagé → aucun filtre possible, donc pas de puces : on retrouve le
                   titre « Vue d'ensemble », qui nomme le bloc.
                « Vue d'ensemble » et non « Patrimoine » : ce total ne couvre que l'argent DES
                COMPTES (courant + épargne + investissement), pas les biens possédés. */}
            {hasSharedAccounts ? (
              <View style={styles.overviewHeaderRow}>
                {/* #2 — filtre persistant des totaux */}
                <View style={styles.totalsFilterRow}>
                  {(['all', 'perso', 'shared'] as const).map((f) => (
                    <TouchableOpacity key={f} onPress={() => setTotalsFilter(f)} style={[styles.totalsFilterChip, activeFilter === f && styles.totalsFilterChipActive]} accessibilityRole="button">
                      <Text style={[styles.totalsFilterText, activeFilter === f && styles.totalsFilterTextActive]}>{f === 'all' ? 'Tout' : f === 'perso' ? 'Perso' : 'Partagés'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.overviewTitle}>Vue d'ensemble</Text>
            )}
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
                /* La couleur du montant porte déjà le niveau (rouge / orange / vert) : le mot qui la
                   redoublait sous le chiffre (« Confortable », « Saine »…) n'ajoutait rien. */
                const sCol = s < thMin ? COLORS.danger : s < thOpt ? COLORS.orange : COLORS.savings;
                return [
                  { label: 'Courant', value: totalChecking, color: COLORS.checking, icon: 'wallet-outline' },
                  { label: 'Épargne', value: s, color: sCol, icon: 'leaf-outline' },
                  { label: 'Investi', value: totalInvested, color: COLORS.investment, icon: 'trending-up-outline' },
                  // Seulement si l'utilisateur a des comptes « Autre » — sinon les cartes ne
                  // totaliseraient pas le montant affiché juste dessous.
                  ...(hasOther ? [{ label: 'Autre', value: totalOther, color: COLORS.textSecondary, icon: 'ellipsis-horizontal-circle-outline' }] : []),
                ].map((item) => (
                  <View key={item.label} style={[styles.overviewCard, { borderLeftColor: item.color }]}>
                    <Ionicons name={item.icon as any} size={14} color={item.color} style={{ marginBottom: 2 }} />
                    <Text style={styles.overviewLabel}>{item.label}</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[styles.overviewValue, { color: semanticText(item.color, COLORS) }]}>
                      {approx}{item.value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} {refSymbol}
                    </Text>
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

          {/* ── Onglets Comptes / Crédits ─────────────────────────────────────────────────────────
              Les anciennes « actions rapides » (deux ronds de 52 px + libellés, ~120 px de hauteur
              avant la première carte de compte) ont disparu d'ici : le virement vit dans l'accès
              rapide, et la création de compte est passée SOUS la liste, à la même place et sous la
              même forme que « Ajouter un crédit » de l'onglet voisin.
              `paddingTop` : le complément d'alignement avec les onglets de la page Budget — il vaut
              0 ici tant que ce bloc-ci est le plus haut des deux (cf. lib/ui/tabsAlign). */}
          <View ref={tabsRef} collapsable={false} style={[styles.tabsWrap, { paddingTop: tabsTopPad }]}>
            <PageTabs
              options={[{ value: 'comptes', label: 'Comptes' }, { value: 'credits', label: 'Crédits' }]}
              value={tab}
              onChange={(v: string) => setTab(v as 'comptes' | 'credits')}
            />
          </View>


          {tab === 'credits' ? (
            <CreditsTab userId={user?.id} openCreateSignal={creditCreateSignal} />
          ) : (
          <>
          {/* Les deux actions sont désormais dans la barre d'onglets ci-dessus. Il ne reste ici que
              la zone de publicité « maison » (vide pour un abonné Premium ou sans bannière) — et
              l'air qui sépare l'en-tête de la liste. */}
          <View style={styles.tabTopGap}>
            {/* Le format (compacte, 64 pt) vient de l'emplacement — cf. AD_PLACEMENTS. */}
            <AdSlot placement="comptes_actions" />
          </View>

          {/* Banner de bienvenue */}
          {welcome === '1' && !welcomeDismissed && (
            <View style={styles.welcomeBanner}>
              <View style={styles.welcomeBannerRow}>
                <Text style={styles.welcomeBannerEmoji}>🎉</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.welcomeBannerTitle}>Bienvenue ! Ton profil est créé.</Text>
                  <Text style={styles.welcomeBannerText}>
                    Commence par ajouter tes comptes bancaires, d'épargne et d'investissement.
                  </Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setWelcomeDismissed(true)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={styles.welcomeBannerBtn}
                onPress={() => { setWelcomeDismissed(true); setShowCreateType(true); }}
              >
                <Ionicons name="add" size={16} color={COLORS.onAccent} />
                <Text style={styles.welcomeBannerBtnLabel}>Ajouter mon premier compte</Text>
              </TouchableOpacity>
            </View>
          )}

          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.emerald} style={styles.loader} />
          ) : accounts.length === 0 ? (
            /* Le bouton « Ajouter un compte » est juste en dessous : cette phrase n'a plus à
               renvoyer vers un bouton d'en-tête, elle dit seulement pourquoi ça vaut la peine.
               (L'app TUTOIE partout : c'était « Appuyez sur ».) */
            <Text style={styles.empty}>Aucun compte pour l'instant. Ajoute ton premier compte pour que tes chiffres aient un sens.</Text>
          ) : (
            /* ── Liste Revolut ── */
            <View style={[styles.accountList, onbAccount ? onbGlow(COLORS, true) : null]}>
              {sortedAccounts.map((acc, idx) => {
                const color = accountColor(acc.type);
                const iconName = ACCOUNT_ICONS[acc.type] ?? 'cash-outline';
                const isLast = idx === sortedAccounts.length - 1;
                return (
                  <StaggerIn key={acc.id} index={idx} groupKey="comptes">
                  <TouchableOpacity
                    style={[styles.accountRow, !isLast && styles.accountRowBorder]}
                    {...hoverRow}
                    onPress={() => router.push(`/(tabs)/comptes/${acc.id}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    {/* Icône circulaire */}
                    <View style={[styles.accountIconCircle, { backgroundColor: color + '1A' }]}>
                      <Ionicons name={iconName as any} size={18} color={color} />
                    </View>
                    {/* Nom + type (· Principal = compte courant par défaut, repère discret) */}
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{acc.name}</Text>
                      <Text style={styles.accountType}>
                        {TYPE_LABELS[acc.type] ?? acc.type}{acc.is_default ? ' · Principal' : ''}
                      </Text>
                    </View>
                    {/* Solde */}
                    <View style={styles.accountBalanceWrap}>
                      <Text style={[styles.accountBalance, acc.balance < 0 && { color: COLORS.danger }]}>
                        {acc.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} {currencySymbolFor(acc.currency)}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} style={{ marginTop: 2 }} />
                    </View>
                  </TouchableOpacity>
                  </StaggerIn>
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
                      {...hoverRow}
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
                    onPress={() => respondInvite.mutate({ inviteId: inv.invite_id, accept: false }, { onError: onInviteError })}
                    disabled={respondInvite.isPending || isImpersonating}
                    accessibilityRole="button"
                    accessibilityLabel={`Refuser l'invitation de ${inv.from_name}`}
                  >
                    <Ionicons name="close" size={18} color={COLORS.danger} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.inviteAccept}
                    onPress={() => respondInvite.mutate({ inviteId: inv.invite_id, accept: true }, { onError: onInviteError })}
                    disabled={respondInvite.isPending || isImpersonating}
                    accessibilityRole="button"
                    accessibilityLabel={`Accepter l'invitation de ${inv.from_name}`}
                  >
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ── Ajouter un compte ────────────────────────────────────────────────────────────────
              Exactement la place et la forme du « Ajouter un crédit » de l'onglet voisin : sous les
              listes, pleine largeur, fond plein. Les deux onglets de la page se terminent donc par
              le même geste, au même endroit — et la liste des comptes n'est plus repoussée vers le
              bas par un bloc d'actions en haut de page. */}
          <View ref={actionsRef} style={styles.addAccountWrap}>
            <AppButton label="Ajouter un compte" icon="add" size="lg" onPress={() => setShowCreateType(true)} />
          </View>

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
                      {/* Archiver était SANS RETOUR : la ligne n'offrait aucune action, et rien
                          ailleurs ne remettait `is_active` à vrai. Un compte fermé par erreur
                          disparaissait donc pour de bon des totaux et des virements. */}
                      <TouchableOpacity
                        style={styles.reopenBtn}
                        onPress={() => confirmReopen(acc)}
                        disabled={reactivate.isPending || isImpersonating}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Rouvrir le compte ${acc.name}`}
                      >
                        <Ionicons name="refresh-outline" size={14} color={COLORS.emerald} />
                        <Text style={styles.reopenText}>Rouvrir</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
          <Text style={styles.hint}>Ajoute un compte pour suivre tes soldes et faire des virements.</Text>

          {/* Zone publicité (maison) — en bas de page, activable en admin, masquée pour les Premium */}
          <View style={{ paddingHorizontal: 16 }}>
            <AdSlot placement="comptes" />
          </View>
          </>
          )}
        </ScrollView>
      </SafeAreaView>


      {/* ── GUIDE : repères de la page, après la création du 1er compte ── */}

      {/* ── GUIDE : « crée un compte » — revient tant qu'aucun compte n'existe ── */}
      <GuideModal
        visible={askingAccount && !quickAccounts && !showCreateType}
        icon={guide.is('accounts_savings') ? 'leaf-outline' : 'wallet-outline'}
        iconColor={guide.is('accounts_savings') ? COLORS.savings : COLORS.checking}
        eyebrow="Étape 1 · Tes comptes"
        step={{ index: 1, total: 4 }}
        title={
          guide.is('accounts') ? 'Commençons par tes comptes'
          : guide.is('accounts_checking') ? 'Il te manque un compte courant'
          : 'Et ton épargne ?'
        }
        text={
          guide.is('accounts')
            ? "Ajoute tes comptes avec le montant affiché aujourd'hui par ta banque."
          : guide.is('accounts_checking')
            ? "C'est le compte sur lequel ton argent arrive et tes charges partent : sans lui, impossible de savoir ce qu'il te reste."
            : "Livret A, LDDS, PEA… c'est ce qui permet de calculer ton matelas de sécurité : combien de mois de dépenses ton épargne couvrirait sans rentrée d'argent."
        }
        choices={[
          {
            icon: 'flash-outline', color: COLORS.emerald,
            title: 'Création rapide',
            text: 'Tous tes comptes d\'un coup : courant, épargne, placements.',
            onPress: () => setQuickAccounts(true),
          },
          {
            icon: 'add-circle-outline', color: COLORS.blue,
            title: 'Créer un compte',
            text: 'Un seul compte, avec tous ses détails.',
            // Ouvre DIRECTEMENT le choix du type de compte (personnel / partagé) : il y avait ici
            // une étape intermédiaire qui entourait le bouton « Créer Compte » de la page — retirée
            // avec le reste des pop-up/encadrement (cf. GuideOverlay). Un choix, une action.
            onPress: () => setShowCreateType(true),
          },
        ]}
        secondary={guide.is('accounts_savings')
          ? { label: 'Je n\'en ai pas pour l\'instant', onPress: () => guide.done('g2_nudge_savings') }
          : undefined}
        note={guide.is('accounts_savings') ? undefined : 'Tu pourras corriger un solde à tout moment.'}
      />

      <QuickAccountsModal
        visible={quickAccounts}
        userId={user?.id}
        onClose={() => setQuickAccounts(false)}
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
      <CalculatorButton page="comptes" />
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100 },
  // Bureau : plus de barre d'onglets à dégager, mais de l'air en haut et en bas de la colonne.
  scrollContentDesktop: { paddingBottom: 56, paddingTop: 12 },
  loader: { marginVertical: 40 },
  overviewTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary, paddingHorizontal: 24, marginBottom: 8, marginTop: 4 },
  /* Ne porte QUE le filtre Tout/Perso/Partagés, calé à GAUCHE — exactement là où commence le titre
     « Vue d'ensemble » qu'il remplace, et où commencent les cartes de totaux qu'il commande
     (`paddingLeft` 24 = leur `paddingHorizontal`). La première puce a un retrait de 10 px propre
     (`totalsFilterChip`) : on le compense pour que le texte, lui, tombe pile sur la colonne. */
  overviewHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 14 },
  totalLiquidSmall: { fontSize: 20, fontWeight: '800', color: c.text, textAlign: 'right', paddingHorizontal: 24, marginTop: 6 },

  /* ── Barre d'en-tête : onglets à gauche, actions à droite, une seule ligne ──────────────────────
     `alignItems: 'flex-end'` fait reposer le soulignement de l'onglet actif sur le filet du bas ;
     les pastilles d'action, plus courtes que les onglets (31 px contre 32), s'alignent dessus sans
     rallonger la ligne d'un pixel. */
  /* Onglets : `components/ui/PageTabs`. L'appelant ne fournit QUE le retrait horizontal de 16 ;
     les décalages verticaux appartiennent au composant (cf. lib/ui/controls → pageTabStyles). */
  tabsWrap: { paddingHorizontal: 16 },
  /* Copie conforme de « Ajouter un crédit » (CreditsTab.addBtn) : mêmes espacements, même rayon,
     même graisse. Seul `marginHorizontal` diffère (16), pour tomber sur les bords de la liste des
     comptes — l'onglet Crédits, lui, tient déjà ce retrait par son conteneur. */
  // Le bouton vient de `components/ui/AppButton` ; il ne reste ici que son logement.
  addAccountWrap: { marginTop: 14, marginHorizontal: 16 },
  addAccountBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.emerald, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    marginTop: 14, marginHorizontal: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addAccountBtnLabel: { color: c.onAccent, fontWeight: '800', fontSize: 14 },
  // Air entre l'en-tête et la liste (et logement de la bannière maison, souvent vide).
  tabTopGap: { paddingHorizontal: 24, paddingTop: 16 },
  totalsFilterRow: { flexDirection: 'row', gap: 4, marginBottom: 8, marginTop: 4 },
  // Pas de contour : ces puces sont un réglage secondaire, elles ne doivent pas concurrencer
  // visuellement les cartes de totaux juste en dessous. L'état actif est porté par le seul fond
  // (+ le libellé plus foncé/gras), un peu plus marqué qu'avant puisqu'il n'y a plus de bordure
  // pour le signaler. Le padding gagne 1 px pour compenser la bordure retirée (taille inchangée).
  totalsFilterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  totalsFilterChipActive: { backgroundColor: c.text + '16' },
  totalsFilterText: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  totalsFilterTextActive: { color: c.text, fontWeight: '700' },
  // flexWrap : avec une 4e carte (« Autre »), un petit écran ne peut plus tenir la ligne — les
  // cartes passent alors sur deux rangs au lieu d'écraser les montants. minWidth 72 est calibré pour
  // que les TROIS cartes habituelles restent sur un seul rang même sur le plus étroit des téléphones.
  overviewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, marginBottom: 0 },
  overviewCard: { flexGrow: 1, flexBasis: 0, minWidth: 72, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: c.cardBorder, borderLeftWidth: 3, padding: 10 },
  overviewLabel: { fontSize: 10, fontWeight: '600', color: c.textSecondary, marginBottom: 2 },
  overviewValue: { fontSize: 13, fontWeight: '800', lineHeight: 17 },

  /* Les styles « hero » (grand montant) et « quick actions » (ronds de 52 px) ont été retirés :
     le montant total est passé en petit sous la vue d'ensemble, et les deux actions vivent
     maintenant dans la barre d'onglets (cf. headerActions / headerBtn). */

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
    paddingVertical: 28,
    color: c.textSecondary,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Archivés ──
  archivedSection: { marginTop: 8, marginBottom: 16 },
  archivedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginLeft: 24, marginBottom: 4 },
  archivedTitle: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  reopenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 10,
    borderWidth: 1, borderColor: c.emerald + '55', backgroundColor: c.emerald + '12',
    borderRadius: 999, paddingVertical: 5, paddingHorizontal: 9,
  },
  reopenText: { fontSize: 11.5, fontWeight: '700', color: c.emerald },

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
  welcomeBannerBtnLabel: { fontSize: 14, fontWeight: '700', color: c.onAccent },
});
}

/* OUVERTURE INSTANTANÉE : la page s'affiche en silhouette le temps que son corps (hooks,
   calculs, listes) se monte — sinon le tap reste sans effet visible pendant tout le montage.
   Cf. hooks/useDeferredMount. */
export default withDeferredMount(AccountsListScreen);
